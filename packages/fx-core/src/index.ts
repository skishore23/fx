/**
 * Fx - Functional Agent Framework
 * Clean, unified API without legacy code or backward compatibility
 */

// ---------- Core Types ----------
export type {
  BaseContext,
  State,
  Step,
  Plan,
  FxError,
  Event,
  FxConfig,
  Id,
  Path,
  Workflow,
  Functor,
  Monad,
  Kleisli,
  NaturalTransformation,
  Applicative,
  Profunctor,
  ExtendContext,
  TaskContext,
  KleisliWorkflow
} from './types';

// ---------- Category Theory Implementations ----------
export { Maybe, Either, Identity } from './types';

// ---------- Composition Operators ----------
export {
  identity,
  sequence,
  parallel,
  when,
  tryInOrder,
  noop,
  fail,
  log,
  validate,
  tap,
  delay,
  repeat,
  loopWhile,
  retry,
  timeout,

  fromFunction as step,
  setValue,
  getValue,
  updateValue,
  mergeStrategies
} from './composition';

// ---------- State Operations ----------
export { set, get, update, push, remove, updateState, addState } from './lenses';

// ---------- Memory System ----------
export {
  getMemory,
  clearMemory,
  searchMemory,
  getMemoryCount,
  memoryLens,
  filteredMemoryLens,



} from './memory';

export type { MemoryEntry, MemoryFilter } from './memory';

// ---------- Tool System ----------
export {
  tool,
  pipeline,
  retryConfig,
  retryTool,
  executePipeline,
  createReadFileTool,
  createWriteFileTool,
  createCommandTool,
  validateToolParams,
  sanitizeToolParams
} from './tools';

export type { ToolBuilder, ToolPipeline, RetryConfig, ToolResult } from './tools';

// ---------- Tool Registry System ----------
export {
  createToolRegistry,
  createTool,
  createValidatedTool
} from './tool-registry';

export type { ToolDefinition } from './tool-registry';

// ---------- Safe Functions ----------
export {
  safe,
  safeAsync,
  safeWithValidation,
  safeWithErrorHandling
} from './safe-functions';

// ---------- Pattern Matching ----------
export {
  PatternMatcher,
  createPatternMatcher,
  createPattern,
  patterns
} from './pattern-matching';

export type { Pattern } from './pattern-matching';

// ---------- LLM Provider System ----------
export {
  createOpenAIProvider,
  promptTemplate,
  responseParser,
  llmStep,
  llmTemplateStep,
  llmParseStep,
  llmTemplateParseStep,
  createReasoningTemplate,
  createObservationTemplate,
  createReActActionParser
} from './llm';

export type { 
  LLMProvider, 
  ChatMessage, 
  LLMOptions, 
  LLMResponse, 
  PromptTemplate, 
  ResponseParser 
} from './llm';

// ---------- Agent Patterns ----------
export {
  createReActPattern,
  createChainOfThoughtPattern,
  agentPattern,
  executePattern,
  loopPattern,
  validatePatternState,
  sanitizePatternState
} from './patterns';

export type { 
  AgentPattern, 
  ReActState, 
  ChainOfThoughtState 
} from './patterns';

// ---------- Utilities ----------
export {
  newId,
  sleep,
  isPromise,
  clone,
  getValueAtPath,
  setValueAtPath,
  arrayMap,
  maybeMap,
  eitherMap,
  maybeChain,
  eitherChain,
  constant,
  flip,
  curry,
  uncurry
} from './utils';

// ---------- Configuration ----------
export { configure, getConfig } from './config';

// ---------- Logging ----------
export { enableLogging, disableLogging, logEvent, getEvents } from './ledger';

// ---------- Tool Registry ----------
export { registerTool, callTool } from './registry';

// ---------- Router System ----------
export {
  router,
  patternGate,
  createRouter,
  validateRouterOut,
  getTopCandidate
} from './router';

export type { Tool, RouterSignal, RouterCandidate, RouterOut, ToolRouter } from './router';

// ---------- Argument Parser ----------
export {
  token,
  quoted,
  filePath,
  number,
  boolean,
  word,
  firstOf,
  optional,
  many,
  separatedBy,
  readFileArgs,
  writeFileArgs,
  searchArgs,
  apiCallArgs,
  commandArgs,
  argSpec,
  validateArgs,
  splitMultiToolSentence
} from './arg-parser';

export type { Parser, ParseResult, ParserWithRemaining } from './arg-parser';

// ---------- Tool Metadata ----------
export {
  createToolSpec,
  createReadFileSpec,
  createWriteFileSpec,
  createHttpRequestSpec,
  createCommandSpec,
  ToolRegistry,
  defaultToolRegistry
} from './tool-metadata';

export type { 
  Capability, 
  Risk, 
  ExecutionContext, 
  ApprovalSystem, 
  ResourceQuotas,
  ToolSpec, 
  PreCondition, 
  PostCondition
} from './tool-metadata';

// ---------- Planner ----------
export {
  planFromUtterance,
  validatePlan,
  executePlan,
  getPlanSummary,
  planRequiresApproval,
  getEstimatedExecutionTime,
  getPlanDependencyGraph
} from './planner';

export type { PlanStep, PlanningError } from './planner';

// ---------- Policies ----------
export {
  withPolicies,
  timeoutPolicy,
  retryPolicy,
  approvalPolicy,
  circuitBreakerPolicy,
  sandboxPolicy,
  comprehensivePolicy,
  getDefaultPolicyForRisk,
  mergePolicies
} from './policies';

export type { Policy, CircuitBreakerConfig, PolicyContext } from './policies';

// ---------- Safety ----------
export {
  AllowlistChecker,
  IdempotencyManager,
  ResourceQuotaManager,
  SandboxManager,
  SafetyManager,
  createDefaultSafetyConfig,
  createStrictSafetyConfig
} from './safety';

export type { 
  AllowlistConfig, 
  IdempotencyConfig, 
  SafetyConfig, 
  SafetyViolation,
  SandboxContext
} from './safety';

// ---------- Observability ----------
export {
  DecisionRecorder,
  ConfusionTracker,
  ReplaySystem,
  ObservabilityManager,
  appendDecision,
  getDecisionHistory,
  defaultObservabilityManager
} from './observability';

export type { 
  DecisionRecord, 
  ConfusionMatrix, 
  PerformanceMetrics, 
  ReplayContext 
} from './observability';

// ---------- Agent Executor ----------
export {
  AgentExecutor,
  createAgentExecutor,
  createStrictAgentExecutor,
  agentExecutorStep,
  createAgentWorkflow
} from './agent-executor';

export type { AgentExecutorConfig, ExecutionResult } from './agent-executor';

// ---------- High-Level API ----------

// Import required functions and types
import { sequence, when, retry, timeout, parallel, loopWhile, setValue, updateValue, fromFunction } from './composition';
import { logEvent } from './ledger';
import { BaseContext, Plan, Step } from './types';

/**
 * Agent Status
 */
export type AgentStatus = 'stopped' | 'running' | 'paused' | 'error' | 'completed';

/**
 * Agent Configuration
 */
export interface AgentConfig {
  name: string;
  autoRestart?: boolean;
  maxRetries?: number;
  persistence?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Create a plan from steps - simple sequential execution
 */
export function createPlan<T extends BaseContext>(
  name: string,
  steps: Step<T>[]
): Plan<T> {
  return {
    name,
    execute: sequence(steps)
  };
}

/**
 * Durable Agent that executes plans
 */
export class Agent<T extends BaseContext> {
  private plan: Plan<T>;
  private config: AgentConfig;
  private status: AgentStatus = 'stopped';
  private currentContext?: T;
  private executionPromise?: Promise<T>;

  constructor(name: string, plan: Plan<T>, config?: Partial<AgentConfig>) {
    this.config = { 
      name, 
      autoRestart: true, 
      maxRetries: 3, 
      persistence: true, 
      logLevel: 'info',
      ...config 
    };
    this.plan = plan;
  }

  /**
   * Start the agent with initial context
   */
  async start(initialContext: T): Promise<T> {
    if (this.status === 'running') {
      throw new Error('Agent is already running');
    }

    this.status = 'running';
    this.currentContext = { ...initialContext };

    logEvent('agent:start', { name: this.config.name, initialContext });

    this.executionPromise = this.executePlan(this.currentContext!);
    return this.executionPromise;
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    this.status = 'stopped';
    logEvent('agent:stop', { name: this.config.name });
  }

  /**
   * Pause the agent
   */
  async pause(): Promise<void> {
    this.status = 'paused';
    logEvent('agent:pause', { name: this.config.name });
  }

  /**
   * Resume the agent
   */
  async resume(): Promise<T> {
    if (this.status !== 'paused' || !this.currentContext) {
      throw new Error('Agent is not paused');
    }

    this.status = 'running';
    logEvent('agent:resume', { name: this.config.name });

    this.executionPromise = this.executePlan(this.currentContext);
    return this.executionPromise;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get current context
   */
  getContext(): T | undefined {
    return this.currentContext;
  }

  /**
   * Execute the plan
   */
  private async executePlan(ctx: T): Promise<T> {
    try {
      logEvent('plan:start', { agent: this.config.name, plan: this.plan.name });

      const result = await this.plan.execute(ctx);
      this.currentContext = result;

      this.status = 'completed';
      logEvent('plan:complete', { agent: this.config.name, result });

      return result;

    } catch (error) {
      this.status = 'error';
      logEvent('plan:error', {
        agent: this.config.name,
        plan: this.plan.name,
        error: (error as Error).message
      });
      throw error;
    }
  }
}

/**
 * Create an agent that executes a plan
 */
export function createAgent<T extends BaseContext>(
  name: string,
  plan: Plan<T>,
  config?: Partial<AgentConfig>
): Agent<T> {
  return new Agent<T>(name, plan, config);
}

/**
 * Create a simple workflow from functions
 */
export function createWorkflow<T extends BaseContext>(
  name: string,
  ...steps: Array<(state: T) => T | Promise<T>>
): Plan<T> {
  const stepFunctions = steps.map(step => fromFunction(`${name}-step`, step));
  return createPlan(name, stepFunctions);
}

/**
 * Create a conditional workflow
 */
export function createConditionalWorkflow<T extends BaseContext>(
  name: string,
  condition: (state: T) => boolean,
  truePlan: Plan<T>,
  falsePlan?: Plan<T>
): Plan<T> {
  return {
    name,
    execute: when(condition, truePlan.execute, falsePlan?.execute)
  };
}

/**
 * Create a retry workflow
 */
export function createRetryWorkflow<T extends BaseContext>(
  name: string,
  plan: Plan<T>,
  maxAttempts: number = 3,
  baseDelay: number = 100
): Plan<T> {
  return {
    name,
    execute: retry(plan.execute, maxAttempts, baseDelay)
  };
}

/**
 * Create a timeout workflow
 */
export function createTimeoutWorkflow<T extends BaseContext>(
  name: string,
  plan: Plan<T>,
  timeoutMs: number
): Plan<T> {
  return {
    name,
    execute: timeout(plan.execute, timeoutMs)
  };
}

/**
 * Create a parallel workflow
 */
export function createParallelWorkflow<T extends BaseContext>(
  name: string,
  plans: Plan<T>[]
): Plan<T> {
  return {
    name,
    execute: parallel(plans.map(plan => plan.execute))
  };
}

/**
 * Create a loop workflow
 */
export function createLoopWorkflow<T extends BaseContext>(
  name: string,
  plan: Plan<T>,
  condition: (state: T) => boolean,
  maxIterations: number = 10
): Plan<T> {
  return {
    name,
    execute: loopWhile(
      (state: T) => {
        const iterationCount = (state.iterationCount as number) || 0;
        return condition(state) && iterationCount < maxIterations;
      },
      sequence([
        updateValue('iterationCount', (count: unknown) => ((count as number) || 0) + 1),
        plan.execute
      ])
    )
  };
}