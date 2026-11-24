import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { MerchantPrincipal } from '../Auth/auth.service';
import { MerchantAccess } from '../Auth/merchant-access.service';
import { KnowledgeObjectStorage } from './knowledge-object-storage';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Hex = /^[0-9a-f]{64}$/;
const maxBytes = 10 * 1024 * 1024;
type DocumentRow = {
  id: string;
  title: string;
  status: string;
  revision_id: string | null;
  revision_status: string | null;
  page_count: number | null;
  size_bytes: number | null;
  created_at: Date;
  updated_at: Date;
};

function parseCreate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Expected document upload details.');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) =>
        !['title', 'fileName', 'contentType', 'sizeBytes', 'sha256'].includes(
          key,
        ),
    )
  )
    throw new BadRequestException('Unexpected upload field.');
  if (
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    body.title.trim().length > 160
  )
    throw new BadRequestException('Document title must be 1–160 characters.');
  if (
    typeof body.fileName !== 'string' ||
    !/^[^/\\]{1,120}\.pdf$/i.test(body.fileName.trim())
  )
    throw new BadRequestException('Choose a PDF file with a valid filename.');
  if (body.contentType !== 'application/pdf')
    throw new BadRequestException('Only PDF documents are accepted.');
  if (
    !Number.isSafeInteger(body.sizeBytes) ||
    Number(body.sizeBytes) < 1 ||
    Number(body.sizeBytes) > maxBytes
  )
    throw new BadRequestException('PDF documents must be 10 MB or smaller.');
  if (typeof body.sha256 !== 'string' || !sha256Hex.test(body.sha256))
    throw new BadRequestException('A valid SHA-256 checksum is required.');
  return {
    title: body.title.trim(),
    size: Number(body.sizeBytes),
    checksum: body.sha256,
  };
}

@Injectable()
export class KnowledgeDocumentUploadService {
  private readonly logger = new Logger(KnowledgeDocumentUploadService.name);
  constructor(
    private readonly access: MerchantAccess,
    private readonly storage: KnowledgeObjectStorage,
  ) {}

  list(actor: MerchantPrincipal, businessId: string) {
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) =>
        this.safeQuery<DocumentRow[]>(
          manager,
          'SELECT * FROM public.kleva_knowledge_document_list()',
        ),
    );
  }

  async create(
    actor: MerchantPrincipal,
    businessId: string,
    key: string | undefined,
    input: unknown,
  ) {
    if (!key || !uuidV4.test(key))
      throw new BadRequestException(
        'Idempotency-Key must be a version 4 UUID.',
      );
    const fields = parseCreate(input);
    this.storage.ready();
    await this.storage.versioningEnabled();
    const revisionId = randomUUID();
    const objectKey = `private/knowledge/${businessId.toLowerCase()}/${revisionId}.pdf`;
    const checksumBase64 = Buffer.from(fields.checksum, 'hex').toString(
      'base64',
    );
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [created] = await this.safeQuery<
          Array<{
            document_id: string;
            revision_id: string;
            expires_at: Date;
            title: string;
          }>
        >(
          manager,
          'SELECT * FROM public.kleva_knowledge_document_create($1,$2,$3,$4,$5,$6)',
          [
            key,
            revisionId,
            fields.title,
            objectKey,
            fields.size,
            fields.checksum,
          ],
        );
        if (!created) throw new NotFoundException();
        const [source] = await this.safeQuery<Array<{ object_key: string }>>(
          manager,
          'SELECT object_key FROM public.knowledge_document_upload_info($1)',
          [created.revision_id],
        );
        if (!source) throw new NotFoundException();
        const uploadUrl = await this.storage.presignUpload(
          source.object_key,
          'application/pdf',
          checksumBase64,
        );
        return {
          documentId: created.document_id,
          revisionId: created.revision_id,
          title: created.title,
          uploadUrl,
          expiresAt: created.expires_at,
          headers: {
            'Content-Type': 'application/pdf',
            'x-amz-checksum-sha256': checksumBase64,
            'x-amz-server-side-encryption': 'AES256',
          },
        };
      },
    );
  }

  async complete(
    actor: MerchantPrincipal,
    businessId: string,
    revisionId: string,
  ) {
    if (!uuidV4.test(revisionId)) throw new NotFoundException();
    const [source] = await this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      (manager) =>
        this.safeQuery<
          Array<{
            object_key: string;
            checksum_sha256: string;
            size_bytes: number;
            status: string;
          }>
        >(
          manager,
          'SELECT object_key,checksum_sha256,size_bytes,status FROM public.kleva_knowledge_document_upload_info($1)',
          [revisionId],
        ),
    );
    if (!source) throw new NotFoundException();
    let versionId: string;
    try {
      versionId = await this.storage.verifyUpload(
        source.object_key,
        source.size_bytes,
        Buffer.from(source.checksum_sha256, 'hex').toString('base64'),
      );
    } catch {
      this.logger.warn({
        event: 'knowledge.document.upload_rejected',
        category: 'OBJECT_VALIDATION_FAILED',
        businessId,
      });
      throw new BadRequestException(
        'The uploaded PDF could not be verified. Start a new upload.',
      );
    }
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [result] = await this.safeQuery<
          Array<{ document_id: string; revision_id: string; status: string }>
        >(
          manager,
          'SELECT * FROM public.kleva_knowledge_document_complete($1,$2)',
          [revisionId, versionId],
        );
        if (!result) throw new NotFoundException();
        return {
          documentId: result.document_id,
          revisionId: result.revision_id,
          status: result.status,
        };
      },
    );
  }

  publish(actor: MerchantPrincipal, businessId: string, documentId: string) {
    return this.publication(actor, businessId, documentId, true);
  }
  unpublish(actor: MerchantPrincipal, businessId: string, documentId: string) {
    return this.publication(actor, businessId, documentId, false);
  }

  private async publication(
    actor: MerchantPrincipal,
    businessId: string,
    documentId: string,
    publish: boolean,
  ) {
    if (!uuidV4.test(documentId)) throw new NotFoundException();
    return this.access.withBusiness(
      actor,
      businessId,
      'knowledge.manage',
      async (manager) => {
        const [changed] = await this.safeQuery<Array<{ changed: boolean }>>(
          manager,
          `SELECT public.kleva_knowledge_document_${publish ? 'publish' : 'unpublish'}($1) AS changed`,
          [documentId],
        );
        if (!changed?.changed) throw new NotFoundException();
        const [document] = await this.safeQuery<DocumentRow[]>(
          manager,
          'SELECT * FROM public.kleva_knowledge_document_list() WHERE id=$1',
          [documentId],
        );
        return document;
      },
    );
  }

  private async safeQuery<T>(
    manager: EntityManager,
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    try {
      return await manager.query<T>(sql, params);
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      if (code === '42501') throw new NotFoundException();
      if (code === '22023')
        throw new ConflictException(
          'This upload has expired or is not ready. Start a new upload.',
        );
      if (code === '23505')
        throw new ConflictException(
          'This idempotency key was already used for different upload details.',
        );
      throw error;
    }
  }
}
