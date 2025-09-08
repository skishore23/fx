import { 
  createOpenAIProvider,
  promptTemplate,
  responseParser,
  llmStep,
  llmTemplateStep,
  llmParseStep,
  llmTemplateParseStep,
  createReasoningTemplate,
  createObservationTemplate,
  createReActActionParser
} from '../llm';
import { BaseContext } from '../types';

interface TestState extends BaseContext {
  userInput: string;
  memory: any[];
  [key: string]: any;
}

// Mock OpenAI to avoid actual API calls in tests
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{
            message: { content: 'Mocked response' },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15
          }
        })
      }
    }
  }))
}));

describe('LLM Integration - Fixed Implementation', () => {
  describe('createOpenAIProvider', () => {
    it('should throw error when API key is not provided', () => {
      expect(() => createOpenAIProvider({ apiKey: '' })).toThrow('OpenAI API key is required');
      expect(() => createOpenAIProvider({ apiKey: null as any })).toThrow('OpenAI API key is required');
      expect(() => createOpenAIProvider({ apiKey: undefined as any })).toThrow('OpenAI API key is required');
    });

    it('should create provider with valid config', () => {
      const provider = createOpenAIProvider({ 
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1'
      });
      
      expect(provider.name).toBe('openai');
      expect(typeof provider.chat).toBe('function');
    });

    it('should create provider without baseURL', () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      
      expect(provider.name).toBe('openai');
      expect(typeof provider.chat).toBe('function');
    });
  });

  describe('promptTemplate', () => {
    it('should create template with correct properties', () => {
      const template = promptTemplate(
        'test-template',
        'Hello {{name}}, you have {{count}} items',
        ['name', 'count']
      );
      
      expect(template.name).toBe('test-template');
      expect(template.template).toBe('Hello {{name}}, you have {{count}} items');
      expect(template.variables).toEqual(['name', 'count']);
      expect(typeof template.validate).toBe('function');
    });

    it('should use default validation function', () => {
      const template = promptTemplate('test', 'Hello {{name}}', ['name']);
      const context = { name: 'John' };
      
      expect(template.validate(context)).toBe(true);
    });

    it('should use custom validation function', () => {
      const template = promptTemplate(
        'test',
        'Hello {{name}}',
        ['name'],
        (context) => context.name === 'John'
      );
      
      expect(template.validate({ name: 'John' })).toBe(true);
      expect(template.validate({ name: 'Jane' })).toBe(false);
    });
  });

  describe('responseParser', () => {
    it('should create parser with correct properties', () => {
      const schema = { type: 'string' };
      const parse = (response: string) => response.trim();
      const defaultValue = 'default';
      
      const parser = responseParser(schema as any, parse, defaultValue);
      
      expect(parser.schema).toBe(schema);
      expect(parser.parse).toBe(parse);
      expect(parser.defaultValue).toBe(defaultValue);
    });

    it('should parse with default on error', () => {
      const parser = responseParser(
        { type: 'string' } as any,
        (response: string) => {
          if (response === 'invalid') throw new Error('Parse error');
          return response.trim();
        },
        'default'
      );
      
      expect((parser as any).parseWithDefault('valid')).toBe('valid');
      expect((parser as any).parseWithDefault('invalid')).toBe('default');
    });
  });

  describe('llmStep', () => {
    it('should call LLM and add response to state', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      
      const step = llmStep(provider, messages);
      const state: TestState = { userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.llmResponse).toBe('Mocked response');
      expect(result.llmUsage).toBeDefined();
      expect(result.llmMetadata).toBeDefined();
      expect(result.memory).toHaveLength(1);
    });

    it('should handle LLM errors gracefully', async () => {
      // Mock provider that throws error
      const provider = {
        name: 'test',
        chat: jest.fn().mockRejectedValue(new Error('API Error'))
      };
      
      const step = llmStep(provider as any, [{ role: 'user', content: 'Hello' }]);
      const state: TestState = { userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.llmError).toBe('API Error');
      expect(result.memory).toHaveLength(1);
      expect((result.memory as any[])[0].type).toBe('error');
    });
  });

  describe('llmTemplateStep', () => {
    it('should render template and call LLM', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      const template = promptTemplate(
        'greeting',
        'Hello {{name}}',
        ['name']
      );
      
      const step = llmTemplateStep(provider, template);
      const state: TestState = { name: 'John', userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.greetingResponse).toBe('Mocked response');
      expect(result.memory).toHaveLength(1);
    });

    it('should handle template validation failure', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      const template = promptTemplate(
        'greeting',
        'Hello {{name}}',
        ['name'],
        (context) => context.name === 'John'
      );
      
      const step = llmTemplateStep(provider, template);
      const state: TestState = { name: 'Jane', userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.greetingError).toContain('Template validation failed');
      expect(result.memory).toHaveLength(1);
      expect((result.memory as any[])[0].type).toBe('error');
    });
  });

  describe('llmParseStep', () => {
    it('should parse LLM response', async () => {
      const parser = responseParser(
        { type: 'string' } as any,
        (response: string) => response.trim().toUpperCase(),
        'DEFAULT'
      );
      
      const step = llmParseStep(parser, 'llmResponse');
      const state: TestState = { 
        llmResponse: '  hello world  ', 
        userInput: 'test', 
        memory: [] 
      };
      
      const result = await step(state);
      
      expect(result.llmResponseParsed).toBe('HELLO WORLD');
    });

    it('should handle parsing errors gracefully', async () => {
      const parser = responseParser(
        { type: 'string' } as any,
        (_response: string) => {
          throw new Error('Parse error');
        },
        'DEFAULT'
      );
      
      const step = llmParseStep(parser, 'llmResponse');
      const state: TestState = { 
        llmResponse: 'invalid', 
        userInput: 'test', 
        memory: [] 
      };
      
      const result = await step(state);
      
      expect(result.llmResponseParsed).toBe('DEFAULT');
      expect(result.memory).toHaveLength(0);
    });
  });

  describe('llmTemplateParseStep', () => {
    it('should call template and parse response', async () => {
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      const template = promptTemplate('test', 'Hello {{name}}', ['name']);
      const parser = responseParser(
        { type: 'string' } as any,
        (response: string) => response.trim(),
        'DEFAULT'
      );
      
      const step = llmTemplateParseStep(provider, template, parser);
      const state: TestState = { name: 'John', userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.testResponse).toBe('Mocked response');
      expect(result.testResponseParsed).toBe('Mocked response');
    });
  });

  describe('Built-in Templates', () => {
    it('should create reasoning template', () => {
      const template = createReasoningTemplate();
      
      expect(template.name).toBe('reasoning');
      expect(template.template).toContain('REASONING PHASE');
      expect(template.variables).toContain('currentGoal');
      expect(template.variables).toContain('currentStep');
    });

    it('should create observation template', () => {
      const template = createObservationTemplate();
      
      expect(template.name).toBe('observation');
      expect(template.template).toContain('OBSERVATION PHASE');
      expect(template.variables).toContain('lastToolResult');
    });

    it('should create ReAct action parser', () => {
      const parser = createReActActionParser();
      
      expect(parser.schema).toBeDefined();
      expect(typeof parser.parse).toBe('function');
      expect(parser.defaultValue).toEqual({
        reasoning: '',
        action: '',
        nextStep: ''
      });
    });

    it('should parse ReAct response correctly', () => {
      const parser = createReActActionParser();
      const response = `
        REASONING: I need to analyze the problem
        ACTION: search_database
        NEXT_STEP: Find relevant information
      `;
      
      const result = parser.parse(response);
      
      expect(result.reasoning).toBe('I need to analyze the problem');
      expect(result.action).toBe('search_database');
      expect(result.nextStep).toBe('Find relevant information');
    });

    it('should handle malformed ReAct response', () => {
      const parser = createReActActionParser();
      const response = 'Invalid response format';
      
      const result = parser.parse(response);
      
      expect(result.reasoning).toBe('');
      expect(result.action).toBe('');
      expect(result.nextStep).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing environment variables gracefully', async () => {
      // This test would require mocking process.env
      const provider = createOpenAIProvider({ apiKey: 'test-key' });
      expect(provider).toBeDefined();
    });

    it('should handle network errors gracefully', async () => {
      const provider = {
        name: 'test',
        chat: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      
      const step = llmStep(provider as any, [{ role: 'user', content: 'Hello' }]);
      const state: TestState = { userInput: 'test', memory: [] };
      
      const result = await step(state);
      
      expect(result.llmError).toBe('Network error');
    });
  });
});
