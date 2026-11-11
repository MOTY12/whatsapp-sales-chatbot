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
import { InitialSchema1759999999999 } from './migrations/1759999999999-InitialSchema';
import { AddWebhookPersistence1760000000000 } from './migrations/1760000000000-AddWebhookPersistence';
import { AddAssistantPersistence1760000000001 } from './migrations/1760000000001-AddAssistantPersistence';

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
];

export const databaseMigrations = [
  InitialSchema1759999999999,
  AddWebhookPersistence1760000000000,
  AddAssistantPersistence1760000000001,
];
