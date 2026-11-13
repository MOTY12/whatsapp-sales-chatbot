import type {
  ChannelAdapter,
  ChannelDeliveryStatus,
  InboundChannelMessage,
  ProviderMessageIdentifier,
} from '../../channel.contracts';

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((item) => item !== undefined)
    : [];
}

function timestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const date = new Date(Number(value) * 1000);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly provider = 'whatsapp';

  // The caller supplies a signature-verified Meta envelope.
  normalize(payload: unknown) {
    const events: (InboundChannelMessage | ChannelDeliveryStatus)[] = [];
    if (record(payload)?.object !== 'whatsapp_business_account') return events;
    for (const entry of records(record(payload)?.entry)) {
      for (const change of records(entry.changes)) {
        if (change.field !== 'messages') continue;
        const value = record(change.value);
        const externalAssetId = record(value?.metadata)?.phone_number_id;
        if (typeof externalAssetId !== 'string' || !externalAssetId) continue;

        for (const message of records(value?.messages)) {
          const text = record(message.text)?.body;
          if (
            message.type !== 'text' ||
            typeof text !== 'string' ||
            !text ||
            typeof message.id !== 'string' ||
            !message.id ||
            typeof message.from !== 'string' ||
            !message.from
          )
            continue;
          events.push({
            ...this.messageId(externalAssetId, message.id),
            kind: 'message',
            externalSenderId: message.from,
            text,
            occurredAt: timestamp(message.timestamp),
          });
        }
        for (const receipt of records(value?.statuses)) {
          const status = receipt.status;
          if (
            typeof receipt.id !== 'string' ||
            !receipt.id ||
            (status !== 'sent' &&
              status !== 'delivered' &&
              status !== 'read' &&
              status !== 'failed')
          )
            continue;
          const code = records(receipt.errors)[0]?.code;
          events.push({
            ...this.messageId(externalAssetId, receipt.id),
            kind: 'delivery',
            status,
            occurredAt: timestamp(receipt.timestamp),
            ...(status === 'failed' &&
            typeof code === 'number' &&
            Number.isSafeInteger(code)
              ? { error: { code: String(code) } }
              : {}),
          });
        }
      }
    }
    return events;
  }

  private messageId(
    externalAssetId: string,
    externalMessageId: string,
  ): ProviderMessageIdentifier {
    return { provider: this.provider, externalAssetId, externalMessageId };
  }
}
