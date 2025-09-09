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
  createNavigatorAgent,
  step,
  conditionalStep
} from './navigator';

// Only re-export essential types that navigator depends on
export type { BaseContext, Step } from '@fx/core';