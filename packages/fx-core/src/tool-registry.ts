/**
 * Tool Registry System
 * Declarative tool registration and execution
 */

import { BaseContext, Step } from './types';

/**
 * Tool definition interface
 */
export interface ToolDefinition<T extends BaseContext = BaseContext> {
  name: string;
  description: string;
  execute: Step<T>;
  schema?: any; // Zod schema for validation
  validateInput?: (input: any) => any; // Input validation function
}

/**
 * Enhanced tool registry for managing and executing tools
 */
export class EnhancedToolRegistry<T extends BaseContext = BaseContext> {
  private tools: Map<string, ToolDefinition<T>> = new Map();

  /**
   * Register a tool
   */
  register(tool: ToolDefinition<T>): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Register multiple tools
   */
  registerMany(tools: ToolDefinition<T>[]): this {
    tools.forEach(tool => this.register(tool));
    return this;
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition<T> | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition<T>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name with optional input validation
   */
  async execute(name: string, state: T, input?: any): Promise<T> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    
    // Validate input if schema is provided
    if (tool.schema && input) {
      const validationResult = tool.schema.safeParse(input);
      if (!validationResult.success) {
        throw new Error(`Invalid input for tool ${name}: ${validationResult.error.message}`);
      }
    }
    
    // Use custom validation if provided
    if (tool.validateInput && input) {
      input = tool.validateInput(input);
    }
    
    return await tool.execute(state);
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeMany(names: string[], state: T): Promise<T> {
    let currentState = state;
    for (const name of names) {
      currentState = await this.execute(name, currentState);
    }
    return currentState;
  }

  /**
   * Create a step that executes tools based on state
   */
  createExecutorStep(toolSelector: (state: T) => string[]): Step<T> {
    return async (state: T) => {
      const toolNames = toolSelector(state);
      return await this.executeMany(toolNames, state);
    };
  }
}

/**
 * Create a new enhanced tool registry
 */
export const createToolRegistry = <T extends BaseContext = BaseContext>(): EnhancedToolRegistry<T> => {
  return new EnhancedToolRegistry<T>();
};

/**
 * Create a tool definition
 */
export const createTool = <T extends BaseContext = BaseContext>(
  name: string,
  description: string,
  execute: Step<T>,
  schema?: any,
  validateInput?: (input: any) => any
): ToolDefinition<T> => ({
  name,
  description,
  execute,
  schema,
  validateInput
});

/**
 * Create a tool with schema validation and type safety
 */
export const createValidatedTool = <T extends BaseContext = BaseContext, TInput = any>(
  name: string,
  description: string,
  schema: any, // Zod schema
  execute: (input: TInput, state: T) => Promise<T> | T
): ToolDefinition<T> => ({
  name,
  description,
  execute: async (state: T) => {
    // Extract input from state or use default
    const input = (state as any).toolInput || {};
    
    // Validate input
    const validationResult = schema.safeParse(input);
    if (!validationResult.success) {
      throw new Error(`Invalid input for tool ${name}: ${validationResult.error.message}`);
    }
    
    return await execute(validationResult.data, state);
  },
  schema,
  validateInput: (input: any) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new Error(`Invalid input: ${result.error.message}`);
    }
    return result.data;
  }
});
