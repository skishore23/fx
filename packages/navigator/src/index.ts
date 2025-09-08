/**
 * @fx/navigator - Topological Agent Runtime
 * Autonomous, emergent execution with guards and policies
 * Uses core's prompts and tools for intelligent decision-making
 */

// ---------- API Types ----------
export type {
  Guard,
  FxStep,
  PlanView,
  RunOpts,
  RunResult,
  Agent,
  RetryConfig,
  TimeoutConfig,
  IndependentConfig,
  CompactConfig,
  ApprovalConfig,
  PauseConfig,
  ReactConfig
} from './types';

// ---------- Navigator API ----------
export { 
  NavigatorAgent,
  createAgent,
  composeAgent,
  when,
  step,
  conditionalStep,
  createDurableAgent,
  createPausableAgent,
  createResumableAgent
} from './navigator';

// ---------- Re-export core functionality for topological agents ----------
export {
  // Core composition
  sequence,
  parallel,
  loopWhile,
  retry,
  timeout,
  validate,
  log,
  // LLM and prompts for intelligent decision-making
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  // Tools for agent capabilities
  createToolRegistry,
  createValidatedTool,
  // Patterns for autonomous behavior
  createReActPattern,
  createChainOfThoughtPattern,
  // State management
  updateState,
  addState,
  get,
  set,
  push,
  // Memory and observability
  enableLogging,
  disableLogging,
  logEvent,
  getEvents,
  // Durable execution
  checkpoint,
  resumeFromCheckpoint,
  pause,
  withAutoCheckpointing,
  executeDurable,
  createDurableStep,
  createPausableStep,
  createResumableStep,
  createMemoryPersistence,
  createFilePersistence,
  type Checkpoint,
  type PersistenceIO,
  type DurableExecutionConfig,
  type DurableExecutionResult,
  // Base types
  BaseContext,
  Step
} from '@fx/core';