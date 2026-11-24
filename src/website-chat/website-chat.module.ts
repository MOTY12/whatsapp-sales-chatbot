import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WebsiteChatController } from './website-chat.controller';
import { WebsiteChatService } from './website-chat.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WebsiteChatController],
  providers: [WebsiteChatService],
  exports: [WebsiteChatService],
})
export class WebsiteChatModule {}
