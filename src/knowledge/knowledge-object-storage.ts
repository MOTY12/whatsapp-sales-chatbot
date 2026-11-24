import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { knowledgeStorageConfig } from '../config/env';

@Injectable()
export class KnowledgeObjectStorage {
  private readonly config = knowledgeStorageConfig();
  private readonly client = this.config
    ? new S3Client({
        region: this.config.region,
        ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
        forcePathStyle: this.config.forcePathStyle,
        ...(this.config.credentials
          ? { credentials: this.config.credentials }
          : {}),
      })
    : null;

  ready() {
    if (!this.config || !this.client)
      throw new ServiceUnavailableException(
        'Private document storage is not configured. Contact your administrator.',
      );
  }

  async versioningEnabled(): Promise<void> {
    this.ready();
    const result = await this.client!.send(
      new GetBucketVersioningCommand({ Bucket: this.config!.bucket }),
    );
    if (result.Status !== 'Enabled')
      throw new ServiceUnavailableException(
        'Private document storage requires bucket versioning to be enabled.',
      );
  }

  async presignUpload(
    key: string,
    contentType: string,
    checksumBase64: string,
  ) {
    this.ready();
    const command = new PutObjectCommand({
      Bucket: this.config!.bucket,
      Key: key,
      ContentType: contentType,
      ChecksumSHA256: checksumBase64,
      ServerSideEncryption: 'AES256',
    });
    return getSignedUrl(this.client!, command, {
      expiresIn: 900,
      signableHeaders: new Set([
        'content-type',
        'x-amz-checksum-sha256',
        'x-amz-server-side-encryption',
      ]),
    });
  }

  async verifyUpload(
    key: string,
    expectedSize: number,
    checksumBase64: string,
  ) {
    this.ready();
    const object = await this.client!.send(
      new HeadObjectCommand({
        Bucket: this.config!.bucket,
        Key: key,
        ChecksumMode: 'ENABLED',
      }),
    );
    if (
      !object.VersionId ||
      object.ContentLength !== expectedSize ||
      object.ChecksumSHA256 !== checksumBase64 ||
      object.ServerSideEncryption !== 'AES256' ||
      object.ContentType?.split(';')[0].trim().toLowerCase() !==
        'application/pdf'
    )
      throw new Error('UPLOAD_OBJECT_VALIDATION_FAILED');
    return object.VersionId;
  }

  async getVersion(
    key: string,
    versionId: string,
  ): Promise<GetObjectCommandOutput> {
    this.ready();
    return this.client!.send(
      new GetObjectCommand({
        Bucket: this.config!.bucket,
        Key: key,
        VersionId: versionId,
        ChecksumMode: 'ENABLED',
      }),
    );
  }

  async deleteAllVersions(key: string): Promise<void> {
    this.ready();
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await this.client!.send(
        new ListObjectVersionsCommand({
          Bucket: this.config!.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
          MaxKeys: 1000,
        }),
      );
      const versions = [
        ...(page.Versions ?? [])
          .filter((item) => item.Key === key && item.VersionId)
          .map((item) => ({ Key: key, VersionId: item.VersionId! })),
        ...(page.DeleteMarkers ?? [])
          .filter((item) => item.Key === key && item.VersionId)
          .map((item) => ({ Key: key, VersionId: item.VersionId! })),
      ];
      if (versions.length) {
        const deleted = await this.client!.send(
          new DeleteObjectsCommand({
            Bucket: this.config!.bucket,
            Delete: { Objects: versions, Quiet: true },
          }),
        );
        if (deleted.Errors?.length) throw new Error('S3_VERSION_DELETE_FAILED');
      }
      if (!page.IsTruncated) break;
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
    } while (keyMarker || versionIdMarker);
  }
}
