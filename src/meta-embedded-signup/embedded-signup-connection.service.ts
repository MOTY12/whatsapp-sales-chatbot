import { Injectable } from '@nestjs/common';
import { EmbeddedSignupConnection } from './types/meta-embedded-signup.types';
import { BusinessRepository } from '../database/repositories/business.repository';

@Injectable()
export class EmbeddedSignupConnectionService {
  constructor(private readonly businessRepository: BusinessRepository) {}

  async saveEmbeddedSignupConnection(
    connection: EmbeddedSignupConnection,
  ): Promise<EmbeddedSignupConnection> {
    const business = await this.businessRepository.update(
      connection.businessId,
      {
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber ?? null,
        accessToken: connection.accessToken,
        connectedAt: new Date(connection.connectedAt),
        status: connection.status === 'connected' ? 'active' : 'inactive',
      },
    );

    if (!business) {
      throw new Error(
        'The business for this WhatsApp connection no longer exists.',
      );
    }

    return connection;
  }

  async getEmbeddedSignupConnection(
    businessId: string,
  ): Promise<EmbeddedSignupConnection | undefined> {
    const business = await this.businessRepository.findById(businessId);
    if (
      !business?.phoneNumberId ||
      !business.accessToken ||
      !business.wabaId ||
      !business.connectedAt
    ) {
      return undefined;
    }

    return {
      businessId,
      ownerWhatsappId: String(business.config?.ownerWhatsappId ?? ''),
      wabaId: business.wabaId,
      phoneNumberId: business.phoneNumberId,
      displayPhoneNumber: business.displayPhoneNumber ?? undefined,
      accessToken: business.accessToken,
      connectedAt: business.connectedAt.toISOString(),
      status: 'connected',
    };
  }
}
