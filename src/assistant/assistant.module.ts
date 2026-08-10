import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';

@Module({
  providers: [
    AssistantService,
    AssistantCommandParserService,
    AssistantStateService,
    CustomerService,
    SalesService,
    ReminderService,
  ],
  exports: [AssistantService, AssistantCommandParserService],
})
export class AssistantModule {}
