import { Injectable } from '@nestjs/common';
import {
  IncomingWhatsAppMessage,
  OutgoingWhatsAppMessage,
} from '../whatsapp/types/whatsapp.types';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import {
  AssistantContext,
  AssistantPendingFlow,
} from './types/assistant.types';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';
import { nextBusinessDayStart } from './business-date-range';
import { CustomerLeadStage } from '../database/entities/customer.entity';

const STAGES: CustomerLeadStage[] = [
  'New Lead',
  'Interested',
  'Negotiating',
  'Paid',
  'Delivered',
  'Lost',
];

@Injectable()
export class AssistantService {
  constructor(
    private readonly parser: AssistantCommandParserService,
    private readonly state: AssistantStateService,
    private readonly customers: CustomerService,
    private readonly sales: SalesService,
    private readonly reminders: ReminderService,
  ) {}

  async handleIncomingMessage(
    message: IncomingWhatsAppMessage,
    context: AssistantContext,
  ): Promise<OutgoingWhatsAppMessage> {
    const text = message.message.trim();
    const pending = await this.state.get(context.businessId, context.ownerId);
    if (pending) return this.continueFlow(message.from, text, context, pending);

    const parsed = this.parser.parse(text);
    switch (parsed.intent) {
      case 'create_customer':
        await this.state.set(context.businessId, context.ownerId, {
          type: 'create_customer',
          step: 1,
          draft: {},
        });
        return reply(message.from, 'Sure - what is the customer name?');
      case 'show_pipeline': {
        const customers = await this.customers.list(
          context.businessId,
          context.ownerId,
        );
        const groups = customers.reduce<Record<string, number>>(
          (result, customer) => ({
            ...result,
            [customer.leadStage]: (result[customer.leadStage] ?? 0) + 1,
          }),
          {},
        );
        const lines = Object.entries(groups).map(
          ([stage, count]) => `${stage}: ${count}`,
        );
        return reply(
          message.from,
          [
            'Pipeline:',
            '',
            ...(lines.length ? lines : ['No customers yet.']),
          ].join('\n'),
        );
      }
      case 'move_stage': {
        const name = parsed.entities?.name;
        const stage = normalizeStage(parsed.entities?.stage);
        if (!name || !stage)
          return reply(
            message.from,
            'Who should I move and to what stage? Example: Move John to Negotiating',
          );
        const customer = await this.customers.findByName(
          context.businessId,
          context.ownerId,
          name,
        );
        if (!customer)
          return reply(message.from, `Could not find customer ${name}.`);
        await this.customers.moveStage(customer, stage);
        return reply(message.from, `${customer.name} moved to ${stage}.`);
      }
      case 'add_note':
      case 'mark_paid':
        await this.state.set(context.businessId, context.ownerId, {
          type: 'add_note',
          step: 1,
          draft: { markPaid: parsed.intent === 'mark_paid' },
        });
        return reply(
          message.from,
          'Which customer is this for? Please provide the customer name.',
        );
      case 'todays_followups': {
        const followUps = await this.reminders.listForToday(
          context.businessId,
          context.ownerId,
          context.timezone,
        );
        return reply(
          message.from,
          followUps.length
            ? [
                "Today's follow-ups:",
                '',
                ...followUps.map((followUp) => `- ${followUp.title}`),
              ].join('\n')
            : 'No follow-ups due today.',
        );
      }
      case 'todays_leads': {
        const customers = await this.customers.list(
          context.businessId,
          context.ownerId,
        );
        const leads = customers.filter(
          (customer) => customer.leadStage === 'New Lead',
        );
        return reply(
          message.from,
          leads.length
            ? [
                "Today's leads:",
                '',
                ...leads.map((lead) => `- ${lead.name} ${lead.phone}`),
              ].join('\n')
            : 'No leads for today.',
        );
      }
      case 'count_customers':
        return reply(
          message.from,
          `You have ${await this.customers.count(context.businessId, context.ownerId)} customers.`,
        );
      case 'show_sales_today':
      case 'what_sold_today': {
        const sales = await this.sales.listForToday(
          context.businessId,
          context.ownerId,
          context.timezone,
        );
        return reply(
          message.from,
          sales.length
            ? [
                'Sales today:',
                '',
                ...sales.map(
                  (sale) =>
                    `- ${sale.product ?? 'sale'} ${sale.amount ? `NGN ${sale.amount}` : ''}`,
                ),
              ].join('\n')
            : 'No sales recorded today.',
        );
      }
      case 'show_overdue': {
        const overdue = await this.reminders.listOverdue(
          context.businessId,
          context.ownerId,
          context.timezone,
        );
        return reply(
          message.from,
          overdue.length
            ? [
                'Overdue:',
                '',
                ...overdue.map((followUp) => `- ${followUp.title}`),
              ].join('\n')
            : 'No overdue follow-ups.',
        );
      }
      case 'create_reminder':
        await this.state.set(context.businessId, context.ownerId, {
          type: 'create_reminder',
          step: 1,
          draft: {},
        });
        return reply(
          message.from,
          'Which customer should I follow up with tomorrow?',
        );
      case 'record_sale':
        await this.state.set(context.businessId, context.ownerId, {
          type: 'record_sale',
          step: 1,
          draft: {},
        });
        return reply(message.from, 'What product or service did you sell?');
      case 'find_customer':
        return this.findCustomer(
          message.from,
          context,
          parsed.entities?.name,
          false,
        );
      case 'search_customer':
        return this.findCustomer(
          message.from,
          context,
          parsed.entities?.phone,
          true,
        );
      default:
        return reply(
          message.from,
          "I didn't understand that. Try: Show pipeline, Create customer, Add note, Record sale, or Move John to Negotiating.",
        );
    }
  }

  private async continueFlow(
    to: string,
    text: string,
    context: AssistantContext,
    pending: AssistantPendingFlow,
  ): Promise<OutgoingWhatsAppMessage> {
    if (pending.type === 'create_customer') {
      if (pending.step === 1) {
        await this.state.set(context.businessId, context.ownerId, {
          ...pending,
          step: 2,
          draft: { name: text },
        });
        return reply(to, 'Got it. What is the customer phone number?');
      }
      const name = pending.draft.name;
      if (typeof name !== 'string')
        return this.resetWithMessage(
          to,
          context,
          'Please start again with Create customer.',
        );
      const customer = await this.customers.create(
        context.businessId,
        context.ownerId,
        name,
        text,
      );
      await this.state.clear(context.businessId, context.ownerId);
      return reply(to, `Customer ${customer.name} created.`);
    }
    if (pending.type === 'add_note') {
      if (pending.step === 1) {
        const customer = await this.customers.findByName(
          context.businessId,
          context.ownerId,
          text,
        );
        if (!customer) {
          await this.state.clear(context.businessId, context.ownerId);
          return reply(to, `Could not find customer ${text}.`);
        }
        if (pending.draft.markPaid) {
          await this.customers.markPaid(customer);
          await this.state.clear(context.businessId, context.ownerId);
          return reply(to, `${customer.name} marked paid.`);
        }
        await this.state.set(context.businessId, context.ownerId, {
          ...pending,
          step: 2,
          draft: { customerId: customer.id, customerName: customer.name },
        });
        return reply(to, 'What note should I add?');
      }
      const customer = await this.customers.findByName(
        context.businessId,
        context.ownerId,
        draftString(pending.draft.customerName),
      );
      if (!customer)
        return this.resetWithMessage(to, context, 'Customer no longer exists.');
      await this.customers.addNote(customer, text);
      await this.state.clear(context.businessId, context.ownerId);
      return reply(to, `Note added to ${customer.name}.`);
    }
    if (pending.type === 'create_reminder') {
      if (pending.step === 1) {
        const customer = await this.customers.findByName(
          context.businessId,
          context.ownerId,
          text,
        );
        if (!customer) {
          await this.state.clear(context.businessId, context.ownerId);
          return reply(to, `Could not find customer ${text}.`);
        }
        await this.state.set(context.businessId, context.ownerId, {
          ...pending,
          step: 2,
          draft: { customerName: customer.name },
        });
        return reply(to, 'What should the follow-up say?');
      }
      const customer = await this.customers.findByName(
        context.businessId,
        context.ownerId,
        draftString(pending.draft.customerName),
      );
      if (!customer)
        return this.resetWithMessage(to, context, 'Customer no longer exists.');
      await this.reminders.create(
        context.businessId,
        context.ownerId,
        customer,
        text,
        nextBusinessDayStart(new Date(), context.timezone),
      );
      await this.state.clear(context.businessId, context.ownerId);
      return reply(to, `Follow-up for ${customer.name} created for tomorrow.`);
    }
    if (pending.type === 'record_sale') {
      if (pending.step === 1) {
        await this.state.set(context.businessId, context.ownerId, {
          ...pending,
          step: 2,
          draft: { product: text },
        });
        return reply(to, 'What was the sale amount in NGN?');
      }
      const amount = Number(text.replace(/[^\d.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0)
        return reply(to, 'Please enter a valid sale amount in NGN.');
      await this.sales.recordSale(context.businessId, context.ownerId, {
        product: draftString(pending.draft.product) || 'sale',
        amount,
        customerId: null,
      });
      await this.state.clear(context.businessId, context.ownerId);
      return reply(to, 'Sale recorded.');
    }
    return this.resetWithMessage(to, context, 'Flow completed.');
  }

  private async findCustomer(
    to: string,
    context: AssistantContext,
    value: string | undefined,
    byPhone: boolean,
  ): Promise<OutgoingWhatsAppMessage> {
    if (!value)
      return reply(
        to,
        byPhone
          ? 'Which phone should I search for?'
          : 'Who are you looking for?',
      );
    const customer = byPhone
      ? await this.customers.findByPhone(
          context.businessId,
          context.ownerId,
          value,
        )
      : await this.customers.findByName(
          context.businessId,
          context.ownerId,
          value,
        );
    return customer
      ? reply(
          to,
          [
            `Name: ${customer.name}`,
            `Phone: ${customer.phone}`,
            `Stage: ${customer.leadStage}`,
            `Notes: ${customer.notes ? customer.notes.split('\n').length : 0}`,
          ].join('\n'),
        )
      : reply(to, `No customer found for ${value}.`);
  }

  private async resetWithMessage(
    to: string,
    context: AssistantContext,
    message: string,
  ): Promise<OutgoingWhatsAppMessage> {
    await this.state.clear(context.businessId, context.ownerId);
    return reply(to, message);
  }
}

function normalizeStage(
  value: string | undefined,
): CustomerLeadStage | undefined {
  return STAGES.find(
    (stage) => stage.toLowerCase() === value?.trim().toLowerCase(),
  );
}

function reply(to: string, message: string): OutgoingWhatsAppMessage {
  return { to, message };
}

function draftString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
