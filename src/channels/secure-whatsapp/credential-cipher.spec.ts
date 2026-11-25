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

  it('authenticates ciphertext, tenant and connection and supports old keys', async () => {
    const prior = cipher('previous');
    const envelope = await prior.encrypt(
      'fixture-token',
      'tenant',
      'connection',
    );
    expect(JSON.stringify(envelope)).not.toContain('fixture-token');
    expect(
      (await prior.encrypt('fixture-token', 'tenant', 'connection')).nonce,
    ).not.toBe(envelope.nonce);
    const rotated = cipher('current');
    expect(await rotated.decrypt(envelope, 'tenant', 'connection')).toBe(
      'fixture-token',
    );
    const legacyEnvelope = { ...envelope };
    delete legacyEnvelope.version;
    delete legacyEnvelope.provider;
    expect(await rotated.decrypt(legacyEnvelope, 'tenant', 'connection')).toBe(
      'fixture-token',
    );
    expect(
      (await rotated.encrypt('replacement', 'tenant', 'connection')).keyId,
    ).toBe('current');
    const corrupted = Buffer.from(envelope.ciphertext, 'base64url');
    corrupted[0] ^= 1;
    await expect(
      rotated.decrypt(
        { ...envelope, ciphertext: corrupted.toString('base64url') },
        'tenant',
        'connection',
      ),
    ).rejects.toThrow('Credential authentication failed');
    await expect(
      rotated.decrypt(envelope, 'other', 'connection'),
    ).rejects.toThrow();
    await expect(
      rotated.decrypt(envelope, 'tenant', 'other'),
    ).rejects.toThrow();
    expect(() => cipher('missing')).toThrow('Invalid WHATSAPP_CREDENTIAL');
  });

  it('uses tenant-bound AWS KMS envelope encryption without storing plaintext keys', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      WHATSAPP_KEY_PROVIDER: 'aws_kms',
      WHATSAPP_KMS_KEY_ARN:
        'arn:aws:kms:eu-west-1:123456789012:key/11111111-1111-4111-8111-111111111111',
      AWS_REGION: 'eu-west-1',
    });
    const instance = new CredentialCipher();
    const key = randomBytes(32);
    let encryptionContext: Record<string, string> | undefined;
    const send = jest.fn(
      async (command: {
        constructor: { name: string };
        input: Record<string, unknown>;
      }) => {
        if (command.constructor.name === 'GenerateDataKeyCommand') {
          encryptionContext = command.input.EncryptionContext as Record<
            string,
            string
          >;
          return {
            Plaintext: Uint8Array.from(key),
            CiphertextBlob: Uint8Array.from(Buffer.from('wrapped-key')),
          };
        }
        if (
          JSON.stringify(command.input.EncryptionContext) !==
          JSON.stringify(encryptionContext)
        )
          throw new Error('encryption context mismatch');
        return { Plaintext: Uint8Array.from(key) };
      },
    );
    Object.defineProperty(instance, 'kmsClient', { value: { send } });

    const envelope = await instance.encrypt(
      'fixture-token',
      'tenant',
      'connection',
    );
    expect(envelope).toMatchObject({ version: 2, provider: 'aws_kms' });
    expect(envelope.wrappedKey).toBeTruthy();
    expect(JSON.stringify(envelope)).not.toContain('fixture-token');
    expect(await instance.decrypt(envelope, 'tenant', 'connection')).toBe(
      'fixture-token',
    );
    await expect(
      instance.decrypt(envelope, 'other', 'connection'),
    ).rejects.toThrow('Credential authentication failed');
  });
});
