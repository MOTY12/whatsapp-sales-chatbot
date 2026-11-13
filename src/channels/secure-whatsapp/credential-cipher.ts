import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { whatsappCredentialConfig } from '../../config/env';

export interface CredentialEnvelope {
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}

@Injectable()
export class CredentialCipher {
  private readonly config = whatsappCredentialConfig();

  encrypt(
    token: string,
    businessId: string,
    connectionId: string,
  ): CredentialEnvelope {
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
      keyId: current,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  }

  decrypt(
    envelope: CredentialEnvelope,
    businessId: string,
    connectionId: string,
  ): string {
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

  private context(businessId: string, connectionId: string, keyId: string) {
    return Buffer.from(
      JSON.stringify(['kleva-whatsapp-v1', businessId, connectionId, keyId]),
    );
  }
}
