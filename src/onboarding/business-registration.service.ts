import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EmbeddedSignupPort, EmbeddedSignupResult } from './interfaces/embedded-signup.interface';
import { Business, BusinessOwner } from '../whatsapp/types/whatsapp.types';

interface RegisterBusinessInput {
  ownerWhatsappId: string;
  draftBusiness: Pick<
    Business,
    'name' | 'industry' | 'phone' | 'timezone' | 'whatsapp_number'
  >;
}

@Injectable()
export class BusinessRegistrationService implements EmbeddedSignupPort {
  private readonly businesses = new Map<string, Business>();
  private readonly owners = new Map<string, BusinessOwner>();
  private readonly embeddedSignupConnections = new Map<string, EmbeddedSignupResult>();

  registerBusiness(input: RegisterBusinessInput): {
    owner: BusinessOwner;
    business: Business;
  } {
    const businessId = `biz_${randomUUID().slice(0, 8)}`;
    const ownerId = `owner_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    const business: Business = {
      id: businessId,
      name: input.draftBusiness.name,
      industry: input.draftBusiness.industry,
      phone: input.draftBusiness.phone,
      whatsapp_number: input.draftBusiness.whatsapp_number,
      timezone: input.draftBusiness.timezone,
      owner_whatsapp_id: input.ownerWhatsappId,
      status: 'active',
      created_at: createdAt,
    };

    const owner: BusinessOwner = {
      id: ownerId,
      whatsapp_id: input.ownerWhatsappId,
      business_ids: [businessId],
      created_at: createdAt,
    };

    this.businesses.set(businessId, business);
    this.owners.set(ownerId, owner);

    return { owner, business };
  }

  async startEmbeddedSignup(
    _ownerWhatsappId: string,
    businessId: string,
  ): Promise<EmbeddedSignupResult> {
    const result: EmbeddedSignupResult = {
      wabaId: 'mock_waba_id',
      phoneNumberId: 'mock_phone_number_id',
    };

    this.embeddedSignupConnections.set(businessId, result);

    return result;
  }

  getBusinessById(businessId: string): Business | undefined {
    return this.businesses.get(businessId);
  }

  getOwnerByWhatsappId(whatsappId: string): BusinessOwner | undefined {
    return [...this.owners.values()].find((owner) => owner.whatsapp_id === whatsappId);
  }

  getEmbeddedSignupConnection(businessId: string): EmbeddedSignupResult | undefined {
    return this.embeddedSignupConnections.get(businessId);
  }
}