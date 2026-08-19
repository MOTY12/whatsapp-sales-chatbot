import { Injectable } from '@nestjs/common';
import { EmbeddedSignupConnection } from './types/meta-embedded-signup.types';

@Injectable()
export class EmbeddedSignupConnectionService {
  private readonly connections = new Map<string, EmbeddedSignupConnection>();

  saveEmbeddedSignupConnection(
    connection: EmbeddedSignupConnection,
  ): EmbeddedSignupConnection {
    this.connections.set(connection.businessId, connection);

    return connection;
  }

  getEmbeddedSignupConnection(businessId: string): EmbeddedSignupConnection | undefined {
    return this.connections.get(businessId);
  }
}