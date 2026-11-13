import { Injectable } from '@nestjs/common';
import { EmbeddedSignupConnection } from './types/meta-embedded-signup.types';
import { BusinessRepository } from '../database/repositories/business.repository';

@Injectable()
export class EmbeddedSignupConnectionService {
  constructor(private readonly businessRepository: BusinessRepository) {}

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
      connectedAt: business.connectedAt.toISOString(),
      status: 'connected',
    };
  }
}
