import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssistantService } from './assistant.service';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { UsageModule } from '../metering/usage.module';
import { OutboundModule } from '../whatsapp/outbound.module';
import { AiResponseService } from './ai-response.service';
import { GROUNDED_MODEL, OpenAiGroundedModel } from './grounded-model.provider';
import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { SupportAgentModule } from '../support-agent/support-agent.module';
import { LearningModule } from '../learning/learning.module';
import { WebsiteChatModule } from '../website-chat/website-chat.module';

@Module({
  imports: [
    DatabaseModule,
    KnowledgeModule,
    UsageModule,
    OutboundModule,
    AgentToolsModule,
    SupportAgentModule,
    LearningModule,
    WebsiteChatModule,
  ],
  providers: [
    AssistantService,
    AssistantCommandParserService,
    AssistantStateService,
    CustomerService,
    SalesService,
    ReminderService,
    AiResponseService,
    OpenAiGroundedModel,
    { provide: GROUNDED_MODEL, useExisting: OpenAiGroundedModel },
  ],
  exports: [
    AssistantService,
    AssistantCommandParserService,
    AiResponseService,
    GROUNDED_MODEL,
  ],
})
export class AssistantModule {}
