/**
 * Enhanced Tool System for Fx Framework
 * Simplified implementation with clean types
 */

import { z } from 'zod';
import { Step, BaseContext } from './types';
import { registerTool, callTool } from './registry';
import { addMemory } from './memory';

// ---------- Tool Types ----------

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly delay: number;
  readonly backoffMultiplier?: number;
  readonly maxDelay?: number;
}

export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error;
  readonly metadata?: Record<string, unknown>;
}

export interface ToolBuilder<T extends BaseContext> {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly execute: (params: unknown, state: T) => Promise<T>;
  readonly onSuccess?: (result: ToolResult, state: T) => T;
  readonly onError?: (error: Error, state: T) => T;
  readonly retry?: RetryConfig;
  readonly timeout?: number;
  readonly validate?: (params: unknown) => boolean;
  readonly description?: string;
  readonly examples?: Array<{ input: unknown; output: unknown }>;
}

export interface ToolPipeline<T extends BaseContext> {
  readonly name: string;
  readonly tools: ToolBuilder<T>[];
  readonly execute: (params: unknown, state: T) => Promise<T>;
  readonly onError?: (error: Error, state: T) => T;
}

// ---------- Tool Builder Implementation ----------

class ToolBuilderImpl<T extends BaseContext> implements ToolBuilder<T> {
  constructor(
    public readonly name: string,
    public readonly schema: z.ZodType,
    public readonly execute: (params: unknown, state: T) => Promise<T>,
    public readonly onSuccess?: (result: ToolResult, state: T) => T,
    public readonly onError?: (error: Error, state: T) => T,
    public readonly retry?: RetryConfig,
    public readonly timeout?: number,
    public readonly validate?: (params: unknown) => boolean,
    public readonly description?: string,
    public readonly examples?: Array<{ input: unknown; output: unknown }>
  ) {}

  /**
   * Set success handler
   */
  onSuccessHandler(handler: (result: ToolResult, state: T) => T): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      handler,
      this.onError,
      this.retry,
      this.timeout,
      this.validate,
      this.description,
      this.examples
    );
  }

  /**
   * Set error handler
   */
  onErrorHandler(handler: (error: Error, state: T) => T): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      handler,
      this.retry,
      this.timeout,
      this.validate,
      this.description,
      this.examples
    );
  }

  /**
   * Set retry configuration
   */
  withRetry(config: RetryConfig): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      this.onError,
      config,
      this.timeout,
      this.validate,
      this.description,
      this.examples
    );
  }

  /**
   * Set timeout
   */
  withTimeout(timeout: number): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      this.onError,
      this.retry,
      timeout,
      this.validate,
      this.description,
      this.examples
    );
  }

  /**
   * Set validation function
   */
  withValidation(validate: (params: unknown) => boolean): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      this.onError,
      this.retry,
      this.timeout,
      validate,
      this.description,
      this.examples
    );
  }

  /**
   * Set description
   */
  withDescription(description: string): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      this.onError,
      this.retry,
      this.timeout,
      this.validate,
      description,
      this.examples
    );
  }

  /**
   * Set examples
   */
  withExamples(examples: Array<{ input: unknown; output: unknown }>): ToolBuilderImpl<T> {
    return new ToolBuilderImpl(
      this.name,
      this.schema,
      this.execute,
      this.onSuccess,
      this.onError,
      this.retry,
      this.timeout,
      this.validate,
      this.description,
      examples
    );
  }

  /**
   * Build the tool and register it
   */
  build(): ToolBuilder<T> {
    registerTool(
      this.name,
      this.schema,
      (params: unknown) => this.createStep(params)
    );
    
    return this;
  }

  /**
   * Create a step from the tool builder
   */
  private createStep(params: unknown): Step<T> {
    return async (state: T): Promise<T> => {
      try {
        // Validate parameters
        if (this.validate && !this.validate(params)) {
          throw new Error(`Validation failed for tool: ${this.name}`);
        }

        // Execute tool with timeout
        const executePromise = this.execute(params, state);
        const timeoutPromise = this.timeout 
          ? new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error(`Tool ${this.name} timed out`)), this.timeout)
            )
          : Promise.resolve();

        const result = await Promise.race([executePromise, timeoutPromise]);
        
        // Handle success
        if (this.onSuccess) {
          return this.onSuccess({ success: true, data: result }, state);
        }
        
        return result as T;
      } catch (error) {
        const err = error as Error;
        
        // Handle error
        if (this.onError) {
          return this.onError(err, state);
        }
        
        throw err;
      }
    };
  }
}

// ---------- Tool Pipeline Implementation ----------

class ToolPipelineImpl<T extends BaseContext> implements ToolPipeline<T> {
  constructor(
    public readonly name: string,
    public readonly tools: ToolBuilder<T>[],
    public readonly onError?: (error: Error, state: T) => T
  ) {}

  /**
   * Execute the pipeline
   */
  async execute(params: unknown, state: T): Promise<T> {
    let currentState = state;
    let currentParams = params;

    for (const tool of this.tools) {
      try {
        // Validate parameters
        if (tool.validate && !tool.validate(currentParams)) {
          throw new Error(`Validation failed for tool: ${tool.name}`);
        }

        // Execute tool with timeout
        const executePromise = tool.execute(currentParams, currentState);
        const timeoutPromise = tool.timeout 
          ? new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error(`Tool ${tool.name} timed out`)), tool.timeout)
            )
          : Promise.resolve();

        const result = await Promise.race([executePromise, timeoutPromise]);
        
        // Handle success
        if (tool.onSuccess) {
          currentState = tool.onSuccess({ success: true, data: result }, currentState);
        } else {
          currentState = result as T;
        }

        // Update parameters for next tool (if needed)
        currentParams = result;

      } catch (error) {
        const err = error as Error;
        
        // Handle error
        if (tool.onError) {
          currentState = tool.onError(err, currentState);
        } else if (this.onError) {
          currentState = this.onError(err, currentState);
        } else {
          throw err;
        }
      }
    }

    return currentState;
  }
}

// ---------- Factory Functions ----------

/**
 * Create a tool builder
 */
export function tool<T extends BaseContext>(
  name: string,
  schema: z.ZodType,
  execute: (params: unknown, state: T) => Promise<T>
): ToolBuilderImpl<T> {
  return new ToolBuilderImpl(name, schema, execute);
}

/**
 * Create a tool pipeline
 */
export function pipeline<T extends BaseContext>(
  name: string,
  tools: ToolBuilder<T>[],
  onError?: (error: Error, state: T) => T
): ToolPipeline<T> {
  return new ToolPipelineImpl(name, tools, onError);
}

/**
 * Create a retry configuration
 */
export function retryConfig(
  maxAttempts: number,
  delay: number,
  backoffMultiplier: number = 2,
  maxDelay: number = 10000
): RetryConfig {
  return {
    maxAttempts,
    delay,
    backoffMultiplier,
    maxDelay
  };
}

// ---------- Tool Composition ----------

/**
 * Create a step that executes a tool with retry
 */
export function retryTool<T extends BaseContext>(
  toolName: string,
  params: unknown,
  config: RetryConfig
): Step<T> {
  return async (state: T) => {
    let lastError: Error;
    let delay = config.delay;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await callTool<T>(toolName, [params])(state);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === config.maxAttempts) {
          break;
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Increase delay with backoff
        delay = Math.min(delay * (config.backoffMultiplier || 2), config.maxDelay || 10000);
      }
    }

    throw lastError!;
  };
}

/**
 * Create a step that executes a tool pipeline
 */
export function executePipeline<T extends BaseContext>(
  pipeline: ToolPipeline<T>,
  params: unknown
): Step<T> {
  return async (state: T) => {
    return pipeline.execute(params, state);
  };
}

// ---------- Built-in Tool Creators ----------

/**
 * Create a tool that reads a file
 */
export function createReadFileTool<T extends BaseContext = BaseContext>(): ToolBuilder<T> {
  const schema = z.object({
    filePath: z.string()
  });

  const toolBuilder = tool('read_file', schema, async (params, state) => {
    const { filePath } = params as { filePath: string };
    // This would be implemented with actual file reading logic
    const result = { ...state, fileContent: `Content of ${filePath}` };
    
    // Add memory entry
    return addMemory('action', `Read file: ${filePath}`)(result);
  });
  
  return toolBuilder
    .withDescription('Read the contents of a file')
    .withExamples([
      { input: { filePath: 'example.txt' }, output: { fileContent: 'Content of example.txt' } }
    ])
    .build() as unknown as ToolBuilder<T>;
}

/**
 * Create a tool that writes a file
 */
export function createWriteFileTool<T extends BaseContext = BaseContext>(): ToolBuilder<T> {
  const schema = z.object({
    filePath: z.string(),
    content: z.string()
  });

  const toolBuilder = tool('write_file', schema, async (params, state) => {
    const { filePath, content } = params as { filePath: string; content: string };
    // This would be implemented with actual file writing logic
    const result = { ...state, writtenFile: filePath, writtenContent: content };
    
    // Add memory entry
    return addMemory('action', `Write file: ${filePath}`)(result);
  });
  
  return toolBuilder
    .withDescription('Write content to a file')
    .withExamples([
      { input: { filePath: 'example.txt', content: 'Hello World' }, output: { writtenFile: 'example.txt' } }
    ])
    .build() as unknown as ToolBuilder<T>;
}

/**
 * Create a tool that executes a command
 */
export function createCommandTool<T extends BaseContext = BaseContext>(): ToolBuilder<T> {
  const schema = z.object({
    command: z.string(),
    workingDirectory: z.string().optional()
  });

  const toolBuilder = tool('execute_command', schema, async (params, state) => {
    const { command } = params as { command: string; workingDirectory?: string };
    // This would be implemented with actual command execution logic
    const result = { ...state, commandOutput: `Output of: ${command}` };
    
    // Add memory entry
    return addMemory('action', `Execute command: ${command}`)(result);
  });
  
  return toolBuilder
    .withDescription('Execute a shell command')
    .withExamples([
      { input: { command: 'ls -la' }, output: { commandOutput: 'Output of: ls -la' } }
    ])
    .build() as unknown as ToolBuilder<T>;
}

// ---------- Tool Validation ----------

/**
 * Validate tool parameters
 */
export const validateToolParams = (schema: z.ZodType, params: unknown): boolean => {
  try {
    schema.parse(params);
    return true;
  } catch {
    return false;
  }
};

/**
 * Sanitize tool parameters
 */
export const sanitizeToolParams = (schema: z.ZodType, params: unknown): unknown => {
  try {
    return schema.parse(params);
  } catch {
    return params; // Return original if validation fails
  }
};