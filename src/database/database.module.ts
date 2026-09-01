import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from './entities/business.entity';
import { User } from './entities/user.entity';
import { Customer } from './entities/customer.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { PipelineStage } from './entities/pipeline-stage.entity';
import { FollowUp } from './entities/follow-up.entity';
import { Task } from './entities/task.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Notification } from './entities/notification.entity';
import { BusinessRepository } from './repositories/business.repository';
import { UserRepository } from './repositories/user.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { FollowUpRepository } from './repositories/follow-up.repository';

const entities = [
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
];

const repositories = [
  BusinessRepository,
  UserRepository,
  CustomerRepository,
  FollowUpRepository,
];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME || 'kleva_db',
      entities: entities,
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.DATABASE_LOGGING === 'true',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: repositories,
  exports: [TypeOrmModule, ...repositories],
})
export class DatabaseModule {}

