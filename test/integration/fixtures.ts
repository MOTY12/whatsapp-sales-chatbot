import { DataSource } from 'typeorm';
import {
  AssistantSession,
  Business,
  Conversation,
  Customer,
  FollowUp,
  Message,
  Sale,
  User,
} from '../../src/database/entities';
import { AssistantStateService } from '../../src/assistant/assistant-state.service';
import { AssistantSessionRepository } from '../../src/database/repositories/assistant-session.repository';
import { ConversationRepository } from '../../src/database/repositories/conversation.repository';
import { CustomerRepository } from '../../src/database/repositories/customer.repository';
import { FollowUpRepository } from '../../src/database/repositories/follow-up.repository';
import { MessageRepository } from '../../src/database/repositories/message.repository';
import { SaleRepository } from '../../src/database/repositories/sale.repository';

export const fixtureDueDate = new Date('2030-06-01T12:00:00Z');

export function repositories(source: DataSource) {
  return {
    customers: new CustomerRepository(source.getRepository(Customer)),
    conversations: new ConversationRepository(
      source.getRepository(Conversation),
    ),
    messages: new MessageRepository(source.getRepository(Message)),
    followUps: new FollowUpRepository(source.getRepository(FollowUp)),
    sales: new SaleRepository(source.getRepository(Sale)),
    assistantState: new AssistantStateService(
      new AssistantSessionRepository(source.getRepository(AssistantSession)),
    ),
  };
}

export async function seedTenant(source: DataSource, number: 1 | 2) {
  const business = await source.getRepository(Business).save({
    name: 'Integration Shop',
    phone: `234810000000${number}`,
    whatsappNumber: `234810000000${number}`,
    timezone: 'Africa/Lagos',
  });
  const owner = await source.getRepository(User).save({
    businessId: business.id,
    email: 'owner@example.test',
    firstName: 'Owner',
    password: 'fixture',
    whatsappId: `234820000000${number}`,
    roles: ['owner'],
  });
  const repo = repositories(source);
  const customer = await repo.customers.create({
    businessId: business.id,
    ownerId: owner.id,
    name: 'Ada Customer',
    phone: '2348300000000',
    whatsappId: '2348300000000',
  });
  const conversation = await repo.conversations.create({
    businessId: business.id,
    customerId: customer.id,
    status: 'open',
  });
  const message = await repo.messages.create({
    businessId: business.id,
    conversationId: conversation.id,
    direction: 'inbound',
    content: `Tenant ${number} text`,
    whatsappMessageId: `fixture-message-${number}`,
  });
  const followUp = await repo.followUps.create({
    businessId: business.id,
    ownerId: owner.id,
    customerId: customer.id,
    dueDate: fixtureDueDate,
    title: 'Call Ada',
  });
  const sale = await repo.sales.create({
    businessId: business.id,
    ownerId: owner.id,
    customerId: customer.id,
    amount: 2000,
    product: 'Test product',
  });
  return { business, owner, customer, conversation, message, followUp, sale };
}
