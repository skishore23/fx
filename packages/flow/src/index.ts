/**
 * @fx/flow - Explicit, stable workflow execution
 * Built on top of @fx/core with functional composition
 */

// Re-export core functionality
export { 
  step, 
  sequence, 
  parallel, 
  when, 
  retry, 
  timeout, 
  validate, 
  log,
  createPlan,
  createAgent,
  BaseContext,
  Step,
  // LLM and Prompt functionality
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  createToolRegistry,
  createValidatedTool,
  // Patterns
  createReActPattern,
  createChainOfThoughtPattern,
  // Memory and state
  updateState,
  addState,
  get,
  set,
  push,
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
  type DurableExecutionResult
} from '@fx/core';

// Flow-specific types
export type {
  FlowStep,
  FlowWorkflow,
  ExecutionResult,
  ExecutionHistoryEntry,
  FlowConfig,
  StepOptions,
  FlowExecutor,
  FlowEvent,
  FlowEventHandler
} from './types';

// Import types for function signatures
import type { BaseContext } from '@fx/core';
import type { FlowWorkflow, FlowConfig, FlowExecutor } from './types';
import { FlowExecutor as FlowExecutorImpl } from './workflow';

// Flow-specific implementations
export { 
  createFlowStep,
  createWorkflow,
  createDurableWorkflow,
  createPausableWorkflow,
  createResumableWorkflow,
  executeWorkflowDurable,
  executeWorkflowSafe
} from './workflow';

/**
 * Create a flow executor
 */
export function createFlowExecutor<T extends BaseContext>(
  workflow: FlowWorkflow<T>,
  config?: FlowConfig
): FlowExecutor<T> {
  return new FlowExecutorImpl(workflow, config);
}