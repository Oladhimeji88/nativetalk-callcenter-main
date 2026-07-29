import { Body, Controller, Header, HttpCode, Logger, Module, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { FsXmlService } from './fs-xml.service';

// mod_xml_curl endpoint. FreeSWITCH POSTs (form-encoded) here whenever it needs
// config. Public (no JWT — FreeSWITCH isn't a user) but guarded by a shared
// secret, and exempt from rate limiting (FS calls this constantly).
@Controller('fs')
export class FsXmlController {
  private readonly logger = new Logger(FsXmlController.name);
  constructor(private svc: FsXmlService, private config: ConfigService) {}

  @Public()
  @SkipThrottle()
  @Post('xml')
  @HttpCode(200) // mod_xml_curl treats anything but 200 (e.g. Nest's default 201) as an error
  @Header('Content-Type', 'text/xml')
  async xml(@Query('secret') secret: string, @Body() body: Record<string, string>) {
    const expected = this.config.get<string>('FS_XML_SECRET');
    if (!expected || secret !== expected) {
      this.logger.warn('fs xml: rejected request with bad/missing secret');
      return this.svc.notFound();
    }

    const section = body?.section;
    if (section === 'directory') return this.svc.directory(body);
    if (section === 'dialplan') return this.svc.dialplan(body);
    // Only callcenter.conf is served dynamically (per-campaign ACD queues); every
    // other configuration returns "not found" so FreeSWITCH uses its static file.
    if (section === 'configuration') return this.svc.configuration(body);

    return this.svc.notFound();
  }
}

@Module({
  controllers: [FsXmlController],
  providers: [FsXmlService],
})
export class FsXmlModule {}
