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
import { BusinessMember } from './entities/business-member.entity';
import { OutboxOperation } from './entities/outbox-operation.entity';
import { InitialSchema1759999999999 } from './migrations/1759999999999-InitialSchema';
import { AddWebhookPersistence1760000000000 } from './migrations/1760000000000-AddWebhookPersistence';
import { AddAssistantPersistence1760000000001 } from './migrations/1760000000001-AddAssistantPersistence';

import { AddOutboxOperations1760000000002 } from './migrations/1760000000002-AddOutboxOperations';

import { AddTenantIntegrity1760000000003 } from './migrations/1760000000003-AddTenantIntegrity';

import { AddMerchantAuth1760000000004 } from './migrations/1760000000004-AddMerchantAuth';

import { AddMerchantOnboarding1760000000005 } from './migrations/1760000000005-AddMerchantOnboarding';

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
];

export const databaseMigrations = [
  InitialSchema1759999999999,
  AddWebhookPersistence1760000000000,
  AddAssistantPersistence1760000000001,
  AddOutboxOperations1760000000002,
  AddTenantIntegrity1760000000003,
  AddMerchantAuth1760000000004,
  AddMerchantOnboarding1760000000005,
];
