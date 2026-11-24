import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeGapCaptureService } from './knowledge-gap-capture.service';
import { KnowledgeGapRetentionService } from './knowledge-gap-retention.service';

@Module({
  imports: [DatabaseModule],
  providers: [KnowledgeGapCaptureService, KnowledgeGapRetentionService],
  exports: [KnowledgeGapCaptureService],
})
export class LearningModule {}
