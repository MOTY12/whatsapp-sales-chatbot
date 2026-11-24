import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { aiConfig, applicationEnvironment } from '../config/env';

export const websiteAiResponseOperation = 'website.ai_response';
export const websiteDeliveryOperation = 'website.delivery';
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const idempotencyUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WebsiteWidgetConfiguration = {
  primaryColor: string;
  logoUrl: string | null;
  assistantName: string;
  welcomeMessage: string;
  position: 'bottom-right' | 'bottom-left';
  theme: 'light' | 'dark';
  suggestedQuestions: string[];
  collectContact: boolean;
  requireContact: boolean;
  privacyNotice: string;
  offlineMessage: string;
  businessHours: {
    enabled: boolean;
    daysOfWeek: number[];
    opensAt: string;
    closesAt: string;
  };
};

const defaults: WebsiteWidgetConfiguration = {
  primaryColor: '#2563eb',
  logoUrl: null,
  assistantName: 'Kleva Assistant',
  welcomeMessage: 'Hi! How can we help you today?',
  position: 'bottom-right',
  theme: 'light',
  suggestedQuestions: [],
  collectContact: false,
  requireContact: false,
  privacyNotice: 'Your messages may be processed by an AI assistant.',
  offlineMessage:
    'We are currently away. Leave us a message and we will follow up.',
  businessHours: {
    enabled: false,
    daysOfWeek: [1, 2, 3, 4, 5],
    opensAt: '09:00',
    closesAt: '17:00',
  },
};

type SessionContext = {
  session_id: string;
  business_id: string;
  widget_id: string;
  public_id: string;
  visitor_id: string;
  customer_id: string;
  conversation_id: string;
  origin: string;
  configuration: WebsiteWidgetConfiguration;
  ai_enabled: boolean;
  business_name: string;
  assistant_name: string;
  contact_consent_at: Date | string | null;
};

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function validText(value: unknown, max: number, min = 1): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= min &&
    value.length <= max &&
    !value.includes('\0')
  );
}

export function normalizeWebsiteWidgetConfiguration(
  value: unknown,
): WebsiteWidgetConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return defaults;
  const input = value as Record<string, unknown>;
  const allowed = new Set(Object.keys(defaults));
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new BadRequestException('Widget appearance has unsupported fields.');
  const result: WebsiteWidgetConfiguration = { ...defaults };
  result.businessHours = {
    ...defaults.businessHours,
    daysOfWeek: [...defaults.businessHours.daysOfWeek],
  };
  if (input.primaryColor !== undefined) {
    if (
      typeof input.primaryColor !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(input.primaryColor)
    )
      throw new BadRequestException('Choose a valid hex brand color.');
    result.primaryColor = input.primaryColor;
  }
  if (input.logoUrl !== undefined && input.logoUrl !== null) {
    if (typeof input.logoUrl !== 'string' || input.logoUrl.length > 500)
      throw new BadRequestException('Logo URL must be a secure image URL.');
    let url: URL;
    try {
      url = new URL(input.logoUrl);
    } catch {
      throw new BadRequestException('Logo URL must be a secure image URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new BadRequestException('Logo URL must use HTTPS.');
    result.logoUrl = url.toString();
  }
  if (input.assistantName !== undefined) {
    if (!validText(input.assistantName, 60))
      throw new BadRequestException(
        'Assistant name must be 1 to 60 characters.',
      );
    result.assistantName = input.assistantName.trim();
  }
  for (const key of [
    'welcomeMessage',
    'privacyNotice',
    'offlineMessage',
  ] as const) {
    if (input[key] !== undefined) {
      if (!validText(input[key], key === 'welcomeMessage' ? 500 : 300))
        throw new BadRequestException(`${key} is too long or empty.`);
      result[key] = input[key].trim();
    }
  }
  if (input.position !== undefined) {
    if (input.position !== 'bottom-left' && input.position !== 'bottom-right')
      throw new BadRequestException('Choose a valid launcher position.');
    result.position = input.position;
  }
  if (input.theme !== undefined) {
    if (input.theme !== 'light' && input.theme !== 'dark')
      throw new BadRequestException('Choose a valid appearance theme.');
    result.theme = input.theme;
  }
  if (input.suggestedQuestions !== undefined) {
    if (
      !Array.isArray(input.suggestedQuestions) ||
      input.suggestedQuestions.length > 4 ||
      input.suggestedQuestions.some((item) => !validText(item, 120))
    )
      throw new BadRequestException(
        'Add up to four short suggested questions.',
      );
    result.suggestedQuestions = input.suggestedQuestions.map((item) =>
      (item as string).trim(),
    );
  }
  for (const key of ['collectContact', 'requireContact'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean')
        throw new BadRequestException(
          'Contact settings must be enabled or disabled.',
        );
      result[key] = input[key];
    }
  }
  if (input.businessHours !== undefined) {
    if (
      !input.businessHours ||
      typeof input.businessHours !== 'object' ||
      Array.isArray(input.businessHours)
    )
      throw new BadRequestException('Business hours settings are invalid.');
    const hours = input.businessHours as Record<string, unknown>;
    if (
      Object.keys(hours).some(
        (key) =>
          !['enabled', 'daysOfWeek', 'opensAt', 'closesAt'].includes(key),
      ) ||
      typeof hours.enabled !== 'boolean' ||
      !Array.isArray(hours.daysOfWeek) ||
      hours.daysOfWeek.length > 7 ||
      hours.daysOfWeek.some(
        (day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6,
      ) ||
      new Set(hours.daysOfWeek).size !== hours.daysOfWeek.length ||
      typeof hours.opensAt !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.opensAt) ||
      typeof hours.closesAt !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.closesAt) ||
      hours.opensAt >= hours.closesAt
    )
      throw new BadRequestException('Business hours settings are invalid.');
    result.businessHours = {
      enabled: hours.enabled,
      daysOfWeek: [...(hours.daysOfWeek as number[])].sort((a, b) => a - b),
      opensAt: hours.opensAt,
      closesAt: hours.closesAt,
    };
  }
  if (result.requireContact && !result.collectContact)
    throw new BadRequestException(
      'Required contact collection must also be enabled.',
    );
  return result;
}

export function normalizeWebsiteOrigin(
  value: string | undefined,
  production = applicationEnvironment() === 'production',
): string {
  if (!value || value.length > 300)
    throw new ForbiddenException('Website origin is not authorized.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ForbiddenException('Website origin is not authorized.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.origin === 'null' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(local && !production && url.protocol === 'http:'))
  )
    throw new ForbiddenException('Website origin is not authorized.');
  return url.origin.toLowerCase();
}

export function isWebsiteOriginAllowed(
  requestOrigin: string,
  allowedOrigins: readonly string[],
) {
  return allowedOrigins.some((allowed) => allowed === requestOrigin);
}

export function isWebsiteBusinessOpen(
  schedule: WebsiteWidgetConfiguration['businessHours'],
  timezone: string,
  at = new Date(),
) {
  if (!schedule.enabled) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = weekdays.indexOf(value('weekday') ?? '');
    const hour = Number(value('hour'));
    const minute = Number(value('minute'));
    const now = hour * 60 + minute;
    const [openHour, openMinute] = schedule.opensAt.split(':').map(Number);
    const [closeHour, closeMinute] = schedule.closesAt.split(':').map(Number);
    const opens = openHour * 60 + openMinute;
    const closes = closeHour * 60 + closeMinute;
    return schedule.daysOfWeek.includes(day) && now >= opens && now < closes;
  } catch {
    return false;
  }
}

export function isWebsiteAiAvailable() {
  try {
    return aiConfig().enabled;
  } catch {
    return false;
  }
}

@Injectable()
export class WebsiteChatService {
  private readonly logger = new Logger(WebsiteChatService.name);
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async publicConfiguration(
    publicId: string,
    originHeader?: string,
    forwardedOrigin?: string,
  ) {
    const origin = normalizeWebsiteOrigin(forwardedOrigin ?? originHeader);
    const [row] = await this.database.query<
      Array<{
        business_id: string;
        widget_id: string;
        public_id: string;
        business_name: string;
        timezone: string;
        enabled: boolean;
        ai_enabled: boolean;
        configuration: unknown;
        assistant_name: string | null;
      }>
    >(
      `SELECT w.business_id,w.id AS widget_id,w.public_id,b.name AS business_name,b.timezone,w.enabled,w.ai_enabled,w.configuration,
        ac.assistant_name FROM public.website_widgets w JOIN public.businesses b ON b.id=w.business_id
        LEFT JOIN public.assistant_configurations ac ON ac.business_id=w.business_id
        WHERE w.public_id=$1 AND w.enabled AND b.status='active'
          AND EXISTS(SELECT 1 FROM public.website_widget_domains d WHERE d.business_id=w.business_id AND d.widget_id=w.id AND d.origin=$2)`,
      [publicId, origin],
    );
    if (!row) throw new NotFoundException('This chat widget is unavailable.');
    const configuration = normalizeWebsiteWidgetConfiguration(
      row.configuration,
    );
    return {
      widgetId: row.public_id,
      businessName: row.business_name,
      assistantName:
        row.assistant_name?.trim() ||
        normalizeWebsiteWidgetConfiguration(row.configuration).assistantName,
      aiEnabled: row.ai_enabled && isWebsiteAiAvailable(),
      availability: isWebsiteBusinessOpen(
        configuration.businessHours,
        row.timezone,
      )
        ? 'OPEN'
        : 'CLOSED',
      configuration,
    };
  }

  async createSession(
    publicId: string,
    originHeader: string | undefined,
    forwardedOrigin: string | undefined,
    remoteAddress?: string,
  ) {
    const origin = normalizeWebsiteOrigin(forwardedOrigin ?? originHeader);
    const widget = await this.requireWidget(publicId, origin);
    const clientHash = digest(
      `${widget.widget_id}\0${remoteAddress ?? 'unknown'}`,
    );
    await this.consumeRate(clientHash, 6);
    const credential = randomBytes(32).toString('base64url');
    const credentialHash = digest(credential);
    const visitorId = randomUUID();
    const customerId = randomUUID();
    const conversationId = randomUUID();
    const sessionId = randomUUID();
    await this.database.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO public.customers
        (id,"businessId",name,phone,"whatsappId",source,"leadStage","lastInteraction")
        VALUES($1,$2,'Website visitor',NULL,NULL,'website','New Lead',now())`,
        [customerId, widget.business_id],
      );
      await manager.query(
        `INSERT INTO public.website_visitors(business_id,widget_id,id,customer_id)
        VALUES($1,$2,$3,$4)`,
        [widget.business_id, widget.id, visitorId, customerId],
      );
      await manager.query(
        `INSERT INTO public.conversations
        (id,"businessId","customerId",status,channel,website_widget_id,website_visitor_id)
        VALUES($1,$2,$3,'open','WEBSITE',$4,$5)`,
        [conversationId, widget.business_id, customerId, widget.id, visitorId],
      );
      await manager.query(
        `INSERT INTO public.website_visitor_sessions
        (id,business_id,widget_id,visitor_id,conversation_id,credential_hash,origin,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')`,
        [
          sessionId,
          widget.business_id,
          widget.id,
          visitorId,
          conversationId,
          credentialHash,
          origin,
        ],
      );
    });
    return {
      token: credential,
      expiresInSeconds: Math.floor(sessionLifetimeMs / 1000),
    };
  }

  async submitMessage(
    publicId: string,
    token: string,
    originHeader: string | undefined,
    forwardedOrigin: string | undefined,
    body: unknown,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Send a valid chat message.');
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) => !['text', 'idempotencyKey'].includes(key),
      ) ||
      !validText(input.text, 2000) ||
      typeof input.idempotencyKey !== 'string' ||
      !idempotencyUuid.test(input.idempotencyKey)
    )
      throw new BadRequestException(
        'Message must contain 1 to 2000 characters and a valid idempotency key.',
      );
    const session = await this.authenticate(
      publicId,
      token,
      originHeader,
      forwardedOrigin,
    );
    if (session.configuration.requireContact && !session.contact_consent_at)
      throw new ForbiddenException(
        'Share contact details and consent before chatting.',
      );
    const rateHash = digest(
      `message\0${session.widget_id}\0${session.credential_hash}`,
    );
    await this.consumeRate(rateHash, 20);
    const newMessageId = randomUUID();
    const text = input.text.trim();
    const messageId = await this.database.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`website:${session.business_id}:${session.conversation_id}`],
      );
      const [existing] = await manager.query<
        Array<{ id: string; content: string }>
      >(
        `SELECT id,content FROM public.messages
        WHERE "businessId"=$1 AND channel='WEBSITE' AND idempotency_key=$2`,
        [session.business_id, input.idempotencyKey],
      );
      if (existing) {
        if (existing.content !== text)
          throw new BadRequestException('This message key was already used.');
        return existing.id;
      }
      const [message] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO public.messages
        (id,"businessId","conversationId",direction,content,status,channel,external_message_id,idempotency_key,metadata)
        VALUES($1,$2,$3,'inbound',$4,'delivered','WEBSITE',$5,$6,$7) RETURNING id`,
        [
          newMessageId,
          session.business_id,
          session.conversation_id,
          text,
          input.idempotencyKey,
          input.idempotencyKey,
          JSON.stringify({ source: 'website', visitorId: session.visitor_id }),
        ],
      );
      await manager.query(
        `UPDATE public.conversations SET "updatedAt"=now(),status='open'
        WHERE id=$1 AND "businessId"=$2`,
        [session.conversation_id, session.business_id],
      );
      const [lead] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO public.merchant_leads
        (business_id,customer_id,conversation_id,source,status,first_contact_at,last_activity_at)
        VALUES($1,$2,$3,'WEBSITE','NEW',now(),now())
        ON CONFLICT (business_id,conversation_id) DO UPDATE SET last_activity_at=now(),version=merchant_leads.version+1,updated_at=now()
        RETURNING id`,
        [session.business_id, session.customer_id, session.conversation_id],
      );
      await manager.query(
        `INSERT INTO public.merchant_lead_events(business_id,lead_id,event_type,next_status,actor_kind)
        VALUES($1,$2,'CREATED','NEW','SYSTEM') ON CONFLICT DO NOTHING`,
        [session.business_id, lead.id],
      );
      if (session.ai_enabled && isWebsiteAiAvailable()) {
        const [run] = await manager.query<Array<{ id: string }>>(
          `INSERT INTO public.ai_response_runs
          (business_id,inbound_message_id,conversation_id,lead_id,authorized_control_version,channel,website_widget_id)
          SELECT $1,$2,$3,$4,c.control_version,'WEBSITE',$5 FROM public.conversations c
          JOIN public.businesses b ON b.id=c."businessId"
          WHERE c.id=$3 AND c."businessId"=$1 AND c.channel='WEBSITE' AND c.control_mode='AUTO' AND c.status NOT IN ('closed','resolved') AND b.status='active'
            AND EXISTS(SELECT 1 FROM public.website_widgets w WHERE w.id=$5 AND w.business_id=$1 AND w.enabled AND w.ai_enabled)
            AND EXISTS(SELECT 1 FROM public.assistant_configurations ac WHERE ac.business_id=$1)
            AND (EXISTS(SELECT 1 FROM public.knowledge_faqs f WHERE f.business_id=$1 AND f.published_revision_id IS NOT NULL)
              OR EXISTS(SELECT 1 FROM public.merchant_products p WHERE p.business_id=$1 AND p.published_revision_id IS NOT NULL))
          ON CONFLICT (business_id,inbound_message_id) DO NOTHING RETURNING id`,
          [
            session.business_id,
            message.id,
            session.conversation_id,
            lead.id,
            session.widget_id,
          ],
        );
        if (run)
          await manager.query(
            `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
          VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
            [
              run.id,
              session.business_id,
              websiteAiResponseOperation,
              JSON.stringify({ aiResponseRunId: run.id }),
            ],
          );
      }
      await manager.query(
        `UPDATE public.website_visitor_sessions SET last_seen_at=now()
        WHERE id=$1 AND business_id=$2`,
        [session.session_id, session.business_id],
      );
      return message.id;
    });
    return {
      accepted: true,
      messageId,
      aiEnabled: session.ai_enabled && isWebsiteAiAvailable(),
    };
  }

  async messages(
    publicId: string,
    token: string,
    originHeader?: string,
    forwardedOrigin?: string,
    after?: string,
  ) {
    const session = await this.authenticate(
      publicId,
      token,
      originHeader,
      forwardedOrigin,
    );
    let cursor: { at: string; id: string } | null = null;
    if (after) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(after, 'base64url').toString(),
        );
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          typeof (parsed as { at?: unknown }).at !== 'string' ||
          typeof (parsed as { id?: unknown }).id !== 'string' ||
          !Number.isFinite(Date.parse((parsed as { at: string }).at)) ||
          !/^[0-9a-f-]{36}$/i.test((parsed as { id: string }).id)
        )
          throw new Error();
        cursor = {
          at: new Date((parsed as { at: string }).at).toISOString(),
          id: (parsed as { id: string }).id,
        };
      } catch {
        throw new BadRequestException('Invalid message cursor.');
      }
    }
    const rows = await this.database.query<
      Array<{
        id: string;
        direction: string;
        content: string;
        status: string;
        created_at: Date;
      }>
    >(
      `SELECT id,direction,content,status,"createdAt" AS created_at
       FROM public.messages WHERE "businessId"=$1 AND "conversationId"=$2 AND channel='WEBSITE'
         AND ($3::timestamptz IS NULL OR ("createdAt",id)>($3,$4::uuid))
       ORDER BY "createdAt",id LIMIT 100`,
      [
        session.business_id,
        session.conversation_id,
        cursor?.at ?? null,
        cursor?.id ?? null,
      ],
    );
    const items = rows.map(
      ({ id, direction, content, status, created_at }) => ({
        id,
        direction,
        content,
        status,
        createdAt: created_at,
      }),
    );
    const last = items.at(-1);
    return {
      items,
      nextCursor: last
        ? Buffer.from(
            JSON.stringify({
              at: new Date(last.createdAt).toISOString(),
              id: last.id,
            }),
          ).toString('base64url')
        : (after ?? null),
      conversationStatus: await this.conversationStatus(session),
      contactSaved: Boolean(session.contact_consent_at),
    };
  }

  async submitContact(
    publicId: string,
    token: string,
    originHeader: string | undefined,
    forwardedOrigin: string | undefined,
    body: unknown,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Provide contact details.');
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) => !['name', 'email', 'phone', 'consent'].includes(key),
      ) ||
      input.consent !== true ||
      (input.name !== undefined && !validText(input.name, 120)) ||
      (input.email !== undefined &&
        (typeof input.email !== 'string' ||
          input.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) ||
      (input.phone !== undefined &&
        (typeof input.phone !== 'string' ||
          !/^\+?[0-9 ()-]{7,32}$/.test(input.phone))) ||
      (!input.name && !input.email && !input.phone)
    )
      throw new BadRequestException(
        'Provide valid contact details and consent.',
      );
    const session = await this.authenticate(
      publicId,
      token,
      originHeader,
      forwardedOrigin,
    );
    if (!session.configuration.collectContact)
      throw new ForbiddenException(
        'Contact collection is disabled for this widget.',
      );
    await this.database.transaction(async (manager) => {
      await manager.query(
        `UPDATE public.customers SET
        name=COALESCE($3,name),email=COALESCE($4,email),phone=COALESCE($5,phone),source='website',"updatedAt"=now()
        WHERE id=$1 AND "businessId"=$2`,
        [
          session.customer_id,
          session.business_id,
          input.name ?? null,
          input.email ?? null,
          input.phone ?? null,
        ],
      );
      await manager.query(
        `UPDATE public.website_visitors SET contact_consent_at=now(),contact_consent_notice=$3
        WHERE id=$1 AND business_id=$2`,
        [
          session.visitor_id,
          session.business_id,
          session.configuration.privacyNotice,
        ],
      );
    });
    return { saved: true };
  }

  async requestHandoff(
    publicId: string,
    token: string,
    originHeader?: string,
    forwardedOrigin?: string,
  ) {
    const session = await this.authenticate(
      publicId,
      token,
      originHeader,
      forwardedOrigin,
    );
    return this.database.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`conversation:${session.business_id}:${session.conversation_id}`],
      );
      const [existing] = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM public.website_handoff_requests
        WHERE business_id=$1 AND conversation_id=$2 AND visitor_id=$3`,
        [session.business_id, session.conversation_id, session.visitor_id],
      );
      if (!existing) {
        await manager.query(
          `INSERT INTO public.website_handoff_requests(business_id,conversation_id,visitor_id)
          VALUES($1,$2,$3)`,
          [session.business_id, session.conversation_id, session.visitor_id],
        );
      }
      await manager.query(
        `UPDATE public.conversations SET control_mode='HUMAN',control_version=control_version+1,
        control_changed_at=now(),"updatedAt"=now() WHERE id=$1 AND "businessId"=$2 AND control_mode='AUTO'`,
        [session.conversation_id, session.business_id],
      );
      return { requested: true };
    });
  }

  async endSession(
    publicId: string,
    token: string,
    originHeader?: string,
    forwardedOrigin?: string,
  ) {
    const session = await this.authenticate(
      publicId,
      token,
      originHeader,
      forwardedOrigin,
    );
    await this.database.query(
      `UPDATE public.website_visitor_sessions SET revoked_at=now()
      WHERE id=$1 AND business_id=$2 AND credential_hash=$3`,
      [session.session_id, session.business_id, session.credential_hash],
    );
    return { ended: true };
  }

  async enqueueAiReply(
    manager: EntityManager,
    input: {
      businessId: string;
      conversationId: string;
      widgetId: string;
      runId: string;
      text: string;
      controlVersion: string | number;
    },
  ) {
    const id = randomUUID();
    const [message] = await manager.query<Array<{ id: string }>>(
      `INSERT INTO public.messages
      (id,"businessId","conversationId",direction,content,status,channel,idempotency_key,metadata)
      VALUES($1,$2,$3,'outbound',$4,'pending','WEBSITE',$5,$6)
      ON CONFLICT ("businessId",channel,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
      [
        id,
        input.businessId,
        input.conversationId,
        input.text,
        input.runId,
        JSON.stringify({
          authorizationKind: 'AI',
          controlVersion: String(input.controlVersion),
        }),
      ],
    );
    if (!message) return id;
    await manager.query(
      `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
      VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
      [
        message.id,
        input.businessId,
        websiteDeliveryOperation,
        JSON.stringify({ messageId: message.id }),
      ],
    );
    return message.id;
  }

  async enqueueHumanReply(
    businessId: string,
    conversationId: string,
    text: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyUuid.test(idempotencyKey) || !validText(text, 4096))
      throw new BadRequestException('A valid reply is required.');
    return this.database.transaction(async (manager) => {
      const [prior] = await manager.query<
        Array<{ id: string; content: string }>
      >(
        `SELECT id,content FROM public.messages
        WHERE "businessId"=$1 AND channel='WEBSITE' AND idempotency_key=$2`,
        [businessId, idempotencyKey],
      );
      if (prior) {
        if (prior.content !== text.trim())
          throw new BadRequestException(
            'This idempotency key was already used.',
          );
        return prior.id;
      }
      const [conversation] = await manager.query<
        Array<{ control_mode: string; control_version: string }>
      >(
        `SELECT control_mode,control_version
        FROM public.conversations WHERE id=$1 AND "businessId"=$2 AND channel='WEBSITE' AND status NOT IN ('closed','resolved') FOR UPDATE`,
        [conversationId, businessId],
      );
      if (!conversation || conversation.control_mode !== 'HUMAN')
        throw new BadRequestException(
          'Take over this conversation before replying.',
        );
      const [message] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO public.messages
        ("businessId","conversationId",direction,content,status,channel,idempotency_key,metadata)
        VALUES($1,$2,'outbound',$3,'pending','WEBSITE',$4,$5) RETURNING id`,
        [
          businessId,
          conversationId,
          text.trim(),
          idempotencyKey,
          JSON.stringify({
            authorizationKind: 'HUMAN',
            controlVersion: conversation.control_version,
          }),
        ],
      );
      await manager.query(
        `INSERT INTO public.outbox_operations(id,"businessId",operation,metadata)
        VALUES($1,$2,$3,$4)`,
        [
          message.id,
          businessId,
          websiteDeliveryOperation,
          JSON.stringify({ messageId: message.id }),
        ],
      );
      return message.id;
    });
  }

  async executeDelivery(messageId: string, businessId: string) {
    await this.database.transaction(async (manager) => {
      const [message] = await manager.query<
        Array<{
          id: string;
          conversation_id: string;
          authorization_kind: string;
          control_version: string;
          status: string;
        }>
      >(
        `SELECT m.id,m."conversationId" AS conversation_id,
        m.metadata->>'authorizationKind' AS authorization_kind,m.metadata->>'controlVersion' AS control_version,m.status
        FROM public.messages m WHERE m.id=$1 AND m."businessId"=$2 AND m.channel='WEBSITE' AND m.direction='outbound' FOR UPDATE`,
        [messageId, businessId],
      );
      if (!message || message.status === 'sent') return;
      const [control] = await manager.query<
        Array<{
          control_mode: string;
          control_version: string;
          status: string;
          widget_enabled: boolean;
        }>
      >(
        `SELECT c.control_mode,c.control_version,c.status,w.enabled AS widget_enabled
        FROM public.conversations c JOIN public.website_widgets w ON w.id=c.website_widget_id AND w.business_id=c."businessId"
        WHERE c.id=$1 AND c."businessId"=$2 FOR UPDATE OF c,w`,
        [message.conversation_id, businessId],
      );
      if (
        !control ||
        !control.widget_enabled ||
        ['closed', 'resolved'].includes(control.status.toLowerCase()) ||
        (message.authorization_kind === 'AI' &&
          (control.control_mode !== 'AUTO' ||
            control.control_version !== message.control_version)) ||
        (message.authorization_kind === 'HUMAN' &&
          control.control_mode !== 'HUMAN')
      ) {
        await manager.query(
          `UPDATE public.messages SET status='failed',metadata=COALESCE(metadata,'{}'::jsonb)||'{"safeFailure":"SUPPRESSED"}'::jsonb WHERE id=$1 AND "businessId"=$2`,
          [messageId, businessId],
        );
        return;
      }
      await manager.query(
        `UPDATE public.messages SET status='sent' WHERE id=$1 AND "businessId"=$2`,
        [messageId, businessId],
      );
      await manager.query(
        `UPDATE public.conversations SET "updatedAt"=now() WHERE id=$1 AND "businessId"=$2`,
        [message.conversation_id, businessId],
      );
    });
  }

  private async authenticate(
    publicId: string,
    token: string,
    originHeader?: string,
    forwardedOrigin?: string,
  ) {
    if (!token || token.length < 40 || token.length > 100)
      throw new ForbiddenException('Visitor session is invalid.');
    const origin = normalizeWebsiteOrigin(forwardedOrigin ?? originHeader);
    const [session] = await this.database.query<SessionContext[]>(
      `SELECT s.id AS session_id,s.business_id,s.widget_id,w.public_id,s.visitor_id,v.customer_id,s.conversation_id,s.origin,
        w.configuration,w.ai_enabled,b.name AS business_name,ac.assistant_name,v.contact_consent_at
      FROM public.website_visitor_sessions s JOIN public.website_widgets w ON w.id=s.widget_id AND w.business_id=s.business_id
      JOIN public.website_visitors v ON v.id=s.visitor_id AND v.business_id=s.business_id AND v.widget_id=s.widget_id
      JOIN public.businesses b ON b.id=s.business_id LEFT JOIN public.assistant_configurations ac ON ac.business_id=s.business_id
      JOIN public.website_widget_domains d ON d.widget_id=w.id AND d.business_id=w.business_id AND d.origin=s.origin
      WHERE w.public_id=$1 AND s.credential_hash=$2 AND s.origin=$3 AND s.revoked_at IS NULL AND s.expires_at>now()
        AND w.enabled AND b.status='active' AND d.origin=$3`,
      [publicId, digest(token), origin],
    );
    if (!session)
      throw new ForbiddenException('Visitor session is invalid or expired.');
    session.configuration = normalizeWebsiteWidgetConfiguration(
      session.configuration,
    );
    return {
      ...session,
      credential_hash: digest(token),
      ai_enabled: session.ai_enabled && isWebsiteAiAvailable(),
    };
  }

  private async requireWidget(publicId: string, origin: string) {
    const [widget] = await this.database.query<
      Array<{ id: string; widget_id: string; business_id: string }>
    >(
      `SELECT w.id,w.id AS widget_id,w.business_id FROM public.website_widgets w
      JOIN public.businesses b ON b.id=w.business_id JOIN public.website_widget_domains d ON d.widget_id=w.id AND d.business_id=w.business_id
      WHERE w.public_id=$1 AND w.enabled AND b.status='active' AND d.origin=$2`,
      [publicId, origin],
    );
    if (!widget)
      throw new NotFoundException('This chat widget is unavailable.');
    return widget;
  }

  private async consumeRate(hash: string, limit: number) {
    const [row] = await this.database.query<Array<{ requests: number }>>(
      `INSERT INTO public.website_rate_limits(bucket_hash,bucket_start,requests)
      VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(bucket_hash,bucket_start) DO UPDATE
      SET requests=website_rate_limits.requests+1 WHERE website_rate_limits.requests<$2 RETURNING requests`,
      [hash, limit],
    );
    if (!row)
      throw new HttpException(
        'Too many chat requests. Please wait and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async conversationStatus(session: SessionContext) {
    const [row] = await this.database.query<
      Array<{ status: string; control_mode: string }>
    >(
      `SELECT status,control_mode FROM public.conversations
      WHERE id=$1 AND "businessId"=$2`,
      [session.conversation_id, session.business_id],
    );
    return row
      ? { status: row.status, controlMode: row.control_mode }
      : { status: 'closed', controlMode: 'HUMAN' };
  }
}
