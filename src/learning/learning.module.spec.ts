import { LearningModule } from './learning.module';
import { KnowledgeGapRetentionService } from './knowledge-gap-retention.service';
import { WorkerModule } from '../jobs/worker.module';

describe('knowledge-gap retention runtime', () => {
  it('schedules retention only in the dedicated worker process', () => {
    const httpLearningProviders: unknown = Reflect.getMetadata(
      'providers',
      LearningModule,
    );
    const workerProviders: unknown = Reflect.getMetadata(
      'providers',
      WorkerModule,
    );

    expect(httpLearningProviders).not.toContain(KnowledgeGapRetentionService);
    expect(workerProviders).toContain(KnowledgeGapRetentionService);
  });
});
