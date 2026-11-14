import {
  AuditLog,
  AssistantSession,
  Business,
  Conversation,
  Customer,
  FollowUp,
  Message,
  Notification,
  OnboardingSession,
  PipelineStage,
  Sale,
  Task,
  User,
} from './entities';
import { Account } from './entities/account.entity';
import { ChannelConnection } from './entities/channel-connection.entity';
import { BusinessMember } from './entities/business-member.entity';
import { OutboxOperation } from './entities/outbox-operation.entity';
import { InitialSchema1759999999999 } from './migrations/1759999999999-InitialSchema';
import { AddWebhookPersistence1760000000000 } from './migrations/1760000000000-AddWebhookPersistence';
import { AddAssistantPersistence1760000000001 } from './migrations/1760000000001-AddAssistantPersistence';

import { AddOutboxOperations1760000000002 } from './migrations/1760000000002-AddOutboxOperations';

import { AddTenantIntegrity1760000000003 } from './migrations/1760000000003-AddTenantIntegrity';

import { AddMerchantAuth1760000000004 } from './migrations/1760000000004-AddMerchantAuth';

import { AddMerchantOnboarding1760000000005 } from './migrations/1760000000005-AddMerchantOnboarding';

import { AddChannelConnections1760000000006 } from './migrations/1760000000006-AddChannelConnections';

import { SecureWhatsAppCredentials1760000000007 } from './migrations/1760000000007-SecureWhatsAppCredentials';

import { AddWebhookReceipts1760000000008 } from './migrations/1760000000008-AddWebhookReceipts';
import { ProcessWhatsAppReceipts1760000000009 } from './migrations/1760000000009-ProcessWhatsAppReceipts';
import { AddTenantUsageLedger1760000000010 } from './migrations/1760000000010-AddTenantUsageLedger';

export const databaseEntities = [
  Business,
  User,
  Customer,
  Conversation,
  Message,
  PipelineStage,
  FollowUp,
  Task,
  AuditLog,
  Notification,
  OnboardingSession,
  AssistantSession,
  Sale,
  OutboxOperation,
  Account,
  BusinessMember,
  ChannelConnection,
];

export const databaseMigrations = [
  InitialSchema1759999999999,
  AddWebhookPersistence1760000000000,
  AddAssistantPersistence1760000000001,
  AddOutboxOperations1760000000002,
  AddTenantIntegrity1760000000003,
  AddMerchantAuth1760000000004,
  AddMerchantOnboarding1760000000005,
  AddChannelConnections1760000000006,
  SecureWhatsAppCredentials1760000000007,
  AddWebhookReceipts1760000000008,
  ProcessWhatsAppReceipts1760000000009,
  AddTenantUsageLedger1760000000010,
];
