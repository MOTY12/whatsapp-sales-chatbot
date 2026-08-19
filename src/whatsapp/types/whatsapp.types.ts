export type OnboardingStep =
  | 'IDLE'
  | 'ASK_REGISTER'
  | 'ASK_BUSINESS_NAME'
  | 'ASK_INDUSTRY'
  | 'ASK_PHONE'
  | 'ASK_TIMEZONE'
  | 'ASK_CONNECT_WHATSAPP'
  | 'WAITING_FOR_EMBEDDED_SIGNUP'
  | 'ASK_LOGO'
  | 'ASK_DESCRIPTION'
  | 'ASK_OPENING_HOURS'
  | 'DONE';

export interface IncomingWhatsAppMessage {
  from: string;
  message: string;
  type: string;
}

export interface OutgoingWhatsAppMessage {
  to: string;
  message: string;
}

export interface BusinessOwner {
  id: string;
  whatsapp_id: string;
  business_ids: string[];
  created_at: string;
}

export interface BusinessProfile {
  logoUploaded: boolean;
  description?: string;
  openingHours?: string;
}

export interface Business {
  id: string;
  name: string;
  industry: string;
  phone: string;
  whatsapp_number: string;
  timezone: string;
  owner_whatsapp_id: string;
  status: 'active';
  created_at: string;
}

export interface ConversationState {
  whatsappId: string;
  step: OnboardingStep;
  draftBusiness: Partial<Business>;
  profile: Partial<BusinessProfile>;
  businessId?: string;
  ownerId?: string;
  connectionChoice?: 'connect' | 'current';
}