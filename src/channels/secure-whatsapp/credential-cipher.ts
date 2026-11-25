import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from '@aws-sdk/client-kms';
import { whatsappCredentialConfig } from '../../config/env';

export interface CredentialEnvelope {
  version?: 1 | 2;
  provider?: 'local' | 'aws_kms';
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  wrappedKey?: string;
}

@Injectable()
export class CredentialCipher {
  private readonly config = whatsappCredentialConfig();
  private readonly kmsClient =
    this.config.provider === 'aws_kms'
      ? new KMSClient({ region: this.config.region, maxAttempts: 2 })
      : undefined;

  async encrypt(
    token: string,
    businessId: string,
    connectionId: string,
  ): Promise<CredentialEnvelope> {
    if (this.config.provider === 'aws_kms')
      return this.encryptWithKms(token, businessId, connectionId);
    const { current, keys } = this.config;
    const key = keys.get(current);
    if (!key)
      throw new ServiceUnavailableException(
        'Credential encryption is unavailable.',
      );
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.context(businessId, connectionId, current));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      version: 1,
      provider: 'local',
      keyId: current,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  }

  async decrypt(
    envelope: CredentialEnvelope,
    businessId: string,
    connectionId: string,
  ): Promise<string> {
    if (envelope.provider === 'aws_kms' || envelope.version === 2)
      return this.decryptWithKms(envelope, businessId, connectionId);
    const key = this.config.keys.get(envelope.keyId);
    if (!key) throw new Error('Unknown credential encryption key.');
    try {
      const nonce = Buffer.from(envelope.nonce, 'base64url');
      if (nonce.length !== 12) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: 16,
      });
      cipher.setAAD(this.context(businessId, connectionId, envelope.keyId));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        cipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Credential authentication failed.');
    }
  }

  private async encryptWithKms(
    token: string,
    businessId: string,
    connectionId: string,
  ): Promise<CredentialEnvelope> {
    if (!this.kmsClient || !this.config.keyArn)
      throw new ServiceUnavailableException(
        'Credential encryption is unavailable.',
      );
    let plaintext: Uint8Array | undefined;
    let dataKey: Buffer | undefined;
    try {
      const generated = await this.kmsClient.send(
        new GenerateDataKeyCommand({
          KeyId: this.config.keyArn,
          KeySpec: 'AES_256',
          EncryptionContext: this.kmsContext(businessId, connectionId),
        }),
      );
      plaintext = generated.Plaintext;
      if (
        !plaintext ||
        plaintext.byteLength !== 32 ||
        !generated.CiphertextBlob
      )
        throw new Error('KMS returned an invalid data key.');
      dataKey = Buffer.from(plaintext);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
      cipher.setAAD(
        this.contextV2(businessId, connectionId, this.config.keyArn),
      );
      const ciphertext = Buffer.concat([
        cipher.update(token, 'utf8'),
        cipher.final(),
      ]);
      return {
        version: 2,
        provider: 'aws_kms',
        keyId: this.config.keyArn,
        wrappedKey: Buffer.from(generated.CiphertextBlob).toString('base64url'),
        nonce: nonce.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Credential encryption is unavailable.',
      );
    } finally {
      dataKey?.fill(0);
      plaintext?.fill(0);
    }
  }

  private async decryptWithKms(
    envelope: CredentialEnvelope,
    businessId: string,
    connectionId: string,
  ): Promise<string> {
    if (!this.kmsClient || envelope.version !== 2 || !envelope.wrappedKey)
      throw new Error('Credential authentication failed.');
    let plaintext: Uint8Array | undefined;
    let dataKey: Buffer | undefined;
    try {
      const result = await this.kmsClient.send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(envelope.wrappedKey, 'base64url'),
          EncryptionContext: this.kmsContext(businessId, connectionId),
        }),
      );
      plaintext = result.Plaintext;
      if (!plaintext || plaintext.byteLength !== 32)
        throw new Error('KMS returned an invalid data key.');
      dataKey = Buffer.from(plaintext);
      const nonce = Buffer.from(envelope.nonce, 'base64url');
      const tag = Buffer.from(envelope.tag, 'base64url');
      if (nonce.length !== 12 || tag.length !== 16)
        throw new Error('Invalid encrypted credential envelope.');
      const decipher = createDecipheriv('aes-256-gcm', dataKey, nonce, {
        authTagLength: 16,
      });
      decipher.setAAD(this.contextV2(businessId, connectionId, envelope.keyId));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Credential authentication failed.');
    } finally {
      dataKey?.fill(0);
      plaintext?.fill(0);
    }
  }

  private kmsContext(businessId: string, connectionId: string) {
    return {
      service: 'kleva-whatsapp-credentials',
      business_id: businessId.toLowerCase(),
      connection_id: connectionId.toLowerCase(),
    };
  }

  private contextV2(businessId: string, connectionId: string, keyId: string) {
    return Buffer.from(
      JSON.stringify([
        'kleva-whatsapp-v2',
        businessId.toLowerCase(),
        connectionId.toLowerCase(),
        keyId,
      ]),
    );
  }

  private context(businessId: string, connectionId: string, keyId: string) {
    return Buffer.from(
      JSON.stringify(['kleva-whatsapp-v1', businessId, connectionId, keyId]),
    );
  }
}
