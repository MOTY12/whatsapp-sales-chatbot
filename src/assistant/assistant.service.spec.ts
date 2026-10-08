/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';
import { AssistantSessionRepository } from '../database/repositories/assistant-session.repository';
import { CustomerRepository } from '../database/repositories/customer.repository';
import { FollowUpRepository } from '../database/repositories/follow-up.repository';
import { SaleRepository } from '../database/repositories/sale.repository';
import { businessDayRange } from './business-date-range';

describe('AssistantService persistence', () => {
  let assistant: AssistantService;
  const sessions = new Map<string, any>();
  const customers = new Map<string, any>();
  const followUps: any[] = [];
  const sales: any[] = [];
  const context = {
    businessId: 'business-a',
    ownerId: 'owner-a',
    timezone: 'Africa/Lagos',
  };

  beforeEach(async () => {
    sessions.clear();
    customers.clear();
    followUps.length = 0;
    sales.length = 0;
    const customerRepo = {
      async create(data: any) {
        const customer = {
          id: String(customers.size + 1),
          notes: null,
          ...data,
        };
        customers.set(customer.id, customer);
        return customer;
      },
      async findByNameForOwner(
        name: string,
        businessId: string,
        ownerId: string,
      ) {
        return (
          [...customers.values()].find(
            (customer) =>
              customer.name === name &&
              customer.businessId === businessId &&
              customer.ownerId === ownerId,
          ) ?? null
        );
      },
      async findByPhoneForOwner(
        phone: string,
        businessId: string,
        ownerId: string,
      ) {
        return (
          [...customers.values()].find(
            (customer) =>
              customer.phone === phone &&
              customer.businessId === businessId &&
              customer.ownerId === ownerId,
          ) ?? null
        );
      },
      async findByBusinessAndOwner(businessId: string, ownerId: string) {
        return [...customers.values()].filter(
          (customer) =>
            customer.businessId === businessId && customer.ownerId === ownerId,
        );
      },
      async countByBusinessAndOwner(businessId: string, ownerId: string) {
        return [...customers.values()].filter(
          (customer) =>
            customer.businessId === businessId && customer.ownerId === ownerId,
        ).length;
      },
      async update(id: string, data: any) {
        const customer = customers.get(id);
        Object.assign(customer, data);
        return customer;
      },
      async updateStage(id: string, leadStage: string) {
        const customer = customers.get(id);
        customer.leadStage = leadStage;
        return customer;
      },
    };
    const sessionRepo = {
      async findByBusinessAndOwner(businessId: string, ownerId: string) {
        return sessions.get(`${businessId}:${ownerId}`) ?? null;
      },
      async save(data: any) {
        const session = { id: 'session', ...data };
        sessions.set(`${data.businessId}:${data.ownerId}`, session);
        return session;
      },
      async clear(businessId: string, ownerId: string) {
        sessions.delete(`${businessId}:${ownerId}`);
      },
    };
    const followUpRepo = {
      async create(data: any) {
        const followUp = { id: String(followUps.length + 1), ...data };
        followUps.push(followUp);
        return followUp;
      },
      async findDueForBusinessAndOwnerInRange(
        businessId: string,
        ownerId: string,
        start: Date,
        end: Date,
      ) {
        return followUps.filter(
          (item) =>
            item.businessId === businessId &&
            item.ownerId === ownerId &&
            item.dueDate >= start &&
            item.dueDate <= end,
        );
      },
      async findOverdueForBusinessAndOwner(
        businessId: string,
        ownerId: string,
        before: Date,
      ) {
        return followUps.filter(
          (item) =>
            item.businessId === businessId &&
            item.ownerId === ownerId &&
            item.dueDate < before,
        );
      },
    };
    const saleRepo = {
      async create(data: any) {
        const sale = { id: String(sales.length + 1), ...data };
        sales.push(sale);
        return sale;
      },
      async findByBusinessAndOwnerForDateRange(
        businessId: string,
        ownerId: string,
        start: Date,
        end: Date,
      ) {
        return sales.filter(
          (item) =>
            item.businessId === businessId &&
            item.ownerId === ownerId &&
            item.createdAt >= start &&
            item.createdAt <= end,
        );
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        AssistantService,
        AssistantCommandParserService,
        AssistantStateService,
        CustomerService,
        ReminderService,
        SalesService,
        { provide: AssistantSessionRepository, useValue: sessionRepo },
        { provide: CustomerRepository, useValue: customerRepo },
        { provide: FollowUpRepository, useValue: followUpRepo },
        { provide: SaleRepository, useValue: saleRepo },
      ],
    }).compile();
    assistant = module.get(AssistantService);
  });

  it('persists a customer and scopes it to the owner business', async () => {
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Create customer', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Alice', type: 'text' },
      context,
    );
    const result = await assistant.handleIncomingMessage(
      { from: 'owner-a', message: '+234 800 000 0000', type: 'text' },
      context,
    );
    expect(result.message).toContain('Customer Alice created');
    expect(customers.get('1')).toMatchObject({
      businessId: 'business-a',
      ownerId: 'owner-a',
      phone: '2348000000000',
    });
  });

  it('does not allow a second owner to resume the first owner command flow', async () => {
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Create customer', type: 'text' },
      context,
    );
    const other = await assistant.handleIncomingMessage(
      { from: 'owner-b', message: 'Alice', type: 'text' },
      { ...context, ownerId: 'owner-b' },
    );
    expect(other.message).toContain("didn't understand");
    expect(sessions.has('business-a:owner-a')).toBe(true);
  });

  it('creates tenant-scoped follow-ups and sales', async () => {
    customers.set('customer-1', {
      id: 'customer-1',
      businessId: context.businessId,
      ownerId: context.ownerId,
      name: 'Alice',
      phone: '234',
      leadStage: 'New Lead',
      notes: null,
    });
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Create reminder tomorrow', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Alice', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Call about delivery', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Record sale', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: 'Shoes', type: 'text' },
      context,
    );
    await assistant.handleIncomingMessage(
      { from: 'owner-a', message: '12000', type: 'text' },
      context,
    );
    expect(followUps[0]).toMatchObject({
      businessId: context.businessId,
      ownerId: context.ownerId,
      customerId: 'customer-1',
    });
    expect(sales[0]).toMatchObject({
      businessId: context.businessId,
      ownerId: context.ownerId,
      amount: 12000,
      product: 'Shoes',
    });
  });

  it('uses a bounded business-local day range', () => {
    const range = businessDayRange(
      new Date('2026-10-07T23:30:00.000Z'),
      'Africa/Lagos',
    );
    expect(range.start.toISOString()).toBe('2026-10-07T23:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-08T22:59:59.999Z');
  });
});
