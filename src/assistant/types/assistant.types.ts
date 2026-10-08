export type AssistantIntent =
  | 'show_sales_today'
  | 'show_pipeline'
  | 'create_customer'
  | 'add_note'
  | 'mark_paid'
  | 'move_stage'
  | 'todays_followups'
  | 'todays_leads'
  | 'count_customers'
  | 'what_sold_today'
  | 'show_overdue'
  | 'create_reminder'
  | 'record_sale'
  | 'find_customer'
  | 'search_customer'
  | 'unknown';

export interface AssistantParseResult {
  intent: AssistantIntent;
  entities?: Record<string, string>;
}

export interface AssistantContext {
  businessId: string;
  ownerId: string;
  timezone: string;
}

export type AssistantPendingFlowType =
  'create_customer' | 'add_note' | 'create_reminder' | 'record_sale';

export interface AssistantPendingFlow {
  type: AssistantPendingFlowType;
  step: number;
  draft: Record<string, unknown>;
}
