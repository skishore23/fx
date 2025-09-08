/**
 * Fx - AI Agent Framework
 * Simple, functional approach to building autonomous AI agents
 */

// ---------- Core Types ----------

// State is just a plain object - simple and intuitive
export type State = Record<string, unknown>;

// Step transforms state - pure function
export type Step<T = State> = (state: T) => Promise<T>;

// Workflow is a composition of steps
export type Workflow<T = State> = Step<T>;

// Path for nested state access
export type Path = string;

// Agent encapsulates a workflow with metadata
export type Agent<T = State> = {
  readonly name: string;
  readonly workflow: Workflow<T>;
  readonly config?: FxConfig;
};

// ---------- Configuration & Error Types ----------

export interface FxConfig {
  readonly enableLogging?: boolean;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
}

export interface FxError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: string;
}

export interface Event {
  readonly id: string;
  readonly name: string;
  readonly timestamp: string;
  readonly data?: unknown;
}

// ---------- Main API Types ----------

// Simple, direct API similar to the original blog post
export interface FxAPI {
  // Core step creation
  action: <T = State>(name: string, transform: (state: T) => T | Promise<T>) => Step<T>;
  prompt: <T = State>(name: string, buildPrompt: (state: T) => string, llm: (prompt: string) => Promise<string>) => Step<T>;

  // State operations
  set: <T = State>(path: Path, value: unknown) => Step<T>;
  update: <T = State>(path: Path, updater: (current: unknown) => unknown) => Step<T>;
  push: <T = State>(path: Path, item: unknown) => Step<T>;
  remove: <T = State>(path: Path, predicate: ((item: unknown, index: number) => boolean) | number) => Step<T>;

  // Composition
  sequence: <T = State>(...steps: Step<T>[]) => Step<T>;
  parallel: <T = State>(...steps: Step<T>[]) => Step<T>;

  // Control flow
  when: <T = State>(condition: (state: T) => boolean, thenStep: Step<T>, elseStep?: Step<T>) => Step<T>;
  loopWhile: <T = State>(condition: (state: T) => boolean, body: Step<T>) => Step<T>;

  // Resilience
  wrap: <T = State>(name: string, step: Step<T>) => Step<T>;
  retry: <T = State>(step: Step<T>, options?: { attempts?: number; delay?: number }) => Step<T>;

  // Execution
  run: <T = State>(workflow: Workflow<T>, initialState: T) => Promise<T>;
  spawn: <T = State>(workflow: Workflow<T>, initialState: T) => Promise<T>;

  // Agent creation
  agent: <T = State>(name: string, workflow: Workflow<T>) => Agent<T>;

  // Configuration
  configure: (config: Partial<FxConfig>) => FxAPI;
  enableLogging: () => FxAPI;
  disableLogging: () => FxAPI;
}
