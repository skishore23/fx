/**
 * Fx - Minimal Functional Agent Framework
 * Clean, minimal API surface
 */

// ---------- Core Types ----------
import type { BaseContext, Step, Plan } from './types';
export type { BaseContext, Step, Plan };
export { Either } from './types';

// ---------- Core Composition ----------
import { sequence, parallel, when, fromFunction, loopWhile, tryInOrder, retry, timeout, validate, log, logInfo, logWarn, logErrorStep, logDebug, fail, compose, composeAll, identity, withLogging, createLoggedStep, withLoggingAll, fromFunctionWithLogging, type StepExecutionInfo } from './composition';
export {
  sequence,
  parallel,
  when,
  fromFunction as step,
  loopWhile,
  tryInOrder,
  retry,
  timeout,
  validate,
  log,
  logInfo,
  logWarn,
  logErrorStep,
  logDebug,
  fail,
  compose,
  composeAll,
  identity,
  withLogging,
  createLoggedStep,
  withLoggingAll,
  fromFunctionWithLogging,
  type StepExecutionInfo
};

// ---------- State Management & Lenses ----------
export { 
  updateState, 
  addState, 
  addMemoryEntry,
  get, 
  set, 
  push, 
  remove,
  update
} from './lenses';

// ---------- Memory System ----------
export { 
  addMemory,
  getMemory,
  clearMemory,
  searchMemory,
  getMemoryCount,
  memoryLens,
  filteredMemoryLens,
  // New intuitive names
  logObservation,
  logAction,
  logOutcome,
  logError,
  // Legacy aliases for backward compatibility
  addObservation,
  addAction,
  addResult,
  addError,
  getRecentMemory,
  getMemoryByType,
  getMemorySince,
  searchMemoryContent,
  type MemoryEntry,
  type MemoryFilter
} from './memory';

// ---------- Patterns ----------
export { 
  createReActPattern, 
  createChainOfThoughtPattern
} from './patterns';

export { createPattern, createPatternMatcher, patterns } from './pattern-matching';

// ---------- Tools ----------
export { createToolRegistry, createValidatedTool } from './tool-registry';

// ---------- Safe Functions ----------
export { safe, safeAsync } from './safe-functions';

// ---------- LLM Integration ----------
export { createOpenAIProvider, llmTemplateStep, promptTemplate } from './llm';

// ---------- Ledger System ----------
export { 
  enableLogging, 
  enableStateLogging,
  enableFullLogging,
  disableLogging, 
  logEvent, 
  logStateEvent,
  createCheckpoint,
  getStateAtCheckpoint,
  replayFromCheckpoint,
  getEvents, 
  getStateEvents,
  getStateEventsByStep,
  getStateEventsByRuntime,
  getCheckpoints,
  clearEvents, 
  getEventsByName, 
  getEventStats,
  getStateEventStats,
  // Step-based logging
  logStep,
  logStateStep,
  checkpointStep,
  // State recreation
  recreateStateFromEvents,
  getStateAtTime,
  type StateEvent,
  type StateCheckpoint
} from './ledger';

// ---------- Durable Execution ----------
export { 
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
  type DurableExecutionResult
} from './durable-execution';

// ---------- Observability ----------
export { 
  ObservabilityManager, 
  appendDecision, 
  getDecisionHistory,
  JSONLLogger,
  defaultJSONLLogger
} from './observability';


export class Agent<T extends BaseContext> {
  private plan: Plan<T>;
  private status: 'stopped' | 'running' | 'paused' | 'error' | 'completed' = 'stopped';
  private state: T | null = null;

  constructor(plan: Plan<T>) {
    this.plan = plan;
  }

  async start(initialState: T): Promise<T> {
    this.status = 'running';
    this.state = initialState;
    
    try {
      const result = await this.plan.execute(initialState);
      this.state = result;
      this.status = 'completed';
      return result;
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  getStatus() {
    return this.status;
  }

  getState() {
    return this.state;
  }
}
