/**
 * Fx - Minimal Functional Agent Framework
 * Clean, minimal API surface
 */

// ---------- Core Types ----------
import type { BaseContext, Step, Plan } from './types';
export type {
  BaseContext,
  Step,
  Plan
};

// ---------- Error Handling ----------
export { Either } from './types';

// ---------- Core Composition ----------
import { sequence, parallel, when, fromFunction, loopWhile } from './composition';
export {
  sequence,
  parallel,
  when,
  fromFunction as step,
  loopWhile
};

// ---------- State Management ----------
export { updateState, addState, get, set, push } from './lenses';

// ---------- Essential Patterns ----------
export { 
  createReActPattern, 
  createChainOfThoughtPattern
} from './patterns';

export { createPattern, createPatternMatcher, patterns } from './pattern-matching';

// ---------- Essential Tools ----------
export { createToolRegistry, createValidatedTool } from './tool-registry';

// ---------- Safe Functions ----------
export { safe, safeAsync } from './safe-functions';

// ---------- LLM Integration ----------
export { createOpenAIProvider, llmTemplateStep, promptTemplate } from './llm';

// ---------- Ledger System ----------
export { enableLogging, disableLogging, logEvent, getEvents } from './ledger';

// ---------- Observability ----------
export { ObservabilityManager, appendDecision, getDecisionHistory } from './observability';

// ---------- High-Level API ----------
export function createPlan<T extends BaseContext>(
  name: string,
  steps: Step<T>[]
): Plan<T> {
  return {
    name,
    execute: sequence(steps)
  };
}

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

export function createAgent<T extends BaseContext>(
  name: string,
  plan: Plan<T>
): Agent<T> {
  return new Agent(plan);
}