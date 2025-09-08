/**
 * @fx/flow - Workflow Implementation
 * Uses core's functional composition for explicit, stable execution
 */

import { 
  BaseContext, 
  Step, 
  sequence, 
  retry, 
  timeout, 
  executeDurable,
  createDurableStep,
  createPausableStep,
  createResumableStep,
  safeAsync,
  Either,
  type DurableExecutionConfig,
  type DurableExecutionResult,
  type PersistenceIO
} from '@fx/core';
import { 
  FlowStep, 
  FlowWorkflow, 
  ExecutionResult, 
  ExecutionHistoryEntry, 
  FlowConfig,
  FlowEvent,
  FlowEventHandler
} from './types';

/**
 * Flow Executor Implementation
 * Uses core's functional composition patterns
 */
export class FlowExecutor<T extends BaseContext> {
  private eventHandlers: FlowEventHandler<T>[] = [];

  constructor(
    public readonly workflow: FlowWorkflow<T>,
    public readonly config: FlowConfig = {}
  ) {}

  /**
   * Execute workflow using core's functional composition with Either monads
   */
  async execute(initialState: T): Promise<ExecutionResult<T>> {
    const startTime = Date.now();
    const history: ExecutionHistoryEntry[] = [];

    this.emitEvent({ type: 'flowStart', workflow: this.workflow });

    // Create safe execution using Either monad
    const safeExecution = safeAsync(async (ctx: T) => {
      const executionStep = this.createExecutionStep(history);
      return await executionStep(ctx);
    });

    const executionResult = await safeExecution(initialState);
    const duration = Date.now() - startTime;

    if (executionResult.tag === 'Left') {
      this.emitEvent({ type: 'flowEnd', success: false, duration, error: executionResult.left.message });
      
      return {
        finalState: initialState,
        plan: this.workflow,
        history,
        duration,
        success: false,
        error: executionResult.left.message
      };
    } else {
      this.emitEvent({ type: 'flowEnd', success: true, duration });
      
      return {
        finalState: executionResult.right,
        plan: this.workflow,
        history,
        duration,
        success: true
      };
    }
  }

  /**
   * Create execution step using core's functional composition
   */
  private createExecutionStep(history: ExecutionHistoryEntry[]): Step<T> {
    // Convert flow steps to core steps with logging and error handling
    const coreSteps = this.workflow.steps.map(flowStep => {
      return this.wrapFlowStep(flowStep, history);
    });

    // Use core's sequence for linear execution
    return sequence(coreSteps);
  }

  /**
   * Wrap flow step with logging and error handling using Either monads
   */
  private wrapFlowStep(flowStep: FlowStep<T>, history: ExecutionHistoryEntry[]): Step<T> {
    return async (state: T) => {
      const startTime = new Date();
      
      // Add to history
      const historyEntry: ExecutionHistoryEntry = {
        stepName: flowStep.name,
        startTime,
        status: 'running'
      };
      history.push(historyEntry);

      this.emitEvent({ type: 'stepStart', stepName: flowStep.name, step: flowStep });

      // Create safe execution using Either monad
      const safeStepExecution = safeAsync(async (ctx: T) => {
        // Apply retry policy if configured
        let stepToExecute = flowStep.execute;
        
        if (this.config.maxRetries) {
          stepToExecute = retry(stepToExecute, this.config.maxRetries);
        }

        // Apply timeout policy if configured
        if (this.config.timeoutMs) {
          stepToExecute = timeout(stepToExecute, this.config.timeoutMs);
        }

        return await stepToExecute(ctx);
      });

      const executionResult = await safeStepExecution(state);
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      if (executionResult.tag === 'Left') {
        // Update history for failure
        Object.assign(historyEntry, {
          endTime,
          status: 'failed',
          error: executionResult.left.message,
          duration
        });

        this.emitEvent({ 
          type: 'stepEnd', 
          stepName: flowStep.name, 
          status: 'failed', 
          duration,
          error: executionResult.left.message
        });

        // Re-throw the error to maintain the Either pattern
        throw new Error(executionResult.left.message);
      } else {
        // Update history for success
        Object.assign(historyEntry, {
          endTime,
          status: 'completed',
          duration
        });

        this.emitEvent({ 
          type: 'stepEnd', 
          stepName: flowStep.name, 
          status: 'completed', 
          duration
        });

        return executionResult.right;
      }
    };
  }

  /**
   * Get execution plan
   */
  plan(_state: T): FlowWorkflow<T> {
    return this.workflow;
  }

  /**
   * Execute workflow with durable execution using core's durable execution
   */
  async executeDurable(
    initialState: T, 
    config: DurableExecutionConfig<T>
  ): Promise<DurableExecutionResult<T>> {
    const executionStep = this.createExecutionStep([]);
    return await executeDurable(executionStep, initialState, config);
  }

  /**
   * Create a durable workflow step using core's durable execution
   */
  createDurableWorkflow(config: DurableExecutionConfig<T>): Step<T> {
    const executionStep = this.createExecutionStep([]);
    return createDurableStep(executionStep, config);
  }

  /**
   * Create a pausable workflow step using core's durable execution
   */
  createPausableWorkflow(
    config: DurableExecutionConfig<T>,
    pauseCondition?: (ctx: T) => boolean
  ): Step<T> {
    const executionStep = this.createExecutionStep([]);
    return createPausableStep(executionStep, config.persistence!, pauseCondition);
  }

  /**
   * Create a resumable workflow step using core's durable execution
   */
  createResumableWorkflow(
    config: DurableExecutionConfig<T>,
    checkpointId: string,
    extras?: Partial<T>
  ): Step<T> {
    const executionStep = this.createExecutionStep([]);
    return createResumableStep(executionStep, config.persistence!, checkpointId, extras);
  }

  /**
   * Validate workflow
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for duplicate step names
    const stepNames = this.workflow.steps.map(s => s.name);
    const duplicates = stepNames.filter((name, index) => stepNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate step names: ${duplicates.join(', ')}`);
    }

    // Check dependencies
    if (this.config.validateDependencies) {
      const dependencies = this.getDependencies();
      for (const [stepName, deps] of dependencies) {
        for (const dep of deps) {
          if (!stepNames.includes(dep)) {
            errors.push(`Step '${stepName}' depends on non-existent step '${dep}'`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get step dependencies
   */
  getDependencies(): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    
    for (const step of this.workflow.steps) {
      deps.set(step.name, step.dependencies || []);
    }
    
    return deps;
  }

  /**
   * Add event handler
   */
  onEvent(handler: FlowEventHandler<T>): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event
   */
  private emitEvent(event: FlowEvent<T>): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }
}

// ---------- Pure Functional Composition Functions ----------

/**
 * Create a flow step using functional composition
 */
export function createFlowStep<T extends BaseContext>(
  name: string,
  execute: Step<T>,
  options?: {
    description?: string;
    dependencies?: string[];
  }
): FlowStep<T> {
  return {
    name,
    execute,
    description: options?.description,
    dependencies: options?.dependencies
  };
}

/**
 * Create a workflow using pure functional composition
 */
export function createWorkflow<T extends BaseContext>(
  name: string,
  steps: Step<T>[],
  options?: {
    description?: string;
    version?: string;
  }
): FlowWorkflow<T> {
  const executionStep = sequence(steps);
  
  return {
    name,
    execute: executionStep,
    description: options?.description,
    version: options?.version,
    steps: steps.map((step, index) => ({
      name: `step_${index}`,
      execute: step
    }))
  };
}

/**
 * Create a durable workflow using core's durable execution
 */
export function createDurableWorkflow<T extends BaseContext>(
  name: string,
  steps: Step<T>[],
  config: DurableExecutionConfig<T>,
  options?: {
    description?: string;
    version?: string;
  }
): FlowWorkflow<T> {
  const executionStep = sequence(steps);
  const durableStep = createDurableStep(executionStep, config);
  
  return {
    name,
    execute: durableStep,
    description: options?.description,
    version: options?.version,
    steps: steps.map((step, index) => ({
      name: `step_${index}`,
      execute: step
    }))
  };
}

/**
 * Create a pausable workflow using core's durable execution
 */
export function createPausableWorkflow<T extends BaseContext>(
  name: string,
  steps: Step<T>[],
  persistence: PersistenceIO<T>,
  pauseCondition?: (ctx: T) => boolean,
  options?: {
    description?: string;
    version?: string;
  }
): FlowWorkflow<T> {
  const executionStep = sequence(steps);
  const pausableStep = createPausableStep(executionStep, persistence, pauseCondition);
  
  return {
    name,
    execute: pausableStep,
    description: options?.description,
    version: options?.version,
    steps: steps.map((step, index) => ({
      name: `step_${index}`,
      execute: step
    }))
  };
}

/**
 * Create a resumable workflow using core's durable execution
 */
export function createResumableWorkflow<T extends BaseContext>(
  name: string,
  steps: Step<T>[],
  persistence: PersistenceIO<T>,
  checkpointId: string,
  extras?: Partial<T>,
  options?: {
    description?: string;
    version?: string;
  }
): FlowWorkflow<T> {
  const executionStep = sequence(steps);
  const resumableStep = createResumableStep(executionStep, persistence, checkpointId, extras);
  
  return {
    name,
    execute: resumableStep,
    description: options?.description,
    version: options?.version,
    steps: steps.map((step, index) => ({
      name: `step_${index}`,
      execute: step
    }))
  };
}

/**
 * Execute workflow with durable execution using core's functions
 */
export async function executeWorkflowDurable<T extends BaseContext>(
  workflow: FlowWorkflow<T>,
  initialState: T,
  config: DurableExecutionConfig<T>
): Promise<DurableExecutionResult<T>> {
  return await executeDurable(workflow.execute, initialState, config);
}

/**
 * Execute workflow with Either monad error handling
 */
export async function executeWorkflowSafe<T extends BaseContext>(
  workflow: FlowWorkflow<T>,
  initialState: T
): Promise<Either<Error, T>> {
  const safeExecution = safeAsync(workflow.execute);
  return await safeExecution(initialState);
}