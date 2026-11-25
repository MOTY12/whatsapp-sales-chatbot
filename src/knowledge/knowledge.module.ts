import { Module } from '@nestjs/common';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { UnifiedKnowledgeRetrievalService } from './unified-knowledge-retrieval.service';
import { KnowledgeObjectStorage } from './knowledge-object-storage';
import { UsageModule } from '../metering/usage.module';
import {
  OpenAiEmbeddingProvider,
  EMBEDDING_PROVIDER,
} from './embedding-provider';
import { KnowledgeIndexingWorkerService } from './knowledge-indexing.service';

@Module({
  imports: [UsageModule],
  providers: [
    KnowledgeRetrievalService,
    UnifiedKnowledgeRetrievalService,
    KnowledgeObjectStorage,
    OpenAiEmbeddingProvider,
    { provide: EMBEDDING_PROVIDER, useExisting: OpenAiEmbeddingProvider },
    KnowledgeIndexingWorkerService,
  ],
  exports: [
    KnowledgeRetrievalService,
    UnifiedKnowledgeRetrievalService,
    KnowledgeObjectStorage,
    KnowledgeIndexingWorkerService,
  ],
})
export class KnowledgeModule {}
