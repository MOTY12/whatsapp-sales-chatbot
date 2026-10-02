import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  AuditLog,
  Business,
  Conversation,
  Customer,
  FollowUp,
  Message,
  Notification,
  OnboardingSession,
  PipelineStage,
  Task,
  User,
} from './entities';
import { InitialSchema1759999999999 } from './migrations/1759999999999-InitialSchema';
import { AddWebhookPersistence1760000000000 } from './migrations/1760000000000-AddWebhookPersistence';

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 5432),
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME || 'kleva_db',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  synchronize: false,
  entities: [
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
  ],
  migrations: [
    InitialSchema1759999999999,
    AddWebhookPersistence1760000000000,
  ],
});
