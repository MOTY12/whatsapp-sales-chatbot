import { Injectable } from '@nestjs/common';
import { AssistantParseResult } from './types/assistant.types';

@Injectable()
export class AssistantCommandParserService {
  parse(message: string): AssistantParseResult {
    const m = message.trim();
    const lower = m.toLowerCase();

    // Simple intent matching with entity extraction
    if (/show.*pipeline/.test(lower) || /^pipeline$/.test(lower)) {
      return { intent: 'show_pipeline' };
    }

    if (/show.*sales|what did i sell|sales today/.test(lower) || /show today's sales/.test(lower)) {
      return { intent: 'show_sales_today' };
    }

    if (/create (a )?customer|new customer/.test(lower)) {
      return { intent: 'create_customer' };
    }

    if (/add note|note for|create note/.test(lower)) {
      return { intent: 'add_note' };
    }

    if (/mark .*paid|mark customer paid/.test(lower)) {
      return { intent: 'mark_paid' };
    }

    if (/move .* to /.test(lower)) {
      const match = lower.match(/move\s+(.*?)\s+to\s+(.*)/);
      if (match) {
        return { intent: 'move_stage', entities: { name: match[1].trim(), stage: match[2].trim() } };
      }
      return { intent: 'move_stage' };
    }

    if (/today('s)? follow-?ups|todays followups|today follow-ups/.test(lower)) {
      return { intent: 'todays_followups' };
    }

    if (/today('s)? leads|todays leads|today leads/.test(lower)) {
      return { intent: 'todays_leads' };
    }

    if (/how many customers|number of customers|how many customers do i have/.test(lower)) {
      return { intent: 'count_customers' };
    }

    if (/what did i sell today|sold today/.test(lower)) {
      return { intent: 'what_sold_today' };
    }

    if (/overdue customers|show overdue/.test(lower)) {
      return { intent: 'show_overdue' };
    }

    if (/create reminder for tomorrow|reminder for tomorrow|create reminder tomorrow/.test(lower)) {
      return { intent: 'create_reminder' };
    }

    if (/find customer (.+)/.test(lower)) {
      const match = lower.match(/find customer (.+)/);
      return { intent: 'find_customer', entities: { name: (match && match[1])?.trim() ?? '' } };
    }

    if (/search customer (\+?\d+)/.test(lower) || /search customer (\d+)/.test(lower)) {
      const match = lower.match(/search customer (\+?\d+)/);
      return { intent: 'search_customer', entities: { phone: (match && match[1]) ?? '' } };
    }

    return { intent: 'unknown' };
  }
}
