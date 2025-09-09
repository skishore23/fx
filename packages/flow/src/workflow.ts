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
  safe,
  safeAsync,
  withLogging,
  logEvent,
  getEvents,
  defaultJSONLLogger,
  Either} from '@fx/core';
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
   * Execute workflow using core's functional composition
   * Uses Either monad for error handling
   */
  async execute(initialState: T): Promise<ExecutionResult<T>> {
    const startTime = Date.now();
    const history: ExecutionHistoryEntry[] = [];

    // Log workflow start using core's event system
    logEvent('workflow-start', { 
      workflowName: this.workflow.name,
      timestamp: new Date().toISOString()
    });

    // Log to JSONL file
    defaultJSONLLogger.logWorkflowExecution({
      name: this.workflow.name,
      runtime: 'flow',
      startTime,
      endTime: startTime, // Will be updated later
      success: false, // Will be updated later
      stepCount: this.workflow.steps.length
    });

    this.emitEvent({ type: 'flowStart', workflow: this.workflow });

    // Create safe execution using Either monad
    const safeExecution = safeAsync(async (ctx: T) => {
      const executionStep = this.createExecutionStep(history);
      return await executionStep(ctx);
    });

    const executionResult = await safeExecution(initialState);
    const duration = Date.now() - startTime;

    if (executionResult.tag === 'Left') {
      // Log workflow failure using core's event system
      logEvent('workflow-failure', { 
        workflowName: this.workflow.name,
        error: executionResult.left.message,
        duration,
        timestamp: new Date().toISOString()
      });

      // Log to JSONL file
      defaultJSONLLogger.logWorkflowExecution({
        name: this.workflow.name,
        runtime: 'flow',
        startTime,
        endTime: Date.now(),
        success: false,
        error: executionResult.left.message,
        stepCount: this.workflow.steps.length
      });

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
      // Log workflow success using core's event system
      logEvent('workflow-success', { 
        workflowName: this.workflow.name,
        duration,
        timestamp: new Date().toISOString()
      });

      // Log to JSONL file
      defaultJSONLLogger.logWorkflowExecution({
        name: this.workflow.name,
        runtime: 'flow',
        startTime,
        endTime: Date.now(),
        success: true,
        stepCount: this.workflow.steps.length
      });

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
   * Wrap flow step with logging and error handling using unified logging system
   */
  private wrapFlowStep(flowStep: FlowStep<T>, _history: ExecutionHistoryEntry[]): Step<T> {
    const stepWithPolicies = this.createStepWithPolicies(flowStep);
    
    // Use core's unified logging system
    return withLogging(stepWithPolicies, flowStep.name, {
      runtime: 'flow',
      workflowName: this.workflow.name,
      logToConsole: this.config.logToConsole
    });
  }

  /**
   * Create step with policies using functional composition
   */
  private createStepWithPolicies(flowStep: FlowStep<T>): Step<T> {
    let stepToExecute = flowStep.execute;
    
    // Apply retry policy if configured
    if (this.config.maxRetries) {
      stepToExecute = retry(stepToExecute, this.config.maxRetries);
    }

    // Apply timeout policy if configured
    if (this.config.timeoutMs) {
      stepToExecute = timeout(stepToExecute, this.config.timeoutMs);
    }

    return stepToExecute;
  }


  /**
   * Get execution plan
   */
  plan(_state: T): FlowWorkflow<T> {
    return this.workflow;
  }


  /**
   * Validate workflow using functional composition
   */
  validate(): { valid: boolean; errors: string[] } {
    const stepNames = this.workflow.steps.map(s => s.name);
    
    // Check for duplicate step names using functional composition
    const duplicateErrors = this.findDuplicateStepNames(stepNames);
    
    // Check dependencies using functional composition
    const dependencyErrors = this.config.validateDependencies 
      ? this.validateDependencies(stepNames)
      : [];

    const errors = [...duplicateErrors, ...dependencyErrors];

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Find duplicate step names using functional composition
   */
  private findDuplicateStepNames(stepNames: string[]): string[] {
    const duplicates = stepNames
      .filter((name, index) => stepNames.indexOf(name) !== index)
      .filter((name, index, arr) => arr.indexOf(name) === index); // Remove duplicates from duplicates array
    
    return duplicates.length > 0 
      ? [`Duplicate step names: ${duplicates.join(', ')}`]
      : [];
  }

  /**
   * Validate dependencies using functional composition
   */
  private validateDependencies(stepNames: string[]): string[] {
    const dependencies = this.getDependencies();
    
    return Array.from(dependencies.entries())
      .flatMap(([stepName, deps]) => 
        deps
          .filter(dep => !stepNames.includes(dep))
          .map(dep => `Step '${stepName}' depends on non-existent step '${dep}'`)
      );
  }

  /**
   * Get step dependencies using functional composition
   */
  getDependencies(): Map<string, string[]> {
    return new Map(
      this.workflow.steps.map(step => [
        step.name, 
        step.dependencies || []
      ])
    );
  }

  /**
   * Add event handler
   */
  onEvent(handler: FlowEventHandler<T>): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event using functional composition
   */
  private emitEvent(event: FlowEvent<T>): void {
    this.eventHandlers.forEach(handler => {
      const safeHandler = safe(() => handler(event));
      const result = safeHandler(undefined);
      if (result.tag === 'Left') {
        console.error('Error in event handler:', result.left);
      }
    });
  }

  /**
   * Get workflow events from core's logging system
   */
  getWorkflowEvents() {
    return getEvents().filter(event => 
      event.name.startsWith('workflow-') || 
      event.name.startsWith('step-')
    );
  }

  /**
   * Get step events from core's logging system
   */
  getStepEvents(stepName?: string) {
    const stepEvents = getEvents().filter(event => event.name.startsWith('step-'));
    
    if (stepName) {
      return stepEvents.filter(event => 
        event.data && 
        typeof event.data === 'object' && 
        'stepName' in event.data && 
        event.data.stepName === stepName
      );
    }
    
    return stepEvents;
  }
}

// ---------- Pure Functional Composition Functions ----------

/**
 * Create a flow step using functional composition with unified logging
 */
export function createFlowStep<T extends BaseContext>(
  name: string,
  execute: Step<T>,
  options?: {
    description?: string;
    dependencies?: string[];
    workflowName?: string;
    logToConsole?: boolean;
  }
): FlowStep<T> {
  // Wrap the step with unified logging
  const loggedStep = withLogging(execute, name, {
    runtime: 'flow',
    workflowName: options?.workflowName,
    logToConsole: options?.logToConsole
  });

  return {
    name,
    execute: loggedStep,
    description: options?.description,
    dependencies: options?.dependencies
  };
}

/**
 * Create a workflow using pure functional composition
 * Simplified - users can create workflows directly
 */
export function createWorkflow<T extends BaseContext>(
  name: string,
  steps: Step<T>[],
  options?: {
    description?: string;
    version?: string;
  }
): FlowWorkflow<T> {
  return {
    name,
    execute: sequence(steps),
    description: options?.description,
    version: options?.version,
    steps: steps.map((step, index) => ({
      name: `step_${index}`,
      execute: step
    }))
  };
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