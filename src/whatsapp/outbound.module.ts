import { Module } from '@nestjs/common';
import { CredentialCipherModule } from '../channels/secure-whatsapp/credential-cipher.module';
import { OutboxModule } from '../jobs/outbox.module';
import { DatabaseModule } from '../database/database.module';
import { UsageModule } from '../metering/usage.module';
import { OutboundMessageService } from './outbound-message.service';
import { ChannelConnectionService } from '../channels/channel-connection.service';
import { WHATSAPP_CLOUD_API_CLIENT } from './interfaces/whatsapp-cloud-api-client.interface';
import { WhatsAppCloudApiService } from './whatsapp-cloud-api.service';

@Module({
  imports: [DatabaseModule, CredentialCipherModule, OutboxModule, UsageModule],
  providers: [
    ChannelConnectionService,
    WhatsAppCloudApiService,
    OutboundMessageService,
    {
      provide: WHATSAPP_CLOUD_API_CLIENT,
      useExisting: WhatsAppCloudApiService,
    },
  ],
  exports: [
    ChannelConnectionService,
    OutboundMessageService,
    WhatsAppCloudApiService,
    WHATSAPP_CLOUD_API_CLIENT,
  ],
})
export class OutboundModule {}
