/**
 * Tool Metadata System for Fx Framework
 * Provides capabilities, pre/post-conditions, budgets, and risk assessment
 */

import { z } from 'zod';
import { BaseContext } from './types';

// ---------- Core Metadata Types ----------

export type Capability = 
  | 'fs.read' 
  | 'fs.write' 
  | 'fs.delete' 
  | 'net.http' 
  | 'net.websocket' 
  | 'shell.exec' 
  | 'shell.script'
  | 'process.spawn'
  | 'memory.read'
  | 'memory.write'
  | 'compute.cpu'
  | 'compute.gpu'
  | 'database.query'
  | 'database.write'
  | 'cache.read'
  | 'cache.write';

export type Risk = 'low' | 'medium' | 'high' | 'critical';

export interface ExecutionContext {
  readonly state: BaseContext;
  readonly signal: AbortSignal;
  readonly approvals: ApprovalSystem;
  readonly quotas: ResourceQuotas;
}

export interface ApprovalSystem {
  ok(toolName: string, args: unknown): Promise<boolean>;
}

export interface ResourceQuotas {
  readonly maxConcurrency: number;
  readonly maxMemoryMB: number;
  readonly maxCpuTimeMs: number;
  readonly maxNetworkRequests: number;
}

// ---------- Tool Specification ----------

export interface ToolSpec<I, O> {
  readonly name: string;
  readonly in: z.ZodType<I>;
  readonly out: z.ZodType<O>;
  readonly caps: readonly Capability[];
  readonly risk: Risk;
  readonly timeBudgetMs?: number;
  readonly memoryBudgetMB?: number;
  readonly idempotencyKey?: (i: I) => string;
  readonly pre: readonly PreCondition<I>[];
  readonly post: readonly PostCondition<O>[];
  readonly exec: (i: I, ctx: ExecutionContext) => Promise<O>;
  readonly description?: string;
  readonly examples?: Array<{ input: I; output: O }>;
}

// ---------- Condition Types ----------

export interface PreCondition<I> {
  readonly name: string;
  readonly check: (state: BaseContext, input: I) => Promise<boolean>;
  readonly message: string;
}

export interface PostCondition<O> {
  readonly name: string;
  readonly check: (state: BaseContext, output: O) => boolean;
  readonly message: string;
}

// ---------- Built-in Conditions ----------

/**
 * File exists precondition
 */
export const fileExists = (pathExtractor: (input: unknown) => string): PreCondition<unknown> => ({
  name: 'file_exists',
  check: async (state, input) => {
    const path = pathExtractor(input);
    // This would check actual file system
    return true; // Placeholder
  },
  message: 'File must exist'
});

/**
 * Directory writable precondition
 */
export const directoryWritable = (pathExtractor: (input: unknown) => string): PreCondition<unknown> => ({
  name: 'directory_writable',
  check: async (state, input) => {
    const path = pathExtractor(input);
    // This would check actual directory permissions
    return true; // Placeholder
  },
  message: 'Directory must be writable'
});

/**
 * Network available precondition
 */
export const networkAvailable = (): PreCondition<unknown> => ({
  name: 'network_available',
  check: async (state, input) => {
    // This would check network connectivity
    return true; // Placeholder
  },
  message: 'Network must be available'
});

/**
 * Resource quota precondition
 */
export const withinQuota = (quotaType: keyof ResourceQuotas): PreCondition<unknown> => ({
  name: `within_quota_${quotaType}`,
  check: async (state, input) => {
    // This would check current resource usage
    return true; // Placeholder
  },
  message: `Must be within ${quotaType} quota`
});

/**
 * Output not empty postcondition
 */
export const outputNotEmpty = <O>(): PostCondition<O> => ({
  name: 'output_not_empty',
  check: (state, output) => {
    if (typeof output === 'string') return output.length > 0;
    if (Array.isArray(output)) return output.length > 0;
    if (typeof output === 'object' && output !== null) return Object.keys(output).length > 0;
    return output !== null && output !== undefined;
  },
  message: 'Output must not be empty'
});

/**
 * Output valid postcondition
 */
export const outputValid = <O>(validator: (output: O) => boolean): PostCondition<O> => ({
  name: 'output_valid',
  check: (state, output) => validator(output),
  message: 'Output must be valid'
});

// ---------- Tool Builder ----------

export class ToolSpecBuilder<I, O> {
  private spec: Partial<ToolSpec<I, O>> = {};

  constructor(
    public readonly name: string,
    public readonly inputSchema: z.ZodType<I>,
    public readonly outputSchema: z.ZodType<O>
  ) {
    (this.spec as any).name = name;
    (this.spec as any).in = inputSchema;
    (this.spec as any).out = outputSchema;
  }

  /**
   * Set capabilities
   */
  withCapabilities(...caps: Capability[]): this {
    (this.spec as any).caps = caps;
    return this;
  }

  /**
   * Set risk level
   */
  withRisk(risk: Risk): this {
    (this.spec as any).risk = risk;
    return this;
  }

  /**
   * Set time budget
   */
  withTimeBudget(ms: number): this {
    (this.spec as any).timeBudgetMs = ms;
    return this;
  }

  /**
   * Set memory budget
   */
  withMemoryBudget(mb: number): this {
    (this.spec as any).memoryBudgetMB = mb;
    return this;
  }

  /**
   * Set idempotency key generator
   */
  withIdempotencyKey(keyGen: (i: I) => string): this {
    (this.spec as any).idempotencyKey = keyGen;
    return this;
  }

  /**
   * Add precondition
   */
  withPreCondition(condition: PreCondition<I>): this {
    (this.spec as any).pre = [...((this.spec as any).pre || []), condition];
    return this;
  }

  /**
   * Add postcondition
   */
  withPostCondition(condition: PostCondition<O>): this {
    (this.spec as any).post = [...((this.spec as any).post || []), condition];
    return this;
  }

  /**
   * Set execution function
   */
  withExecution(exec: (i: I, ctx: ExecutionContext) => Promise<O>): this {
    (this.spec as any).exec = exec;
    return this;
  }

  /**
   * Set description
   */
  withDescription(description: string): this {
    (this.spec as any).description = description;
    return this;
  }

  /**
   * Set examples
   */
  withExamples(examples: Array<{ input: I; output: O }>): this {
    (this.spec as any).examples = examples;
    return this;
  }

  /**
   * Build the tool specification
   */
  build(): ToolSpec<I, O> {
    // Set defaults
    const spec: ToolSpec<I, O> = {
      name: this.spec.name!,
      in: this.spec.in!,
      out: this.spec.out!,
      caps: this.spec.caps || [],
      risk: this.spec.risk || 'low',
      pre: this.spec.pre || [],
      post: this.spec.post || [],
      exec: this.spec.exec || (async () => { throw new Error('No execution function provided'); }),
      ...this.spec
    };

    return spec;
  }
}

// ---------- Factory Functions ----------

/**
 * Create a tool specification builder
 */
export function createToolSpec<I, O>(
  name: string,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>
): ToolSpecBuilder<I, O> {
  return new ToolSpecBuilder(name, inputSchema, outputSchema);
}

// ---------- Built-in Tool Specifications ----------

/**
 * Read file tool specification
 */
export function createReadFileSpec(): ToolSpec<{ filePath: string }, { content: string; size: number }> {
  const inputSchema = z.object({
    filePath: z.string().min(1)
  });

  const outputSchema = z.object({
    content: z.string(),
    size: z.number()
  });

  return createToolSpec('read_file', inputSchema, outputSchema)
    .withCapabilities('fs.read')
    .withRisk('low')
    .withTimeBudget(5000)
    .withPreCondition(fileExists(input => (input as { filePath: string }).filePath))
    .withPostCondition(outputNotEmpty())
    .withExecution(async (input, ctx) => {
      // Placeholder implementation
      return { content: `Content of ${input.filePath}`, size: 100 };
    })
    .withDescription('Read the contents of a file')
    .build();
}

/**
 * Write file tool specification
 */
export function createWriteFileSpec(): ToolSpec<{ filePath: string; content: string }, { success: boolean; size: number }> {
  const inputSchema = z.object({
    filePath: z.string().min(1),
    content: z.string()
  });

  const outputSchema = z.object({
    success: z.boolean(),
    size: z.number()
  });

  return createToolSpec('write_file', inputSchema, outputSchema)
    .withCapabilities('fs.write')
    .withRisk('medium')
    .withTimeBudget(10000)
    .withIdempotencyKey(input => `write:${input.filePath}:${Buffer.from(input.content).toString('base64')}`)
    .withPreCondition(directoryWritable(input => (input as { filePath: string }).filePath.split('/').slice(0, -1).join('/')))
    .withPostCondition(outputValid(output => output.success))
    .withExecution(async (input, ctx) => {
      // Placeholder implementation
      return { success: true, size: input.content.length };
    })
    .withDescription('Write content to a file')
    .build();
}

/**
 * HTTP request tool specification
 */
export function createHttpRequestSpec(): ToolSpec<{ url: string; method?: string; data?: string }, { status: number; data: string }> {
  const inputSchema = z.object({
    url: z.string().url(),
    method: z.string().optional().default('GET'),
    data: z.string().optional()
  });

  const outputSchema = z.object({
    status: z.number(),
    data: z.string()
  });

  return createToolSpec('http_request', inputSchema, outputSchema)
    .withCapabilities('net.http')
    .withRisk('medium')
    .withTimeBudget(30000)
    .withPreCondition(networkAvailable())
    .withPostCondition(outputValid(output => output.status >= 200 && output.status < 600))
    .withExecution(async (input, ctx) => {
      // Placeholder implementation
      return { status: 200, data: `Response from ${input.url}` };
    })
    .withDescription('Make an HTTP request')
    .build();
}

/**
 * Command execution tool specification
 */
export function createCommandSpec(): ToolSpec<{ command: string; workingDirectory?: string }, { exitCode: number; output: string }> {
  const inputSchema = z.object({
    command: z.string().min(1),
    workingDirectory: z.string().optional()
  });

  const outputSchema = z.object({
    exitCode: z.number(),
    output: z.string()
  });

  return createToolSpec('execute_command', inputSchema, outputSchema)
    .withCapabilities('shell.exec')
    .withRisk('high')
    .withTimeBudget(60000)
    .withPreCondition(withinQuota('maxConcurrency'))
    .withPostCondition(outputValid(output => typeof output.exitCode === 'number'))
    .withExecution(async (input, ctx) => {
      // Placeholder implementation
      return { exitCode: 0, output: `Output of: ${input.command}` };
    })
    .withDescription('Execute a shell command')
    .build();
}

// ---------- Tool Registry with Metadata ----------

export class ToolRegistry {
  private tools = new Map<string, ToolSpec<unknown, unknown>>();

  /**
   * Register a tool specification
   */
  register<I, O>(spec: ToolSpec<I, O>): void {
    this.tools.set(spec.name, spec as ToolSpec<unknown, unknown>);
  }

  /**
   * Get a tool specification
   */
  get(name: string): ToolSpec<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools with specific capability
   */
  getByCapability(cap: Capability): ToolSpec<unknown, unknown>[] {
    return Array.from(this.tools.values()).filter(tool => tool.caps.includes(cap));
  }

  /**
   * Get all tools with specific risk level
   */
  getByRisk(risk: Risk): ToolSpec<unknown, unknown>[] {
    return Array.from(this.tools.values()).filter(tool => tool.risk === risk);
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// ---------- Default Registry ----------

export const defaultToolRegistry = new ToolRegistry();

// Register built-in tools
defaultToolRegistry.register(createReadFileSpec());
defaultToolRegistry.register(createWriteFileSpec());
defaultToolRegistry.register(createHttpRequestSpec());
defaultToolRegistry.register(createCommandSpec());
