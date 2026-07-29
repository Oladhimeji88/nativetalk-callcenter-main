import { Global, Module } from '@nestjs/common';
import { FreeswitchService } from './freeswitch.service';
import { FsProvisioningService } from './fs-provisioning.service';

@Global()
@Module({
  providers: [FreeswitchService, FsProvisioningService],
  exports: [FreeswitchService, FsProvisioningService],
})
export class FreeswitchModule {}
