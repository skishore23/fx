/**
 * LLM Provider Abstraction for Fx Framework
 * Simplified implementation with clean types
 */

import { z } from 'zod';
import { Step, BaseContext } from './types';
import { addMemory } from './memory';

// ---------- LLM Types ----------

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface LLMOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly stop?: string[];
  readonly stream?: boolean;
}

export interface LLMResponse {
  readonly content: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  readonly name: string;
  readonly chat: (messages: ChatMessage[], options?: LLMOptions) => Promise<LLMResponse>;
  readonly stream?: (messages: ChatMessage[], options?: LLMOptions) => AsyncIterable<string>;
  readonly embed?: (text: string) => Promise<number[]>;
}

// ---------- Prompt Template Types ----------

export interface PromptTemplate {
  readonly name: string;
  readonly template: string;
  readonly variables: string[];
  readonly validate: (context: BaseContext) => boolean;
}

export interface ResponseParser<T> {
  readonly schema: z.ZodType<T>;
  readonly parse: (response: string) => T;
  readonly fallback: T;
}

// ---------- LLM Provider Implementation ----------

class LLMProviderImpl implements LLMProvider {
  constructor(
    public readonly name: string,
    private readonly chatFn: (messages: ChatMessage[], options?: LLMOptions) => Promise<LLMResponse>,
    private readonly streamFn?: (messages: ChatMessage[], options?: LLMOptions) => AsyncIterable<string>,
    private readonly embedFn?: (text: string) => Promise<number[]>
  ) {}

  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
    return this.chatFn(messages, options);
  }

  stream?(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<string> {
    if (this.streamFn) {
      return this.streamFn(messages, options);
    }
    const self = this;
    return (async function* () {
      const response = await self.chatFn(messages, options);
      yield response.content;
    })();
  }

  embed?(text: string): Promise<number[]> {
    return this.embedFn?.(text) || Promise.resolve([]);
  }
}

// ---------- OpenAI Provider Implementation ----------

/**
 * Create OpenAI provider
 */
export function createOpenAIProvider(config: { apiKey: string; baseURL?: string }): LLMProvider {
  return new LLMProviderImpl(
    'openai',
    async (messages: ChatMessage[], options?: LLMOptions) => {
      return realOpenAICall(messages, options);
    },
    async function* (messages: ChatMessage[], options?: LLMOptions) {
      const { OpenAI } = await import('openai');
      
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      const stream = await client.chat.completions.create({
        model: options?.model || 'gpt-4',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens,
        top_p: options?.topP,
        frequency_penalty: options?.frequencyPenalty,
        presence_penalty: options?.presencePenalty,
        stop: options?.stop,
        stream: true
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    }
  );
}

/**
 * Real OpenAI API call
 */
async function realOpenAICall(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
  const { OpenAI } = await import('openai');
  
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.chat.completions.create({
    model: options?.model || 'gpt-4',
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    temperature: options?.temperature || 0.7,
    max_tokens: options?.maxTokens,
    top_p: options?.topP,
    frequency_penalty: options?.frequencyPenalty,
    presence_penalty: options?.presencePenalty,
    stop: options?.stop,
    stream: false
  });

  const choice = response.choices[0];
  if (!choice?.message?.content) {
    throw new Error('No response content from OpenAI');
  }

  return {
    content: choice.message.content,
    usage: response.usage ? {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens
    } : undefined,
    metadata: { 
      provider: 'openai', 
      model: options?.model || 'gpt-4',
      finishReason: choice.finish_reason
    }
  };
}

// ---------- Prompt Template Implementation ----------

class PromptTemplateImpl implements PromptTemplate {
  constructor(
    public readonly name: string,
    public readonly template: string,
    public readonly variables: string[],
    public readonly validate: (context: BaseContext) => boolean
  ) {}

  /**
   * Render the template with context
   */
  render(context: BaseContext): string {
    let rendered = this.template;
    
    for (const variable of this.variables) {
      const value = context[variable];
      const placeholder = `{{${variable}}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), String(value || ''));
    }
    
    return rendered;
  }
}

// ---------- Response Parser Implementation ----------

class ResponseParserImpl<T> implements ResponseParser<T> {
  constructor(
    public readonly schema: z.ZodType<T>,
    public readonly parse: (response: string) => T,
    public readonly fallback: T
  ) {}

  /**
   * Parse response with fallback
   */
  parseWithFallback(response: string): T {
    try {
      return this.parse(response);
    } catch {
      return this.fallback;
    }
  }
}

// ---------- Factory Functions ----------

/**
 * Create a prompt template
 */
export function promptTemplate(
  name: string,
  template: string,
  variables: string[],
  validate?: (context: BaseContext) => boolean
): PromptTemplate {
  return new PromptTemplateImpl(
    name,
    template,
    variables,
    validate || (() => true)
  );
}

/**
 * Create a response parser
 */
export function responseParser<T>(
  schema: z.ZodType<T>,
  parse: (response: string) => T,
  fallback: T
): ResponseParser<T> {
  return new ResponseParserImpl(schema, parse, fallback);
}

// ---------- LLM Steps ----------

/**
 * Create a step that calls LLM
 */
export function llmStep<T extends BaseContext>(
  provider: LLMProvider,
  messages: ChatMessage[],
  options?: LLMOptions
): Step<T> {
  return async (state: T) => {
    try {
      const response = await provider.chat(messages, options);
      
      // Add memory entry
      const result = await addMemory('action', `LLM call with ${provider.name}`)(state);
      
      return {
        ...result,
        llmResponse: response.content,
        llmUsage: response.usage,
        llmMetadata: response.metadata
      } as unknown as T;
    } catch (error) {
      // Add error memory entry
      const result = await addMemory('error', `LLM call failed: ${(error as Error).message}`)(state);
      
      return {
        ...result,
        llmError: (error as Error).message
      } as unknown as T;
    }
  };
}

/**
 * Create a step that renders and calls LLM with template
 */
export function llmTemplateStep<T extends BaseContext>(
  provider: LLMProvider,
  template: PromptTemplate,
  options?: LLMOptions
): Step<T> {
  return async (state: T) => {
    try {
      // Validate context
      if (!template.validate(state)) {
        throw new Error(`Template validation failed for: ${template.name}`);
      }
      
      // Render template
      const renderedPrompt = (template as PromptTemplateImpl).render(state);
      
      // Create messages
      const messages: ChatMessage[] = [
        { role: 'user', content: renderedPrompt }
      ];
      
      // Call LLM
      const response = await provider.chat(messages, options);
      
      // Add memory entry
      const result = await addMemory('action', `LLM template call: ${template.name}`)(state);
      
      return {
        ...result,
        [`${template.name}Response`]: response.content,
        [`${template.name}Usage`]: response.usage,
        [`${template.name}Metadata`]: response.metadata
      } as T;
    } catch (error) {
      // Add error memory entry
      const result = await addMemory('error', `LLM template call failed: ${(error as Error).message}`)(state);
      
      return {
        ...result,
        [`${template.name}Error`]: (error as Error).message
      } as T;
    }
  };
}

/**
 * Create a step that parses LLM response
 */
export function llmParseStep<T extends BaseContext, U>(
  parser: ResponseParser<U>,
  responseKey: string = 'llmResponse'
): Step<T> {
  return async (state: T) => {
    try {
      const response = (state[responseKey] as string) || '';
      const parsed = (parser as ResponseParserImpl<U>).parseWithFallback(response);
      
      return {
        ...state,
        [`${responseKey}Parsed`]: parsed
      } as T;
    } catch (error) {
      // Add error memory entry
      const result = await addMemory('error', `LLM parsing failed: ${(error as Error).message}`)(state);
      
      return {
        ...result,
        [`${responseKey}ParseError`]: (error as Error).message
      } as T;
    }
  };
}

/**
 * Create a step that calls LLM with template and parses response
 */
export function llmTemplateParseStep<T extends BaseContext, U>(
  provider: LLMProvider,
  template: PromptTemplate,
  parser: ResponseParser<U>,
  options?: LLMOptions
): Step<T> {
  return async (state: T) => {
    // First call LLM with template
    const llmState = await llmTemplateStep(provider, template, options)(state);
    
    // Then parse the response
    return await llmParseStep(parser, `${template.name}Response`)(llmState) as unknown as T;
  };
}

// ---------- Built-in Templates ----------

/**
 * Create a reasoning prompt template
 */
export function createReasoningTemplate(): PromptTemplate {
  return promptTemplate(
    'reasoning',
    `REASONING PHASE:

Current Goal: {{currentGoal}}
Current Step: {{currentStep}}
Iteration: {{iterationCount}}/{{maxIterations}}

Current Plan:
{{#each plan}}
  {{step}}. {{action}} ({{status}})
{{/each}}

Recent Memory:
{{#each recentMemory}}
  {{type}}: {{content}}
{{/each}}

Last Tool Result:
{{lastToolResult}}

Based on the current situation, what should be the next action? 
Provide your reasoning and the specific tool and parameters to use.

Format your response as:
REASONING: [Your analysis of the current situation]
ACTION: [Tool name and parameters]
NEXT_STEP: [What you expect to accomplish]`,
    ['currentGoal', 'currentStep', 'iterationCount', 'maxIterations', 'plan', 'recentMemory', 'lastToolResult']
  );
}

/**
 * Create an observation prompt template
 */
export function createObservationTemplate(): PromptTemplate {
  return promptTemplate(
    'observation',
    `OBSERVATION PHASE:

Last Action Result:
{{lastToolResult}}

Last Error:
{{lastError}}

Current Goal: {{currentGoal}}

Based on the result of the last action, should we:
1. Continue with the next step in the plan
2. Modify the approach
3. Consider the goal achieved
4. Stop due to an error

Provide your observation and recommendation.`,
    ['lastToolResult', 'lastError', 'currentGoal']
  );
}

// ---------- Built-in Parsers ----------

/**
 * Create a ReAct action parser
 */
export function createReActActionParser(): ResponseParser<{ reasoning: string; action: string; nextStep: string }> {
  return responseParser(
    z.object({
      reasoning: z.string(),
      action: z.string(),
      nextStep: z.string()
    }),
    (response: string) => {
      const reasoningMatch = response.match(/REASONING:\s*(.+?)(?=ACTION:|$)/s);
      const actionMatch = response.match(/ACTION:\s*(.+?)(?=NEXT_STEP:|$)/s);
      const nextStepMatch = response.match(/NEXT_STEP:\s*(.+?)$/s);
      
      return {
        reasoning: reasoningMatch?.[1]?.trim() || '',
        action: actionMatch?.[1]?.trim() || '',
        nextStep: nextStepMatch?.[1]?.trim() || ''
      };
    },
    { reasoning: '', action: '', nextStep: '' }
  );
}