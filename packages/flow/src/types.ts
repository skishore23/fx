/**
 * @fx/flow - Types
 * Explicit, stable workflow execution types
 */

import { BaseContext, Step, Plan, DurableExecutionConfig, DurableExecutionResult } from '@fx/core';

// ---------- Core Flow Types ----------

/**
 * Flow step - extends core Step with metadata
 */
export interface FlowStep<T extends BaseContext> {
  readonly name: string;
  readonly execute: Step<T>;
  readonly description?: string;
  readonly dependencies?: string[];
}

/**
 * Flow workflow - extends core Plan with flow-specific features
 */
export interface FlowWorkflow<T extends BaseContext> extends Plan<T> {
  readonly description?: string;
  readonly version?: string;
  readonly steps: FlowStep<T>[];
}

/**
 * Execution result
 */
export interface ExecutionResult<T extends BaseContext> {
  readonly finalState: T;
  readonly plan: FlowWorkflow<T>;
  readonly history: ExecutionHistoryEntry[];
  readonly duration: number;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Execution history entry
 */
export interface ExecutionHistoryEntry {
  readonly stepName: string;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly status: 'running' | 'completed' | 'failed' | 'skipped';
  readonly error?: string;
  readonly duration?: number;
}

/**
 * Flow configuration
 */
export interface FlowConfig {
  readonly enableLogging?: boolean;
  readonly enableMetrics?: boolean;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
  readonly timeoutMs?: number;
  readonly parallelExecution?: boolean;
  readonly validateDependencies?: boolean;
}

/**
 * Step builder options
 */
export interface StepOptions {
  readonly description?: string;
  readonly dependencies?: string[];
  readonly retry?: {
    readonly maxAttempts: number;
    readonly baseDelay: number;
    readonly exponentialBackoff?: boolean;
  };
  readonly timeout?: number;
  readonly validate?: <T extends BaseContext>(state: T) => boolean;
}


/**
 * Flow executor interface
 */
export interface FlowExecutor<T extends BaseContext> {
  readonly workflow: FlowWorkflow<T>;
  readonly config: FlowConfig;
  
  execute: (initialState: T) => Promise<ExecutionResult<T>>;
  plan: (state: T) => FlowWorkflow<T>;
  validate: () => { valid: boolean; errors: string[] };
  getDependencies: () => Map<string, string[]>;
  
  // Durable execution methods
  executeDurable: (initialState: T, config: DurableExecutionConfig<T>) => Promise<DurableExecutionResult<T>>;
  createDurableWorkflow: (config: DurableExecutionConfig<T>) => Step<T>;
  createPausableWorkflow: (config: DurableExecutionConfig<T>, pauseCondition?: (ctx: T) => boolean) => Step<T>;
  createResumableWorkflow: (config: DurableExecutionConfig<T>, checkpointId: string, extras?: Partial<T>) => Step<T>;
}

/**
 * Event types for flow execution
 */
export type FlowEvent<T extends BaseContext> = 
  | { type: 'flowStart'; workflow: FlowWorkflow<T> }
  | { type: 'stepStart'; stepName: string; step: FlowStep<T> }
  | { type: 'stepEnd'; stepName: string; status: 'completed' | 'failed'; duration: number; error?: string }
  | { type: 'stepRetry'; stepName: string; attempt: number; error: string }
  | { type: 'flowEnd'; success: boolean; duration: number; error?: string };

/**
 * Event handler type
 */
export type FlowEventHandler<T extends BaseContext> = (event: FlowEvent<T>) => void | Promise<void>;