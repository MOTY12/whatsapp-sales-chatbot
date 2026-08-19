import { Injectable } from '@nestjs/common';
import { IncomingWhatsAppMessage, OutgoingWhatsAppMessage } from '../whatsapp/types/whatsapp.types';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';

@Injectable()
export class AssistantService {
  constructor(
    private readonly parser: AssistantCommandParserService,
    private readonly state: AssistantStateService,
    private readonly customers: CustomerService,
    private readonly sales: SalesService,
    private readonly reminders: ReminderService,
  ) {}

  async handleIncomingMessage(message: IncomingWhatsAppMessage): Promise<OutgoingWhatsAppMessage> {
    const seller = message.from.trim();
    const text = (message.message || '').trim();

    // Check pending flow
    const pending = this.state.get(seller);
    if (pending) {
      return this.continueFlow(seller, text);
    }

    const parsed = this.parser.parse(text);

    switch (parsed.intent) {
      case 'create_customer':
        this.state.set(seller, { type: 'create_customer', step: 1, draft: {} });
        return { to: seller, message: 'Sure — what is the customer name?' };
      case 'show_pipeline': {
        const list = this.customers.list(seller);
        const groups = list.reduce<Record<string, number>>((acc, c) => {
          acc[c.stage] = (acc[c.stage] || 0) + 1;
          return acc;
        }, {});

        const lines = Object.entries(groups).map(([k, v]) => `${k}: ${v}`);
        return { to: seller, message: ['Pipeline:', '', ...lines].join('\n') };
      }
      case 'move_stage': {
        const name = parsed.entities?.name;
        const stage = parsed.entities?.stage;
        if (!name || !stage) {
          return { to: seller, message: 'Who should I move and to what stage? Example: Move John to Negotiating' };
        }
        const cust = this.customers.findByName(seller, name);
        if (!cust) {
          return { to: seller, message: `Could not find customer ${name}.` };
        }
        this.customers.moveStage(seller, cust.id, stage);
        return { to: seller, message: `${cust.name} moved to ${stage}.` };
      }
      case 'add_note': {
        this.state.set(seller, { type: 'add_note', step: 1, draft: {} });
        return { to: seller, message: 'Which customer is the note for? Please provide customer name.' };
      }
      case 'mark_paid': {
        this.state.set(seller, { type: 'add_note', step: 1, draft: { markPaid: true } });
        return { to: seller, message: 'Which customer should be marked paid? Please provide customer name.' };
      }
      case 'todays_followups': {
        const today = this.reminders.listForDate(seller, new Date());
        if (today.length === 0) return { to: seller, message: "No follow-ups due today." };
        const lines = today.map((r) => `- ${r.text} (${new Date(r.when).toLocaleTimeString()})`);
        return { to: seller, message: ['Today\'s follow-ups:', '', ...lines].join('\n') };
      }
      case 'todays_leads': {
        const leads = this.customers.list(seller).filter((c) => c.stage.toLowerCase() === 'new');
        if (leads.length === 0) return { to: seller, message: 'No leads for today.' };
        const lines = leads.map((l) => `- ${l.name} ${l.phone ?? ''}`);
        return { to: seller, message: ['Today\'s leads:', '', ...lines].join('\n') };
      }
      case 'count_customers': {
        const count = this.customers.list(seller).length;
        return { to: seller, message: `You have ${count} customers.` };
      }
      case 'what_sold_today': {
        const sold = this.sales.listForDate(seller, new Date());
        if (sold.length === 0) return { to: seller, message: 'No sales recorded today.' };
        const lines = sold.map((s) => `- ${s.product ?? 'sale'} ${s.amount ? `NGN ${s.amount}` : ''}`);
        return { to: seller, message: ['Sales today:', '', ...lines].join('\n') };
      }
      case 'show_overdue': {
        const overdue = this.reminders.listOverdue(seller, new Date());
        if (overdue.length === 0) return { to: seller, message: 'No overdue customers/reminders.' };
        const lines = overdue.map((r) => `- ${r.text} (was ${new Date(r.when).toLocaleDateString()})`);
        return { to: seller, message: ['Overdue:', '', ...lines].join('\n') };
      }
      case 'create_reminder': {
        this.state.set(seller, { type: 'create_reminder', step: 1, draft: {} });
        return { to: seller, message: 'What should the reminder say for tomorrow?' };
      }
      case 'find_customer': {
        const name = parsed.entities?.name;
        if (!name) return { to: seller, message: 'Who are you looking for?' };
        const cust = this.customers.findByName(seller, name);
        if (!cust) return { to: seller, message: `No customer found for ${name}.` };
        const lines = [`Name: ${cust.name}`, `Phone: ${cust.phone ?? '-'}`, `Stage: ${cust.stage}`, `Notes: ${cust.notes.length}`];
        return { to: seller, message: lines.join('\n') };
      }
      case 'search_customer': {
        const phone = parsed.entities?.phone;
        if (!phone) return { to: seller, message: 'Which phone should I search for?' };
        const cust = this.customers.findByPhone(seller, phone);
        if (!cust) return { to: seller, message: `No customer found for ${phone}.` };
        const lines = [`Name: ${cust.name}`, `Phone: ${cust.phone ?? '-'}`, `Stage: ${cust.stage}`];
        return { to: seller, message: lines.join('\n') };
      }
      default:
        return {
          to: seller,
          message: [
            "I didn't understand that. Try commands like:",
            '',
            'Show pipeline',
            'Create customer',
            'Add note',
            'Move John to Negotiating',
          ].join('\n'),
        };
    }
  }

  private continueFlow(seller: string, text: string) {
    const pending = this.state.get(seller);
    if (!pending) return { to: seller, message: 'Something went wrong.' };

    if (pending.type === 'create_customer') {
      if (pending.step === 1) {
        pending.draft.name = text;
        pending.step = 2;
        this.state.set(seller, pending);
        return { to: seller, message: 'Got it. What is the customer phone number?' };
      }
      if (pending.step === 2) {
        const phone = text;
        const cust = this.customers.create(seller, pending.draft.name, phone);
        this.state.clear(seller);
        return { to: seller, message: `Customer ${cust.name} created.` };
      }
    }

    if (pending.type === 'add_note') {
      if (pending.step === 1) {
        pending.draft.name = text;
        pending.step = 2;
        this.state.set(seller, pending);
        return { to: seller, message: 'What note should I add?' };
      }
      if (pending.step === 2) {
        const name = pending.draft.name;
        const cust = this.customers.findByName(seller, name);
        if (!cust) {
          this.state.clear(seller);
          return { to: seller, message: `Could not find customer ${name}.` };
        }
        this.customers.addNote(seller, cust.id, text);
        this.state.clear(seller);
        return { to: seller, message: `Note added to ${cust.name}.` };
      }
    }

    if (pending.type === 'create_reminder') {
      if (pending.step === 1) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.reminders.create(seller, text, tomorrow);
        this.state.clear(seller);
        return { to: seller, message: 'Reminder created for tomorrow.' };
      }
    }

    this.state.clear(seller);
    return { to: seller, message: 'Flow completed.' };
  }
}
