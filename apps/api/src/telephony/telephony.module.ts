import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Permissions } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { TelephonyService } from './telephony.service';

// Agents may use the softphone + set their own status; live-calls/monitor are
// supervisor-only (agents are denied those by the global RBAC guard).
@Controller('telephony')
export class TelephonyController {
  constructor(private svc: TelephonyService) {}

  // The softphone is available to any role granted the `softphone` permission.
  @Permissions('softphone')
  @Get('softphone')
  softphone(@CurrentUser() u: AuthUser, @Query('extension') extension: string) {
    return this.svc.softphoneConfig(u, extension);
  }

  // Live-calls board + monitoring require the `live` (Live calls) permission.
  @Permissions('live')
  @Get('calls')
  calls() {
    return this.svc.liveCalls();
  }

  @Permissions('live')
  @Post('calls/:uuid/monitor')
  monitor(@Param('uuid') uuid: string, @Body() b: { mode?: string; agent?: string }) {
    return this.svc.monitor(uuid, b?.mode ?? 'listen', b?.agent ?? '');
  }

  @Permissions('live')
  @Get('agents')
  agents(@CurrentUser() u: AuthUser) {
    return this.svc.listAgents(u);
  }

  // Supervisor monitoring by agent extension: rings the supervisor's OWN softphone
  // into the target agent's live call. mode = listen | whisper (coach) | barge.
  @Permissions('live')
  @Post('agents/:extension/monitor')
  monitorAgent(@CurrentUser() u: AuthUser, @Param('extension') extension: string, @Body() b: { mode?: string }) {
    return this.svc.monitorAgent(extension, b?.mode ?? 'listen', u);
  }

  @Permissions('softphone')
  @Post('agents/:extension/status')
  setStatus(@Param('extension') extension: string, @Body() b: { status?: string }) {
    return this.svc.setAgentStatus(extension, b?.status ?? 'Available');
  }

  // Start recording the agent's live call (used by preview campaigns with
  // recording enabled — the softphone call lives on FreeSWITCH, so we record it
  // server-side via ESL). Returns the recording filename to store on the CallLog.
  @Permissions('softphone')
  @Post('record/start')
  startRecording(@CurrentUser() u: AuthUser, @Body() b: { extension?: string }) {
    return this.svc.startRecording(b?.extension ?? u.agentExtension ?? '');
  }
}

@Module({
  controllers: [TelephonyController],
  providers: [TelephonyService],
})
export class TelephonyModule {}
