import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeGapCaptureService } from './knowledge-gap-capture.service';

@Module({
  imports: [DatabaseModule],
  providers: [KnowledgeGapCaptureService],
  exports: [KnowledgeGapCaptureService],
})
export class LearningModule {}
