export interface MetaEmbeddedSignupStatePayload {
  ownerWhatsappId: string;
  businessId: string;
}

export interface MetaEmbeddedSignupCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_reason?: string;
  error_description?: string;
}

export interface MetaWaba {
  id: string;
  name?: string;
}

export interface MetaPhoneNumber {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface EmbeddedSignupConnection {
  businessId: string;
  ownerWhatsappId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  accessToken: string;
  connectedAt: string;
  status: 'connected';
}

export interface MetaEmbeddedSignupCallbackResult {
  statusCode: number;
  html: string;
}