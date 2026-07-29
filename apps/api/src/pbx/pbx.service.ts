import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FsProvisioningService, PbxConfig } from '../freeswitch/fs-provisioning.service';

@Injectable()
export class PbxService {
  private readonly logger = new Logger(PbxService.name);

  constructor(
    private prisma: PrismaService,
    private prov: FsProvisioningService,
  ) {}

  async loadConfig(tenantId: string): Promise<PbxConfig> {
    const [extensions, trunks, ringGroups, inboundRoutes, ivrs, queues, timeConditions] = await Promise.all([
      this.prisma.extension.findMany({ where: { tenantId } }),
      this.prisma.trunk.findMany({ where: { tenantId } }),
      this.prisma.ringGroup.findMany({ where: { tenantId } }),
      this.prisma.inboundRoute.findMany({ where: { tenantId } }),
      this.prisma.ivr.findMany({ where: { tenantId } }),
      this.prisma.queue.findMany({ where: { tenantId } }),
      this.prisma.timeCondition.findMany({ where: { tenantId } }),
    ]);
    return { tenantId, extensions, trunks, ringGroups, inboundRoutes, ivrs, queues, timeConditions };
  }

  /** Regenerate + apply FreeSWITCH config for a tenant. */
  async sync(tenantId: string) {
    const cfg = await this.loadConfig(tenantId);
    return this.prov.apply(cfg);
  }

  /** Generate XML without writing/applying (always safe — used for preview/verify). */
  async preview(tenantId: string) {
    const cfg = await this.loadConfig(tenantId);
    return this.prov.generateAll(cfg);
  }

  /** Fire-and-forget resync after a mutation; never throws into the request. */
  async safeSync(tenantId: string) {
    try { await this.sync(tenantId); } catch (e) { this.logger.warn(`sync failed: ${(e as Error).message}`); }
  }
}
