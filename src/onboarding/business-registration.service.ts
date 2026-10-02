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
    const existingOwner = await this.userRepository.findByWhatsappId(
      input.ownerWhatsappId,
    );
    if (existingOwner) {
      const existingBusiness = await this.businessRepository.findById(
        existingOwner.businessId,
      );
      if (existingBusiness) {
        return {
          owner: {
            id: existingOwner.id,
            whatsapp_id: input.ownerWhatsappId,
            business_ids: [existingBusiness.id],
            created_at: existingOwner.createdAt.toISOString(),
          },
          business: this.toLegacyBusiness(
            existingBusiness,
            input.ownerWhatsappId,
          ),
        };
      }
    }

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
    const business = this.toLegacyBusiness(dbBusiness, input.ownerWhatsappId);

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

    return this.toLegacyBusiness(
      dbBusiness,
      String(dbBusiness.config?.ownerWhatsappId ?? ''),
    );
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

  async saveProfile(
    businessId: string,
    profile: {
      description?: string;
      openingHours?: string;
      logoUploaded?: boolean;
    },
  ): Promise<void> {
    const business = await this.businessRepository.findById(businessId);
    if (!business) {
      throw new Error('The onboarding business no longer exists.');
    }
    await this.businessRepository.update(businessId, {
      config: { ...business.config, profile },
    });
  }

  private toLegacyBusiness(
    business: {
      id: string;
      name: string;
      industry: string;
      phone: string;
      whatsappNumber: string;
      timezone: string | null;
      createdAt: Date;
    },
    ownerWhatsappId: string,
  ): Business {
    return {
      id: business.id,
      name: business.name,
      industry: business.industry,
      phone: business.phone,
      whatsapp_number: business.whatsappNumber,
      timezone: business.timezone ?? '',
      owner_whatsapp_id: ownerWhatsappId,
      status: 'active',
      created_at: business.createdAt.toISOString(),
    };
  }
}
