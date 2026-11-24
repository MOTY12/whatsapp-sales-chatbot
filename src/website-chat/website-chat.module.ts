import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WebsiteChatController } from './website-chat.controller';
import { WebsiteChatService } from './website-chat.service';
import { WebsiteRealtimeService } from './website-realtime.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WebsiteChatController],
  providers: [WebsiteChatService, WebsiteRealtimeService],
  exports: [WebsiteChatService, WebsiteRealtimeService],
})
export class WebsiteChatModule {}
