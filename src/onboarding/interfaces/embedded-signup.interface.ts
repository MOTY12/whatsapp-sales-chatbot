export interface EmbeddedSignupResult {
  wabaId: string;
  phoneNumberId: string;
}

export interface EmbeddedSignupPort {
  startEmbeddedSignup(
    ownerWhatsappId: string,
    businessId: string,
  ): Promise<EmbeddedSignupResult>;
}