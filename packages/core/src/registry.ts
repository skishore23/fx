/**
 * Tool Registry for managing and calling tools
 * Simplified implementation with clean types
 */

import { z } from 'zod';
import { Step, BaseContext } from './types';

// Global tools registry
const toolsRegistry = new Map<string, {
  schema: z.ZodType<unknown>;
  factory: (params: unknown) => Step<BaseContext>;
}>();

export class ToolRegistry {

  /**
   * Register a tool with validation schema
   */
  static register<S extends BaseContext, Schema extends z.ZodType>(
    name: string,
    schema: Schema,
    factory: (params: z.infer<Schema>) => Step<S>
  ): void {
    toolsRegistry.set(name, { 
      schema, 
      factory: factory as unknown as (params: unknown) => Step<BaseContext>
    });
  }

  /**
   * Call a registered tool
   */
  static call<S extends BaseContext>(
    name: string,
    args: readonly unknown[]
  ): Step<S> {
    const tool = toolsRegistry.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    // Validate arguments - args should be an array with one object
    const validatedArgs = tool.schema.parse(args[0]);
    
    // Call the factory with validated arguments
    return tool.factory(validatedArgs) as unknown as Step<S>;
  }

  /**
   * Check if a tool is registered
   */
  static has(name: string): boolean {
    return toolsRegistry.has(name);
  }

  /**
   * Get all registered tool names
   */
  static list(): string[] {
    return Array.from(toolsRegistry.keys());
  }

  /**
   * Clear all tools
   */
  static clear(): void {
    toolsRegistry.clear();
  }
}

/**
 * Register a tool with validation
 */
export function registerTool<S extends BaseContext, Schema extends z.ZodType>(
  name: string,
  schema: Schema,
  factory: (params: z.infer<Schema>) => Step<S>
): void {
  ToolRegistry.register(name, schema, factory);
}

/**
 * Call a tool
 */
export function callTool<S extends BaseContext>(
  name: string,
  args: readonly unknown[]
): Step<S> {
  return ToolRegistry.call(name, args);
}