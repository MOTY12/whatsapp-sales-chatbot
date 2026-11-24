import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PermanentJobFailure } from '../jobs/outbox.store';
import type { OutboxOperation } from '../database/entities/outbox-operation.entity';
import { KnowledgeObjectStorage } from './knowledge-object-storage';

type DocumentJob = {
  business_id: string;
  document_id: string;
  revision_id: string;
  object_key: string;
  object_version_id: string;
  checksum_sha256: string;
  size_bytes: number;
  title: string;
};

@Injectable()
export class KnowledgeDocumentIngestionService {
  private readonly logger = new Logger(KnowledgeDocumentIngestionService.name);
  constructor(
    @InjectDataSource() private readonly database: DataSource,
    private readonly storage: KnowledgeObjectStorage,
  ) {}

  async execute(operation: Readonly<OutboxOperation>): Promise<void> {
    const revisionId = operation.metadata?.documentRevisionId;
    if (!revisionId || !/^[0-9a-f-]{36}$/i.test(revisionId))
      throw new PermanentJobFailure('INVALID_DOCUMENT_REFERENCE');
    const [job] = await this.database.query<DocumentJob[]>(
      'SELECT * FROM public.kleva_knowledge_document_job_read($1)',
      [revisionId],
    );
    if (!job) return;
    let failureCode = 'PROCESSING_FAILED';
    try {
      failureCode = 'OBJECT_UNAVAILABLE';
      const object = await this.storage.getVersion(
        job.object_key,
        job.object_version_id,
      );
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (!object.Body) throw new Error('OBJECT_UNAVAILABLE');
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
        if (bytes > 10 * 1024 * 1024)
          throw new PermanentJobFailure('EXTRACTION_LIMIT');
        chunks.push(chunk);
      }
      const pdf = Buffer.concat(chunks);
      if (
        bytes !== job.size_bytes ||
        createHash('sha256').update(pdf).digest('hex') !== job.checksum_sha256
      ) {
        failureCode = 'CHECKSUM_MISMATCH';
        throw new PermanentJobFailure(failureCode);
      }
      if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        failureCode = 'INVALID_PDF';
        throw new PermanentJobFailure(failureCode);
      }
      failureCode = 'INVALID_PDF';
      const pages = await extractPdfPages(pdf);
      if (!pages.length || pages.every((page) => page.trim().length < 10)) {
        failureCode = 'NO_EXTRACTABLE_TEXT';
        throw new PermanentJobFailure(failureCode);
      }
      failureCode = 'EXTRACTION_LIMIT';
      if (
        pages.length > 100 ||
        pages.some((page) => page.length > 50000) ||
        pages.reduce((total, page) => total + page.length, 0) > 500000
      ) {
        throw new PermanentJobFailure(failureCode);
      }
      failureCode = 'NO_EXTRACTABLE_TEXT';
      if (pages.some((page) => page.trim().length < 10))
        throw new PermanentJobFailure(failureCode);
      failureCode = 'PROCESSING_FAILED';
      await this.database.query(
        'SELECT public.kleva_knowledge_document_pages_save($1,$2::text[])',
        [revisionId, pages],
      );
    } catch (error) {
      const permanent = error instanceof PermanentJobFailure;
      const recognized = [
        'INVALID_PDF',
        'ENCRYPTED_PDF',
        'NO_EXTRACTABLE_TEXT',
        'EXTRACTION_LIMIT',
        'OBJECT_UNAVAILABLE',
        'CHECKSUM_MISMATCH',
        'PROCESSING_FAILED',
      ];
      const code =
        error instanceof Error && recognized.includes(error.message)
          ? error.message
          : failureCode;
      await this.database.query(
        'SELECT public.kleva_knowledge_document_job_fail($1,$2,$3)',
        [revisionId, code, permanent],
      );
      if (permanent) {
        this.logger.warn({
          event: 'knowledge.document.ingestion_rejected',
          category: code,
        });
        throw error;
      }
      this.logger.warn({
        event: 'knowledge.document.ingestion_retry',
        category: code,
      });
      throw new Error('DOCUMENT_INGESTION_RETRY');
    }
  }

  async cleanupExpiredUploads(): Promise<number> {
    const rows = await this.database.query<
      Array<{ revision_id: string; object_key: string }>
    >('SELECT * FROM public.kleva_knowledge_uploads_claim_expired($1)', [50]);
    let cleaned = 0;
    for (const row of rows) {
      try {
        await this.storage.deleteAllVersions(row.object_key);
        cleaned++;
      } catch {
        this.logger.warn({ event: 'knowledge.document.cleanup_retry' });
      }
    }
    return cleaned;
  }
}

async function extractPdfPages(input: Buffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = fork(join(__dirname, 'pdf-extractor.child.js'), [], {
      execArgv: ['--max-old-space-size=256'],
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new PermanentJobFailure('EXTRACTION_LIMIT'));
    }, 20000);
    let done = false;
    const finish = (error?: Error, pages?: string[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(pages ?? []);
    };
    child.on('message', (message: unknown) => {
      const result = message as { pages?: unknown; error?: unknown };
      if (
        Array.isArray(result.pages) &&
        result.pages.every((page) => typeof page === 'string')
      )
        finish(undefined, result.pages);
      else if (typeof result.error === 'string')
        finish(new PermanentJobFailure(result.error));
      else finish(new Error('PDF extractor returned invalid output.'));
    });
    child.on('error', () =>
      finish(new Error('PDF extractor could not start.')),
    );
    child.on('exit', (code) => {
      if (!done)
        finish(
          new Error(
            code === 0
              ? 'PDF extractor returned no result.'
              : 'EXTRACTION_LIMIT',
          ),
        );
    });
    child.send({ pdf: input });
  });
}
