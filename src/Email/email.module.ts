import { Module } from '@nestjs/common';
import { merchantEmailAuthConfig } from '../config/env';
import { OutboxModule } from '../jobs/outbox.module';
import { EMAIL_CONFIG } from './email.config';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER, MailjetProvider } from './providers/mailjet.provider';

@Module({
  imports: [OutboxModule],
  providers: [
    { provide: EMAIL_CONFIG, useFactory: () => merchantEmailAuthConfig() },
    MailjetProvider,
    { provide: EMAIL_PROVIDER, useExisting: MailjetProvider },
    EmailService,
  ],
  exports: [EmailService, EMAIL_CONFIG],
})
export class EmailModule {}
