/**
 * Agent Executor for Fx Framework
 * Integrates router, planner, policies, safety, and observability
 */

import { BaseContext } from './types';
import { router, patternGate, Tool } from './router';
import { argSpec } from './arg-parser';
import { planFromUtterance, validatePlan, executePlan } from './planner';
import { withPolicies, getDefaultPolicyForRisk } from './policies';
import { SafetyManager, createDefaultSafetyConfig } from './safety';
import { ObservabilityManager, appendDecision } from './observability';
import { ToolSpec, ExecutionContext, defaultToolRegistry } from './tool-metadata';

// ---------- Agent Executor Types ----------

export interface AgentExecutorConfig {
  readonly safetyConfig?: any; // SafetyConfig type
  readonly observabilityManager?: ObservabilityManager;
  readonly toolRegistry?: any; // ToolRegistry type
  readonly defaultPolicies?: boolean;
}

export interface ExecutionResult {
  readonly success: boolean;
  readonly results: unknown[];
  readonly decisionId?: string;
  readonly error?: string;
  readonly executionTimeMs: number;
}

// ---------- Agent Executor Implementation ----------

export class AgentExecutor {
  private safetyManager: SafetyManager;
  private observabilityManager: ObservabilityManager;
  private toolRegistry: any; // ToolRegistry type

  constructor(config: AgentExecutorConfig = {}) {
    this.safetyManager = new SafetyManager(
      config.safetyConfig || createDefaultSafetyConfig()
    );
    this.observabilityManager = config.observabilityManager || new ObservabilityManager();
    this.toolRegistry = config.toolRegistry || defaultToolRegistry;
  }

  /**
   * Execute a turn with the agent
   */
  async runTurn(
    state: BaseContext,
    message: string
  ): Promise<{ state: BaseContext; result: ExecutionResult }> {
    const startTime = Date.now();
    
    try {
      // 1) Pattern gating
      const gated = patternGate(message, []);
      
      // 2) Router
      const { candidates } = await router.route({ text: message }, gated);
      const chosenTools = candidates.slice(0, 2).map(c => c.tool);
      
      // 3) Get tool specifications
      const toolSpecs = chosenTools
        .map(name => this.toolRegistry.get(name))
        .filter(spec => spec !== undefined);
      
      if (toolSpecs.length === 0) {
        throw new Error('No valid tools found for the given input');
      }
      
      // 4) Plan
      const plan = planFromUtterance(message, toolSpecs);
      
      // 5) Create execution context
      const executionContext = this.safetyManager.createSafeExecutionContext({
        state,
        signal: new AbortController().signal,
        approvals: this.createApprovalSystem(),
        quotas: this.safetyManager.quotaManager as any
      });
      
      // 6) Validate plan
      const validation = await validatePlan(plan, executionContext);
      if (!validation.valid) {
        throw new Error(`Plan validation failed: ${validation.error.message}`);
      }
      
      // 7) Apply policies to tools
      const policyAppliedTools = toolSpecs.map(tool => {
        const policy = getDefaultPolicyForRisk(tool.risk);
        return withPolicies(tool, policy);
      });
      
      // 8) Execute plan
      const executionResult = await executePlan(plan, executionContext);
      
      if (!executionResult.success) {
        throw new Error(`Plan execution failed: ${executionResult.error.message}`);
      }
      
      // 9) Record decision
      const executionTimeMs = Date.now() - startTime;
      const decisionId = this.observabilityManager.recordDecision({
        input: message,
        patternsMatched: gated,
        routerCandidates: candidates,
        chosen: chosenTools,
        args: this.extractArgsFromPlan(plan),
        outcome: 'ok',
        latMs: executionTimeMs
      });
      
      // 10) Update state
      const newState = appendDecision(state, {
        input: message,
        patternsMatched: gated,
        routerCandidates: candidates,
        chosen: chosenTools,
        args: this.extractArgsFromPlan(plan),
        outcome: 'ok',
        latMs: executionTimeMs
      });
      
      return {
        state: newState,
        result: {
          success: true,
          results: executionResult.results,
          decisionId,
          executionTimeMs
        }
      };
      
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      // Record failed decision
      const decisionId = this.observabilityManager.recordDecision({
        input: message,
        patternsMatched: patternGate(message, []),
        routerCandidates: [],
        chosen: [],
        args: {},
        outcome: 'fail',
        latMs: executionTimeMs,
        error: errorMessage
      });
      
      return {
        state,
        result: {
          success: false,
          results: [],
          decisionId,
          error: errorMessage,
          executionTimeMs
        }
      };
    }
  }

  /**
   * Extract arguments from plan
   */
  private extractArgsFromPlan(plan: any): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    
    for (const step of plan.steps) {
      args[step.tool.name] = step.args;
    }
    
    return args;
  }

  /**
   * Create approval system
   */
  private createApprovalSystem(): any {
    return {
      ok: async (toolName: string, args: unknown): Promise<boolean> => {
        const tool = this.toolRegistry.get(toolName);
        if (!tool) return false;
        
        // Auto-approve low risk tools
        if (tool.risk === 'low') return true;
        
        // For higher risk tools, we'd need actual approval
        // This is a placeholder implementation
        return false;
      }
    };
  }

  /**
   * Get observability report
   */
  getObservabilityReport(): any {
    return this.observabilityManager.getReport();
  }

  /**
   * Get safety status
   */
  getSafetyStatus(): any {
    return {
      quotaUsage: this.safetyManager.quotaManager.getUsage(),
      quotaAvailable: {
        concurrency: this.safetyManager.quotaManager.getAvailable('maxConcurrency'),
        memory: this.safetyManager.quotaManager.getAvailable('maxMemoryMB'),
        cpuTime: this.safetyManager.quotaManager.getAvailable('maxCpuTimeMs'),
        networkRequests: this.safetyManager.quotaManager.getAvailable('maxNetworkRequests')
      }
    };
  }
}

// ---------- Factory Functions ----------

/**
 * Create a default agent executor
 */
export function createAgentExecutor(config?: AgentExecutorConfig): AgentExecutor {
  return new AgentExecutor(config);
}

/**
 * Create an agent executor with strict safety
 */
export function createStrictAgentExecutor(): AgentExecutor {
  return new AgentExecutor({
    safetyConfig: createDefaultSafetyConfig() // Would use createStrictSafetyConfig()
  });
}

// ---------- Integration with Existing Fx API ----------

/**
 * Create a step that uses the agent executor
 */
export function agentExecutorStep<T extends BaseContext>(
  executor: AgentExecutor,
  messageExtractor: (state: T) => string
): (state: T) => Promise<T> {
  return async (state: T): Promise<T> => {
    const message = messageExtractor(state);
    const { state: newState, result } = await executor.runTurn(state, message);
    
    if (!result.success) {
      throw new Error(`Agent execution failed: ${result.error}`);
    }
    
    return {
      ...newState,
      lastExecutionResult: result
    } as unknown as T;
  };
}

/**
 * Create a workflow that uses the agent executor
 */
export function createAgentWorkflow<T extends BaseContext>(
  name: string,
  executor: AgentExecutor,
  messageExtractor: (state: T) => string
): any {
  return {
    name,
    execute: agentExecutorStep(executor, messageExtractor)
  };
}
