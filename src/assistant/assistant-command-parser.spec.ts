import { Test } from '@nestjs/testing';
import { AssistantCommandParserService } from './assistant-command-parser.service';

describe('AssistantCommandParserService', () => {
  let parser: AssistantCommandParserService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ providers: [AssistantCommandParserService] }).compile();
    parser = mod.get(AssistantCommandParserService);
  });

  it('parses show pipeline', () => {
    const res = parser.parse('Show pipeline');
    expect(res.intent).toBe('show_pipeline');
  });

  it('parses create customer variations', () => {
    expect(parser.parse('Create customer').intent).toBe('create_customer');
    expect(parser.parse('new customer').intent).toBe('create_customer');
  });

  it('parses move command with entities', () => {
    const res = parser.parse('Move John to Negotiating');
    expect(res.intent).toBe('move_stage');
    expect(res.entities?.name).toBe('john');
    expect(res.entities?.stage).toBe('negotiating');
  });
});
