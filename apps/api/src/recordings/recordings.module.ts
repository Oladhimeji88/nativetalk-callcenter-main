import {
  Controller, Get, Module, NotFoundException, Param, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';
import { REC_DIR } from '../dialer/dialer.service';

// Call recordings served straight from the FreeSWITCH recordings folder on this
// server (no object storage yet). Files are located only by the filename stored
// on the CallAttempt, and resolved strictly inside REC_DIR (no path traversal).
@UseGuards(RbacGuard)
@Permissions('recordings')
@Controller('recordings')
export class RecordingsController {
  constructor(private prisma: PrismaService) {}

  // List attempts that have a recording.
  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.callAttempt.findMany({
      where: { tenantId: u.tenantId, recording: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 1000,
    });
    return rows.map((r) => ({
      id: r.id, number: r.number, disposition: r.disposition,
      startedAt: r.startedAt, file: r.recording, url: `/recordings/${r.id}/audio`,
    }));
  }

  // Stream one recording (supports HTTP Range so players can seek).
  @Get(':id/audio')
  async audio(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const att = await this.prisma.callAttempt.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!att?.recording) throw new NotFoundException('recording not found');

    // Resolve strictly inside REC_DIR using only the basename.
    const safe = path.basename(att.recording);
    const full = path.join(REC_DIR, safe);
    if (!full.startsWith(path.resolve(REC_DIR)) || !existsSync(full)) {
      throw new NotFoundException('recording file not found on disk yet');
    }

    const size = statSync(full).size;
    const range = req.headers.range;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(full, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', size);
      createReadStream(full).pipe(res);
    }
  }
}

@Module({ controllers: [RecordingsController] })
export class RecordingsModule {}
