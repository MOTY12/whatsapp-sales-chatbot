export interface ChannelAsset {
  provider: string;
  externalAssetId: string;
}

export interface ResolvedChannel extends ChannelAsset {
  businessId: string;
  connectionId: string | null;
  externalAccountId: string | null;
  source: 'connection' | 'legacy';
}

export interface ChannelConnectionResolver {
  resolve(asset: ChannelAsset): Promise<ResolvedChannel | null>;
}

export interface ProviderMessageIdentifier extends ChannelAsset {
  externalMessageId: string;
}

interface ChannelEvent extends ProviderMessageIdentifier {
  externalAccountId?: string;
  occurredAt?: Date;
}

export interface InboundChannelMessage extends ChannelEvent {
  kind: 'message';
  externalSenderId: string;
  text: string;
}

export interface ChannelDeliveryStatus extends ChannelEvent {
  kind: 'delivery';
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: ChannelProviderError;
}

export interface OutboundChannelMessage {
  connectionId: string;
  externalRecipientId: string;
  text: string;
}

export interface ChannelProviderError {
  code: string;
}

export interface ChannelAdapter {
  readonly provider: string;
  normalize(
    payload: unknown,
  ): (InboundChannelMessage | ChannelDeliveryStatus)[];
}
