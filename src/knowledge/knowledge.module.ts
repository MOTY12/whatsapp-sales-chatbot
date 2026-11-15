import { Module } from '@nestjs/common';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { UnifiedKnowledgeRetrievalService } from './unified-knowledge-retrieval.service';

@Module({
  providers: [KnowledgeRetrievalService, UnifiedKnowledgeRetrievalService],
  exports: [KnowledgeRetrievalService, UnifiedKnowledgeRetrievalService],
})
export class KnowledgeModule {}
