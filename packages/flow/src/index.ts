/**
 * @fx/flow - Explicit, stable workflow execution
 * Built on top of @fx/core with functional composition
 */

// Only re-export essential types that flow depends on
export type { BaseContext, Step } from '@fx/core';

// Flow-specific types
export type {
  FlowStep,
  FlowWorkflow,
  ExecutionResult,
  ExecutionHistoryEntry,
  FlowConfig,
  StepOptions,
  FlowEvent,
  FlowEventHandler
} from './types';

// Flow-specific implementations
export { 
  FlowExecutor,
  createFlowStep,
  createWorkflow,
  executeWorkflowSafe
} from './workflow';