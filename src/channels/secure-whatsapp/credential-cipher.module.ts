import { Module } from '@nestjs/common';
import { CredentialCipher } from './credential-cipher';

@Module({ providers: [CredentialCipher], exports: [CredentialCipher] })
export class CredentialCipherModule {}
