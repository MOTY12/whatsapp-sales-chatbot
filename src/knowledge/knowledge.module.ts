import { Module } from '@nestjs/common';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { UnifiedKnowledgeRetrievalService } from './unified-knowledge-retrieval.service';
import { KnowledgeObjectStorage } from './knowledge-object-storage';

@Module({
  providers: [
    KnowledgeRetrievalService,
    UnifiedKnowledgeRetrievalService,
    KnowledgeObjectStorage,
  ],
  exports: [
    KnowledgeRetrievalService,
    UnifiedKnowledgeRetrievalService,
    KnowledgeObjectStorage,
  ],
})
export class KnowledgeModule {}
