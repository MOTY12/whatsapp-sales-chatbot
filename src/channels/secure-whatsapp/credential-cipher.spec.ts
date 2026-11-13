import { randomBytes } from 'node:crypto';
import { CredentialCipher } from './credential-cipher';

describe('WhatsApp credential encryption', () => {
  const keys = {
    previous: randomBytes(32).toString('base64url'),
    current: randomBytes(32).toString('base64url'),
  };

  function cipher(key: string, available = keys) {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      WHATSAPP_CREDENTIAL_KEY_ID: key,
      WHATSAPP_CREDENTIAL_KEYS: JSON.stringify(available),
    });
    return new CredentialCipher();
  }

  afterEach(() => jest.restoreAllMocks());

  it('authenticates ciphertext, tenant and connection and supports old keys', () => {
    const prior = cipher('previous');
    const envelope = prior.encrypt('fixture-token', 'tenant', 'connection');
    expect(JSON.stringify(envelope)).not.toContain('fixture-token');
    expect(
      prior.encrypt('fixture-token', 'tenant', 'connection').nonce,
    ).not.toBe(envelope.nonce);
    const rotated = cipher('current');
    expect(rotated.decrypt(envelope, 'tenant', 'connection')).toBe(
      'fixture-token',
    );
    expect(rotated.encrypt('replacement', 'tenant', 'connection').keyId).toBe(
      'current',
    );
    const corrupted = Buffer.from(envelope.ciphertext, 'base64url');
    corrupted[0] ^= 1;
    expect(() =>
      rotated.decrypt(
        { ...envelope, ciphertext: corrupted.toString('base64url') },
        'tenant',
        'connection',
      ),
    ).toThrow('Credential authentication failed');
    expect(() => rotated.decrypt(envelope, 'other', 'connection')).toThrow();
    expect(() => rotated.decrypt(envelope, 'tenant', 'other')).toThrow();
    expect(() => cipher('missing')).toThrow('Invalid WHATSAPP_CREDENTIAL');
  });
});
