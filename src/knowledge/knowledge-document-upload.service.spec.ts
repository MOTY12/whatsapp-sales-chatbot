import { BadRequestException } from '@nestjs/common';
import type { MerchantAccess } from '../Auth/merchant-access.service';
import type { MerchantPrincipal } from '../Auth/auth.service';
import type { MerchantMembership } from '../Auth/merchant-access.service';
import type { EntityManager } from 'typeorm';
import { KnowledgeDocumentUploadService } from './knowledge-document-upload.service';
import type { KnowledgeObjectStorage } from './knowledge-object-storage';

describe('KnowledgeDocumentUploadService', () => {
  const actor = { sessionDigest: 'test' } as MerchantPrincipal;
  const businessId = '00000000-0000-4000-8000-000000000001';

  it('validates the PDF intent, creates a tenant-scoped record and returns only a short-lived PUT URL', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            document_id: '00000000-0000-4000-8000-000000000002',
            revision_id: '00000000-0000-4000-8000-000000000003',
            expires_at: new Date('2026-11-24T12:00:00Z'),
            title: 'Returns policy',
          },
        ])
        .mockResolvedValueOnce([
          {
            object_key:
              'private/knowledge/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003.pdf',
          },
        ]),
    };
    const access = {
      withBusiness: jest.fn(
        async <T>(
          _actor: MerchantPrincipal,
          _businessId: string,
          _permission: string,
          operation: (
            manager: EntityManager,
            membership: MerchantMembership,
          ) => Promise<T>,
        ) =>
          operation(manager as unknown as EntityManager, {
            businessId,
            role: 'owner',
          }),
      ),
    } as unknown as MerchantAccess;
    const storage = {
      ready: jest.fn(),
      versioningEnabled: jest.fn().mockResolvedValue(undefined),
      presignUpload: jest
        .fn()
        .mockResolvedValue(
          'https://storage.example/upload?signature=short-lived',
        ),
    } as unknown as KnowledgeObjectStorage;
    const service = new KnowledgeDocumentUploadService(access, storage);
    const result = await service.create(
      actor,
      businessId,
      '00000000-0000-4000-8000-000000000004',
      {
        title: 'Returns policy',
        fileName: 'returns.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
      },
    );
    expect(result).toMatchObject({
      documentId: '00000000-0000-4000-8000-000000000002',
      revisionId: '00000000-0000-4000-8000-000000000003',
      uploadUrl: 'https://storage.example/upload?signature=short-lived',
    });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT * FROM public.kleva_knowledge_document_create($1,$2,$3,$4,$5,$6)',
      expect.arrayContaining(['Returns policy', 1024, 'a'.repeat(64)]),
    );
    expect(result).not.toHaveProperty('objectKey');
  });

  it.each([
    { fileName: 'invoice.txt', contentType: 'text/plain', sizeBytes: 50 },
    {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024 + 1,
    },
  ])(
    'rejects non-PDF or oversized upload metadata before touching storage',
    async (file) => {
      const access = { withBusiness: jest.fn() } as unknown as MerchantAccess;
      const storageReady = jest.fn();
      const storage = {
        ready: storageReady,
        versioningEnabled: jest.fn(),
        presignUpload: jest.fn(),
      } as unknown as KnowledgeObjectStorage;
      const service = new KnowledgeDocumentUploadService(access, storage);
      await expect(
        service.create(
          actor,
          businessId,
          '00000000-0000-4000-8000-000000000004',
          {
            title: 'Document',
            fileName: file.fileName,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
            sha256: 'a'.repeat(64),
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storageReady).not.toHaveBeenCalled();
    },
  );

  it('rejects an unverified object without enqueueing extraction', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        {
          object_key: 'private/knowledge/key.pdf',
          checksum_sha256: 'a'.repeat(64),
          size_bytes: 100,
          status: 'UPLOADING',
        },
      ]),
    };
    const access = {
      withBusiness: jest.fn(
        async <T>(
          _actor: MerchantPrincipal,
          _businessId: string,
          _permission: string,
          operation: (
            manager: EntityManager,
            membership: MerchantMembership,
          ) => Promise<T>,
        ) =>
          operation(manager as unknown as EntityManager, {
            businessId,
            role: 'owner',
          }),
      ),
    } as unknown as MerchantAccess;
    const storage = {
      verifyUpload: jest
        .fn()
        .mockRejectedValue(new Error('OBJECT_VALIDATION_FAILED')),
    } as unknown as KnowledgeObjectStorage;
    const service = new KnowledgeDocumentUploadService(access, storage);
    await expect(
      service.complete(
        actor,
        businessId,
        '00000000-0000-4000-8000-000000000003',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
