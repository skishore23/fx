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
  checkpoint,
  resumeFromCheckpoint,
  pause,
  withAutoCheckpointing,
  executeDurable,
  createDurableStep,
  createPausableStep,
  createResumableStep,
  createMemoryPersistence,
  type Checkpoint,
  type PersistenceIO,
  type DurableExecutionConfig,
  type DurableExecutionResult
} from '@fx/core';
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
    
    if (executionResult.tag === 'Left') {
      return {
        ctx,
        plan: { layers: [], blocked: {} },
        success: false,
        error: executionResult.left.message,
        duration: Date.now() - startTime
      };
    } else {
      const plan = await this.plan(ctx);
      return {
        ctx: executionResult.right,
        plan,
        success: true,
        duration: Date.now() - startTime
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
   * Get execution plan
   */
  async plan(ctx: TCtx): Promise<PlanView> {
    const runnable = this.getRunnableSteps(ctx);
    const layers: string[][] = [];
    const blocked: Record<string, string> = {};

    // Check blocked steps
    for (const step of this.steps) {
      if (!runnable.includes(step)) {
        try {
          if (!step.guard(ctx)) {
            blocked[step.name] = 'guard-false';
          }
        } catch (error) {
          blocked[step.name] = 'guard-error';
        }
      }
    }

    // Build layers
    let remaining = [...runnable];
    while (remaining.length > 0) {
      const layer = this.buildExecutionLayer(remaining, ctx);
      if (layer.length === 0) {
        // No independent steps, create single-step layer
        const singleStep = remaining[0];
        if (singleStep) {
          layers.push([singleStep.name]);
          remaining = remaining.slice(1);
        } else {
          break;
        }
      } else {
        layers.push(layer.map(s => s.name));
        remaining = remaining.filter(s => !layer.includes(s));
      }
    }

    return { layers, blocked };
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
   * ReAct reasoning step - pure function
   */
  private async reactReasonStep(ctx: TCtx): Promise<TCtx> {
    if (!this.reactConfig) return ctx;
    
    const { decide } = this.reactConfig;
    const nextStep = await decide(ctx);
    
    return {
      ...ctx,
      currentStep: nextStep,
      iterationCount: ((ctx as Record<string, unknown>).iterationCount as number || 0) + 1
    } as TCtx;
  }

  /**
   * ReAct action step - pure function
   */
  private async reactActStep(ctx: TCtx): Promise<TCtx> {
    const currentStep = (ctx as Record<string, unknown>).currentStep as string;
    if (!currentStep) return ctx;

    // Execute the selected step
    const step = this.steps.find(s => s.name === currentStep);
    if (step && step.guard(ctx)) {
      const result = await step.run(ctx);
      return { ...result, lastAction: currentStep } as TCtx;
    }

    return ctx;
  }

  /**
   * ReAct observation step - pure function
   * Analyzes the results and updates context with observations
   */
  private async reactObserveStep(ctx: TCtx): Promise<TCtx> {
    const lastAction = (ctx as Record<string, unknown>).lastAction as string;
    const observation = lastAction 
      ? `Successfully executed ${lastAction}. Context updated.`
      : 'No action executed in this iteration.';
    
    return {
      ...ctx,
      lastObservation: observation,
      observationCount: ((ctx as Record<string, unknown>).observationCount as number || 0) + 1
    } as TCtx;
  }

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
        const aNames = Array.isArray(a) ? a : this.steps.filter(s => {
          try {
            return a(s.guard as unknown as TCtx);
          } catch {
            return false;
          }
        }).map(s => s.name);
        const bNames = Array.isArray(b) ? b : this.steps.filter(s => {
          try {
            return b(s.guard as unknown as TCtx);
          } catch {
            return false;
          }
        }).map(s => s.name);
        
        for (const aName of aNames) {
          if (!this.independenceMap.has(aName)) {
            this.independenceMap.set(aName, new Set());
          }
          for (const bName of bNames) {
            this.independenceMap.get(aName)!.add(bName);
          }
        }
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
      // Mark executed steps
      for (const step of layer) {
        this.executedSteps.add(step.name);
      }
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
export function createAgent<TCtx extends BaseContext>(steps: FxStep<TCtx>[]): Agent<TCtx> {
  const agent = new NavigatorAgent<TCtx>();
  agent.steps = steps;
  return agent;
}

/**
 * Compose steps into a navigator agent using functional composition
 * Alternative API for direct step composition
 */
export function composeAgent<TCtx extends BaseContext>(...steps: FxStep<TCtx>[]): Agent<TCtx> {
  return createAgent(steps);
}


/**
 * Create a guard function
 */
export function when<TCtx>(pred: (ctx: TCtx) => boolean): Guard<TCtx> {
  return pred;
}

/**
 * Create a step - fundamental morphism in the navigator category
 * Uses core's functional composition patterns
 */
export function step<TCtx extends BaseContext>(
  name: string,
  guard: Guard<TCtx>,
  run: Step<TCtx>,
  opts?: {
    idempotentKey?: (ctx: TCtx) => string;
    projection?: (ctx: TCtx) => unknown;
  }
): FxStep<TCtx> {
  return {
    name,
    guard,
    run,
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

// ---------- Durable Execution Helpers ----------

/**
 * Create a durable navigator agent using core's durable execution
 */
export function createDurableAgent<TCtx extends BaseContext>(
  steps: FxStep<TCtx>[],
  config: DurableExecutionConfig<TCtx>
): {
  agent: Agent<TCtx>;
  executeDurable: (ctx: TCtx, opts?: RunOpts<TCtx>) => Promise<DurableExecutionResult<TCtx>>;
  pause: (ctx: TCtx, reason?: string) => Promise<TCtx>;
  resume: (checkpointId: string, extras?: Partial<TCtx>) => Promise<TCtx>;
} {
  const agent = createAgent(steps);
  
  return {
    agent,
    
    executeDurable: async (ctx: TCtx, opts?: RunOpts<TCtx>) => {
      // Create execution step using core's sequence
      const executionStep = sequence([
        log('navigator_execution_start'),
        ...steps.map(s => s.run),
        log('navigator_execution_complete')
      ]);
      
      return await executeDurable(executionStep, ctx, config);
    },
    
    pause: async (ctx: TCtx, reason?: string) => {
      if (!config.persistence) {
        throw new Error('Persistence not configured');
      }
      const pauseStep = pause(config.persistence, reason);
      return await pauseStep(ctx);
    },
    
    resume: async (checkpointId: string, extras?: Partial<TCtx>) => {
      if (!config.persistence) {
        throw new Error('Persistence not configured');
      }
      const resumeStep = resumeFromCheckpoint(config.persistence, checkpointId, extras);
      return await resumeStep({} as TCtx);
    }
  };
}

/**
 * Create a pausable navigator agent using core's durable execution
 */
export function createPausableAgent<TCtx extends BaseContext>(
  steps: FxStep<TCtx>[],
  persistence: PersistenceIO<TCtx>,
  pauseCondition?: (ctx: TCtx) => boolean
): {
  agent: Agent<TCtx>;
  createPausableStep: (step: Step<TCtx>) => Step<TCtx>;
} {
  const agent = createAgent(steps);
  
  return {
    agent,
    
    createPausableStep: (step: Step<TCtx>) => {
      return createPausableStep(step, persistence, pauseCondition);
    }
  };
}

/**
 * Create a resumable navigator agent using core's durable execution
 */
export function createResumableAgent<TCtx extends BaseContext>(
  steps: FxStep<TCtx>[],
  persistence: PersistenceIO<TCtx>,
  checkpointId: string,
  extras?: Partial<TCtx>
): {
  agent: Agent<TCtx>;
  createResumableStep: (step: Step<TCtx>) => Step<TCtx>;
} {
  const agent = createAgent(steps);
  
  return {
    agent,
    
    createResumableStep: (step: Step<TCtx>) => {
      return createResumableStep(step, persistence, checkpointId, extras);
    }
  };
}
