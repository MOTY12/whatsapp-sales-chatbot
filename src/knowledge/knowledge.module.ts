import { Module } from '@nestjs/common';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';

@Module({
  providers: [KnowledgeRetrievalService],
  exports: [KnowledgeRetrievalService],
})
export class KnowledgeModule {}
