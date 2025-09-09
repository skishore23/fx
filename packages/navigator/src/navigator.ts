/**
 * @fx/navigator - Autonomous Runtime Implementation
 * Functional composition with guard-driven execution
 */

import { 
  BaseContext, 
  Step, 
  sequence, 
  parallel, 
  when as coreWhen, 
  loopWhile,
  retry,
  timeout,
  log,
  safeAsync,
  withLogging,
  logEvent,
  defaultJSONLLogger,
  type PersistenceIO} from '@fx/core';
import { 
  Guard, 
  FxStep, 
  PlanView, 
  RunOpts, 
  RunResult, 
  Agent,
  RetryConfig,
  TimeoutConfig,
  ApprovalConfig,
  ReactConfig
} from './types';


/**
 * Navigator Agent Implementation
 * Uses functional composition from core
 */
export class NavigatorAgent<TCtx extends BaseContext> implements Agent<TCtx> {
  public steps: FxStep<TCtx>[] = [];
  private policies: Map<string, unknown> = new Map();
  private independenceMap: Map<string, Set<string>> = new Map();
  private persistence?: PersistenceIO<TCtx>;
  private reactConfig?: ReactConfig<TCtx>;
  private checkpointSeq = 0;
  private executedSteps: Set<string> = new Set();

  constructor() {}


  /**
   * Run the agent using functional composition
   * Uses category theory principles: morphisms compose naturally
   */
  async run(ctx: TCtx, opts?: RunOpts<TCtx>): Promise<RunResult<TCtx>> {
    const startTime = Date.now();
    
    // Reset executed steps for this run
    this.executedSteps.clear();
    
    // Log agent start
    logEvent('agent-start', {
      agentType: 'navigator',
      timestamp: new Date().toISOString()
    });

    // Log to JSONL file
    defaultJSONLLogger.logWorkflowExecution({
      name: 'navigator-agent',
      runtime: 'navigator',
      startTime,
      endTime: startTime, // Will be updated later
      success: false, // Will be updated later
      stepCount: this.steps.length
    });
    
    // Create safe execution function using Either monad
    const safeExecution = safeAsync(async (inputCtx: TCtx) => {
      // Choose execution strategy based on configuration
      const executionStep = this.reactConfig 
        ? this.createReactExecutionStep()
        : this.createExecutionStep(opts);
      
      // Execute using core's functional composition
      return await sequence([
        log('execution_start'),
        executionStep,
        log('execution_complete')
      ])(inputCtx);
    });

    // Execute with Either monad
    const executionResult = await safeExecution(ctx);
    const duration = Date.now() - startTime;
    
    if (executionResult.tag === 'Left') {
      // Log agent failure
      logEvent('agent-failure', {
        agentType: 'navigator',
        error: executionResult.left.message,
        duration,
        timestamp: new Date().toISOString()
      });

      // Log to JSONL file
      defaultJSONLLogger.logWorkflowExecution({
        name: 'navigator-agent',
        runtime: 'navigator',
        startTime,
        endTime: Date.now(),
        success: false,
        error: executionResult.left.message,
        stepCount: this.steps.length
      });

      return {
        ctx,
        plan: { layers: [], blocked: {} },
        success: false,
        error: executionResult.left.message,
        duration
      };
    } else {
      // Log agent success
      logEvent('agent-success', {
        agentType: 'navigator',
        duration,
        timestamp: new Date().toISOString()
      });

      // Log to JSONL file
      defaultJSONLLogger.logWorkflowExecution({
        name: 'navigator-agent',
        runtime: 'navigator',
        startTime,
        endTime: Date.now(),
        success: true,
        stepCount: this.steps.length
      });

      const plan = await this.plan(ctx);
      return {
        ctx: executionResult.right,
        plan,
        success: true,
        duration
      };
    }
  }

  /**
   * Create execution step using functional composition
   * Uses category theory principles: morphisms compose naturally
   */
  private createExecutionStep(opts?: RunOpts<TCtx>): Step<TCtx> {
    const goal = opts?.goal;

    // Create the execution pipeline using functional composition
    const executionPipeline = async (ctx: TCtx) => {
      const runnable = this.getRunnableSteps(ctx);
      const layer = this.buildExecutionLayer(runnable, ctx);
      const result = await this.executeLayer(layer, ctx);
      return await this.markExecutedSteps(layer)(result);
    };

    // Create the main execution loop using core's loopWhile
    return loopWhile(
      (ctx: TCtx) => {
        const runnable = this.getRunnableSteps(ctx);
        return runnable.length > 0 && (!goal || !goal(ctx));
      },
      sequence([
        log('step_execution'),
        executionPipeline,
        log('step_completion')
      ])
    );
  }

  /**
   * Get execution plan using functional composition
   */
  async plan(ctx: TCtx): Promise<PlanView> {
    const runnable = this.getRunnableSteps(ctx);
    
    // Check blocked steps using functional composition
    const blocked = this.steps
      .filter(step => !runnable.includes(step))
      .reduce((acc, step) => {
        try {
          const guardResult = step.guard(ctx);
          if (!guardResult) {
            acc[step.name] = 'guard-false';
          }
        } catch (error) {
          acc[step.name] = 'guard-error';
        }
        return acc;
      }, {} as Record<string, string>);

    // Build layers using functional composition
    const layers = this.buildLayersRecursively(runnable, ctx, []);

    return { layers, blocked };
  }

  /**
   * Build execution layers recursively using functional composition
   */
  private buildLayersRecursively(
    remaining: FxStep<TCtx>[], 
    ctx: TCtx, 
    layers: string[][]
  ): string[][] {
    if (remaining.length === 0) return layers;
    
    const layer = this.buildExecutionLayer(remaining, ctx);
    
    if (layer.length === 0) {
      // No independent steps, create single-step layer
      const singleStep = remaining[0];
      return singleStep 
        ? this.buildLayersRecursively(remaining.slice(1), ctx, [...layers, [singleStep.name]])
        : layers;
    } else {
      const layerNames = layer.map(s => s.name);
      const newRemaining = remaining.filter(s => !layer.includes(s));
      return this.buildLayersRecursively(newRemaining, ctx, [...layers, layerNames]);
    }
  }

  /**
   * Configure ReAct pattern using core's functional approach
   * Uses functional composition for autonomous decision-making
   */
  react(cfg: ReactConfig<TCtx>): Agent<TCtx> {
    const newAgent = new NavigatorAgent<TCtx>();
    newAgent.steps = [...this.steps];
    newAgent.policies = new Map(this.policies);
    newAgent.independenceMap = new Map(this.independenceMap);
    newAgent.persistence = this.persistence;
    newAgent.reactConfig = cfg;
    return newAgent;
  }

  /**
   * Create a ReAct execution step using core's functional composition
   */
  private createReactExecutionStep(): Step<TCtx> {
    if (!this.reactConfig) {
      throw new Error('ReAct configuration not found');
    }

    const { goal, maxIters = 10 } = this.reactConfig;

    // Create the ReAct loop using core's functional composition
    return loopWhile(
      (ctx: TCtx) => {
        const iterationCount = (ctx as Record<string, unknown>).iterationCount as number || 0;
        return iterationCount < maxIters && (!goal || !goal(ctx));
      },
      sequence([
        log('react_iteration'),
        this.reactReasonStep.bind(this),
        log('react_acting'),
        this.reactActStep.bind(this),
        log('react_observing'),
        this.reactObserveStep.bind(this)
      ])
    );
  }

  /**
   * ReAct reasoning step - pure function using functional composition
   */
  private reactReasonStep = async (ctx: TCtx): Promise<TCtx> => {
    if (!this.reactConfig) return ctx;
    
    const { decide } = this.reactConfig;
    const nextStep = await decide(ctx);
    
    return {
      ...ctx,
      currentStep: nextStep,
      iterationCount: ((ctx as Record<string, unknown>).iterationCount as number || 0) + 1
    } as TCtx;
  };

  /**
   * ReAct action step - pure function using functional composition
   */
  private reactActStep = async (ctx: TCtx): Promise<TCtx> => {
    const currentStep = (ctx as Record<string, unknown>).currentStep as string;
    if (!currentStep) return ctx;

    // Execute the selected step using safe execution
    const step = this.steps.find(s => s.name === currentStep);
    if (!step) return ctx;

    try {
      const guardResult = step.guard(ctx);
      if (!guardResult) {
        return ctx;
      }
    } catch (error) {
      return ctx;
    }

    const executionResult = await safeAsync(step.run)(ctx);
    if (executionResult.tag === 'Left') {
      return ctx; // Fail silently for ReAct pattern
    }

    return {
      ...executionResult.right,
      lastAction: currentStep
    } as TCtx;
  };

  /**
   * ReAct observation step - pure function using functional composition
   */
  private reactObserveStep = async (ctx: TCtx): Promise<TCtx> => {
    const lastAction = (ctx as Record<string, unknown>).lastAction as string;
    const observation = lastAction 
      ? `Successfully executed ${lastAction}. Context updated.`
      : 'No action executed in this iteration.';
    
    return {
      ...ctx,
      lastObservation: observation,
      observationCount: ((ctx as Record<string, unknown>).observationCount as number || 0) + 1
    } as TCtx;
  };

  /**
   * Policy configuration - functional policy composition
   */
  get policy(): {
    retry: (name: string, cfg: RetryConfig) => NavigatorAgent<TCtx>;
    timeout: (msPerStep?: number) => NavigatorAgent<TCtx>;
    independent: (a: string[] | Guard<TCtx>, b: string[] | Guard<TCtx>) => NavigatorAgent<TCtx>;
    mergeStrategy: (strategy: (results: TCtx[], originalState: TCtx) => TCtx) => NavigatorAgent<TCtx>;
    compact: (selector: keyof TCtx | ((ctx: TCtx) => boolean), fn: (ctx: TCtx) => TCtx) => NavigatorAgent<TCtx>;
    approval: (name: string, cfg: ApprovalConfig) => NavigatorAgent<TCtx>;
    pauseIf: (pred: (ctx: TCtx) => boolean) => NavigatorAgent<TCtx>;
  } {
    return {
      retry: (name: string, cfg: RetryConfig) => {
        this.policies.set(`retry_${name}`, cfg);
        return this;
      },
      
      timeout: (msPerStep?: number) => {
        this.policies.set('timeout', { msPerStep });
        return this;
      },
      
      independent: (a: string[] | Guard<TCtx>, b: string[] | Guard<TCtx>) => {
        const aNames = Array.isArray(a) ? a : this.steps
          .filter(s => {
            try {
              return a(s.guard as unknown as TCtx);
            } catch {
              return false;
            }
          })
          .map(s => s.name);
        const bNames = Array.isArray(b) ? b : this.steps
          .filter(s => {
            try {
              return b(s.guard as unknown as TCtx);
            } catch {
              return false;
            }
          })
          .map(s => s.name);
        
        // Use functional composition for independence mapping
        aNames.forEach(aName => {
          if (!this.independenceMap.has(aName)) {
            this.independenceMap.set(aName, new Set());
          }
          bNames.forEach(bName => {
            this.independenceMap.get(aName)!.add(bName);
          });
        });
        return this;
      },
      
      mergeStrategy: (strategy: (results: TCtx[], originalState: TCtx) => TCtx) => {
        this.policies.set('mergeStrategy', strategy);
        return this;
      },
      
      compact: (selector: keyof TCtx | ((ctx: TCtx) => boolean), fn: (ctx: TCtx) => TCtx) => {
        this.policies.set('compact', { selector, fn });
        return this;
      },
      
      approval: (name: string, cfg: ApprovalConfig) => {
        this.policies.set(`approval_${name}`, cfg);
        return this;
      },
      
      pauseIf: (pred: (ctx: TCtx) => boolean) => {
        this.policies.set('pause', { pred });
        return this;
      }
    };
  }

  /**
   * Persistence configuration
   */
  persist(io: PersistenceIO<TCtx>): Agent<TCtx> {
    const newAgent = new NavigatorAgent<TCtx>();
    newAgent.steps = [...this.steps];
    newAgent.policies = new Map(this.policies);
    newAgent.independenceMap = new Map(this.independenceMap);
    newAgent.persistence = io;
    newAgent.reactConfig = this.reactConfig;
    return newAgent;
  }



  /**
   * Get runnable steps - pure function that filters steps based on guards
   */
  private getRunnableSteps(ctx: TCtx): FxStep<TCtx>[] {
    return this.steps.filter(step => {
      // Skip already executed steps
      if (this.executedSteps.has(step.name)) {
        return false;
      }
      
      try {
        return step.guard(ctx);
      } catch {
        return false;
      }
    });
  }

  /**
   * Build execution layer using functional composition
   * Creates independent step groups using functional programming patterns
   */
  private buildExecutionLayer(steps: FxStep<TCtx>[], ctx: TCtx): FxStep<TCtx>[] {
    return steps.reduce((layer: FxStep<TCtx>[], step: FxStep<TCtx>) => {
      // Check if step can be added to current layer (independent of existing steps)
      const canAdd = layer.every(layerStep => this.areIndependent(step.name, layerStep.name));
      
      if (canAdd) {
        layer.push(step);
      }
      
      return layer;
    }, []);
  }

  /**
   * Execute layer using core's parallel composition - pure function
   */
  private async executeLayer(layer: FxStep<TCtx>[], ctx: TCtx): Promise<TCtx> {
    if (layer.length === 0) {
      return ctx;
    }

    // Apply policies using functional composition
    const layerSteps = layer.map(step => {
      let stepWithPolicies = step.run;
      
      // Apply retry policy
      const retryConfig = this.policies.get(`retry_${step.name}`) as RetryConfig | undefined;
      if (retryConfig) {
        stepWithPolicies = retry(stepWithPolicies, retryConfig.times, retryConfig.startMs || 1000);
      }
      
      // Apply timeout policy
      const timeoutConfig = this.policies.get('timeout') as TimeoutConfig | undefined;
      if (timeoutConfig?.msPerStep) {
        stepWithPolicies = timeout(stepWithPolicies, timeoutConfig.msPerStep);
      }
      
      return stepWithPolicies;
    });

    // Use core's parallel with merge strategy
    const mergeStrategy = this.policies.get('mergeStrategy') as ((results: TCtx[], originalState: TCtx) => TCtx) | undefined;
    const defaultMergeStrategy = (results: TCtx[], originalState: TCtx) => {
      if (results.length === 0) return originalState;
      return results.reduce((acc, result) => ({ ...acc, ...result }), originalState);
    };
    
    return parallel(layerSteps, mergeStrategy || defaultMergeStrategy)(ctx);
  }

  /**
   * Mark executed steps using Kleisli composition
   */
  private markExecutedSteps = (layer: FxStep<TCtx>[]): Step<TCtx> => {
    return async (ctx: TCtx): Promise<TCtx> => {
      // Mark executed steps using functional approach
      layer.forEach(step => this.executedSteps.add(step.name));
      return ctx;
    };
  }


  /**
   * Check if two steps are independent
   */
  private areIndependent(stepA: string, stepB: string): boolean {
    const aDeps = this.independenceMap.get(stepA) || new Set();
    const bDeps = this.independenceMap.get(stepB) || new Set();
    
    return aDeps.has(stepB) || bDeps.has(stepA);
  }


}

/**
 * Create a navigator agent using functional composition
 * This is the proper functional way to create agents
 */
export function createNavigatorAgent<TCtx extends BaseContext>(steps: FxStep<TCtx>[]): Agent<TCtx> {
  const agent = new NavigatorAgent<TCtx>();
  agent.steps = steps;
  return agent;
}




/**
 * Create a step - fundamental morphism in the navigator category
 * Uses core's functional composition patterns with unified logging
 */
export function step<TCtx extends BaseContext>(
  name: string,
  guard: Guard<TCtx>,
  run: Step<TCtx>,
  opts?: {
    idempotentKey?: (ctx: TCtx) => string;
    projection?: (ctx: TCtx) => unknown;
    workflowName?: string;
    logToConsole?: boolean;
  }
): FxStep<TCtx> {
  // Wrap the step with unified logging
  const loggedStep = withLogging(run, name, {
    runtime: 'navigator',
    workflowName: opts?.workflowName,
    logToConsole: opts?.logToConsole
  });

  return {
    name,
    guard,
    run: loggedStep,
    idempotentKey: opts?.idempotentKey,
    projection: opts?.projection
  };
}


/**
 * Create a conditional step using functional composition
 */
export function conditionalStep<TCtx extends BaseContext>(
  name: string,
  predicate: (ctx: TCtx) => boolean,
  thenStep: Step<TCtx>,
  elseStep?: Step<TCtx>
): FxStep<TCtx> {
  return step(
    name,
    predicate,
    coreWhen(predicate, thenStep, elseStep)
  );
}