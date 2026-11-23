import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConversationMemoryService } from './conversation-memory.service';

@Module({
  imports: [DatabaseModule],
  providers: [ConversationMemoryService],
  exports: [ConversationMemoryService],
})
export class SupportAgentModule {}
