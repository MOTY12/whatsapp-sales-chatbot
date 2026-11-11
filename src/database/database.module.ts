import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './options';
import { databaseEntities } from './schema';
import { BusinessRepository } from './repositories/business.repository';
import { UserRepository } from './repositories/user.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { FollowUpRepository } from './repositories/follow-up.repository';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { OnboardingSessionRepository } from './repositories/onboarding-session.repository';
import { AssistantSessionRepository } from './repositories/assistant-session.repository';
import { SaleRepository } from './repositories/sale.repository';

const repositories = [
  BusinessRepository,
  UserRepository,
  CustomerRepository,
  FollowUpRepository,
  ConversationRepository,
  MessageRepository,
  OnboardingSessionRepository,
  AssistantSessionRepository,
  SaleRepository,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    TypeOrmModule.forFeature(databaseEntities),
  ],
  providers: repositories,
  exports: [TypeOrmModule, ...repositories],
})
export class DatabaseModule {}
