import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EmbeddedSignupConnectionService } from '../meta-embedded-signup/embedded-signup-connection.service';
import { EmbeddedSignupConnection } from '../meta-embedded-signup/types/meta-embedded-signup.types';
import { Business, BusinessOwner } from '../whatsapp/types/whatsapp.types';
import { BusinessRepository } from '../database/repositories/business.repository';
import { UserRepository } from '../database/repositories/user.repository';

interface RegisterBusinessInput {
  ownerWhatsappId: string;
  draftBusiness: Pick<
    Business,
    'name' | 'industry' | 'phone' | 'timezone' | 'whatsapp_number'
  >;
}

@Injectable()
export class BusinessRegistrationService {
  constructor(
    private readonly embeddedSignupConnectionService: EmbeddedSignupConnectionService,
    private readonly businessRepository: BusinessRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async registerBusiness(input: RegisterBusinessInput): Promise<{
    owner: BusinessOwner;
    business: Business;
  }> {
    const businessId = randomUUID();
    const ownerId = randomUUID();
    const createdAt = new Date().toISOString();

    // Create Business in database
    const dbBusiness = await this.businessRepository.create({
      id: businessId,
      name: input.draftBusiness.name,
      industry: input.draftBusiness.industry,
      phone: input.draftBusiness.phone,
      whatsappNumber: input.draftBusiness.whatsapp_number,
      phoneNumberId: null,
      accessToken: null,
      timezone: input.draftBusiness.timezone,
      status: 'active',
      config: { ownerWhatsappId: input.ownerWhatsappId },
    });

    // Create User (owner) in database
    const ownerEmail = `owner_${input.ownerWhatsappId}@kleva.local`;
    const dbUser = await this.userRepository.create({
      id: ownerId,
      email: ownerEmail,
      password: '', // Can be set later
      firstName: 'Owner',
      whatsappId: input.ownerWhatsappId,
      businessId: businessId,
      status: 'active',
      roles: ['owner'],
      metadata: { whatsappId: input.ownerWhatsappId },
    });

    // Return in legacy format for backward compatibility
    const business: Business = {
      id: dbBusiness.id,
      name: dbBusiness.name,
      industry: dbBusiness.industry,
      phone: dbBusiness.phone,
      whatsapp_number: dbBusiness.whatsappNumber,
      timezone: dbBusiness.timezone ?? '',
      owner_whatsapp_id: input.ownerWhatsappId,
      status: 'active',
      created_at: createdAt,
    };

    const owner: BusinessOwner = {
      id: dbUser.id,
      whatsapp_id: input.ownerWhatsappId,
      business_ids: [businessId],
      created_at: createdAt,
    };

    return { owner, business };
  }

  async getBusinessById(businessId: string): Promise<Business | undefined> {
    const dbBusiness = await this.businessRepository.findById(businessId);
    if (!dbBusiness) return undefined;

    return {
      id: dbBusiness.id,
      name: dbBusiness.name,
      industry: dbBusiness.industry,
      phone: dbBusiness.phone,
      whatsapp_number: dbBusiness.whatsappNumber,
      timezone: dbBusiness.timezone ?? '',
      owner_whatsapp_id: dbBusiness.config?.ownerWhatsappId || '',
      status: 'active',
      created_at: dbBusiness.createdAt.toISOString(),
    };
  }

  async getOwnerByWhatsappId(
    whatsappId: string,
  ): Promise<BusinessOwner | undefined> {
    const user = await this.userRepository.findByWhatsappId(whatsappId);
    if (!user) return undefined;

    return {
      id: user.id,
      whatsapp_id: whatsappId,
      business_ids: [user.businessId],
      created_at: user.createdAt.toISOString(),
    };
  }

  async saveEmbeddedSignupConnection(
    connection: EmbeddedSignupConnection,
  ): Promise<EmbeddedSignupConnection> {
    return this.embeddedSignupConnectionService.saveEmbeddedSignupConnection(
      connection,
    );
  }

  async getEmbeddedSignupConnection(
    businessId: string,
  ): Promise<EmbeddedSignupConnection | undefined> {
    return this.embeddedSignupConnectionService.getEmbeddedSignupConnection(
      businessId,
    );
  }
}
