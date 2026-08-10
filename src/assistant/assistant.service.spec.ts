import { Test } from '@nestjs/testing';
import { AssistantService } from './assistant.service';
import { AssistantCommandParserService } from './assistant-command-parser.service';
import { AssistantStateService } from './assistant-state.service';
import { CustomerService } from './customer.service';
import { SalesService } from './sales.service';
import { ReminderService } from './reminder.service';

describe('AssistantService flows', () => {
  let assistant: AssistantService;
  let customers: CustomerService;

  const seller = '+2348012345678';

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AssistantService,
        AssistantCommandParserService,
        AssistantStateService,
        CustomerService,
        SalesService,
        ReminderService,
      ],
    }).compile();

    assistant = module.get(AssistantService);
    customers = module.get(CustomerService);
  });

  it('create customer flow', async () => {
    const askName = await assistant.handleIncomingMessage({ from: seller, message: 'Create customer', type: 'text' });
    expect(askName.message).toContain('what is the customer name');

    const askPhone = await assistant.handleIncomingMessage({ from: seller, message: 'Alice', type: 'text' });
    expect(askPhone.message).toContain('phone');

    const done = await assistant.handleIncomingMessage({ from: seller, message: '+2348000000000', type: 'text' });
    expect(done.message).toContain('Customer Alice created');

    const found = customers.findByName(seller, 'Alice');
    expect(found).toBeDefined();
    expect(found?.phone).toBe('+2348000000000');
  });

  it('add note flow', async () => {
    // ensure customer exists
    const c = customers.create(seller, 'Bob', '+2348111111111');

    const askForCustomer = await assistant.handleIncomingMessage({ from: seller, message: 'Add note', type: 'text' });
    expect(askForCustomer.message).toContain('Which customer');

    const askNote = await assistant.handleIncomingMessage({ from: seller, message: 'Bob', type: 'text' });
    expect(askNote.message).toContain('What note');

    const done = await assistant.handleIncomingMessage({ from: seller, message: 'Called and interested', type: 'text' });
    expect(done.message).toContain('Note added to Bob');

    const found = customers.findByName(seller, 'Bob');
    expect(found?.notes.length).toBeGreaterThan(0);
  });
});
