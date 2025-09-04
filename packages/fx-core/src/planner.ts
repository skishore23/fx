/**
 * Deterministic Planner for Fx Framework
 * Handles multi-step prompts with ordering and dependency resolution
 * Built using functional composition and category theory principles
 */

import { BaseContext, Step } from './types';
import { ToolSpec, ExecutionContext } from './tool-metadata';
import { argSpec } from './arg-parser';
import { splitMultiToolSentence } from './arg-parser';
import { sequence, parallel, when, fromFunction, loopWhile } from './composition';

// ---------- Planning Types ----------

export interface PlanStep {
  readonly tool: ToolSpec<unknown, unknown>;
  readonly args: unknown;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly order: number;
}

export interface Plan {
  readonly steps: readonly PlanStep[];
  readonly totalTimeBudgetMs: number;
  readonly totalMemoryBudgetMB: number;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface PlanningError {
  readonly type: 'missing_args' | 'unsatisfied_precondition' | 'circular_dependency' | 'resource_exceeded';
  readonly message: string;
  readonly step?: PlanStep;
}

// ---------- Planning Pure Functions (Morphisms) ----------

/**
 * Pure function to infer steps from utterance
 * Category theory: This is a morphism (string, ToolSpec[]) -> PlanStep[]
 */
export const inferSteps = (utterance: string, tools: ToolSpec<unknown, unknown>[]): PlanStep[] => {
  const sentences = splitMultiToolSentence(utterance);
  const steps: PlanStep[] = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (!sentence) continue;
    
    // Find matching tool for this sentence
    const matchingTool = tools.find(tool => {
      const argParser = argSpec[tool.name as keyof typeof argSpec];
      return argParser && argParser(sentence) !== null;
    });
    
    if (matchingTool) {
      const argParser = argSpec[matchingTool.name as keyof typeof argSpec];
      const args = argParser ? argParser(sentence) : {};
      
      steps.push({
        tool: matchingTool,
        args,
        provides: [`step_${i}_output`],
        consumes: i > 0 ? [`step_${i-1}_output`] : [],
        order: i
      });
    }
  }
  
  return steps;
};

/**
 * Pure function to calculate resource budgets
 * Category theory: This is a morphism PlanStep[] -> { time: number; memory: number }
 */
export const calculateBudgets = (steps: PlanStep[]): { time: number; memory: number } => {
  const totalTime = steps.reduce((sum, step) => sum + (step.tool.timeBudgetMs || 5000), 0);
  const totalMemory = steps.reduce((sum, step) => sum + (step.tool.memoryBudgetMB || 10), 0);
  
  return { time: totalTime, memory: totalMemory };
};

/**
 * Pure function to determine risk level
 * Category theory: This is a morphism PlanStep[] -> 'low' | 'medium' | 'high' | 'critical'
 */
export const determineRiskLevel = (steps: PlanStep[]): 'low' | 'medium' | 'high' | 'critical' => {
  const highRiskTools = steps.filter(step => step.tool.risk === 'high').length;
  const criticalRiskTools = steps.filter(step => step.tool.risk === 'critical').length;
  
  if (criticalRiskTools > 0) return 'critical';
  if (highRiskTools > 1) return 'high';
  if (highRiskTools > 0) return 'medium';
  return 'low';
};

// ---------- Planning Steps (Composed from Pure Functions) ----------

/**
 * Step to infer plan steps
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const inferStepsStep = <T extends BaseContext>(utterance: string, tools: ToolSpec<unknown, unknown>[]): Step<T> => {
  return fromFunction('inferSteps', async (state: T) => {
    const steps = inferSteps(utterance, tools);
    return {
      ...state,
      planSteps: steps
    } as T;
  });
};

/**
 * Step to resolve dependencies
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const resolveDependenciesStep = <T extends BaseContext>(): Step<T> => {
  return fromFunction('resolveDependencies', async (state: T) => {
    const steps = state.planSteps as PlanStep[] || [];
    const resolvedSteps = resolveDependencies(steps);
    return {
      ...state,
      resolvedPlanSteps: resolvedSteps
    } as T;
  });
};

/**
 * Step to calculate budgets
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const calculateBudgetsStep = <T extends BaseContext>(): Step<T> => {
  return fromFunction('calculateBudgets', async (state: T) => {
    const steps = state.resolvedPlanSteps as PlanStep[] || [];
    const budgets = calculateBudgets(steps);
    return {
      ...state,
      planBudgets: budgets
    } as T;
  });
};

/**
 * Step to determine risk level
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const determineRiskLevelStep = <T extends BaseContext>(): Step<T> => {
  return fromFunction('determineRiskLevel', async (state: T) => {
    const steps = state.resolvedPlanSteps as PlanStep[] || [];
    const riskLevel = determineRiskLevel(steps);
    return {
      ...state,
      planRiskLevel: riskLevel
    } as T;
  });
};

/**
 * Composed planning step using existing composition operators
 * Category theory: This composes multiple planning steps using sequence
 */
export const planStep = <T extends BaseContext>(utterance: string, tools: ToolSpec<unknown, unknown>[]): Step<T> => {
  return sequence([
    inferStepsStep(utterance, tools),
    resolveDependenciesStep(),
    parallel([
      calculateBudgetsStep(),
      determineRiskLevelStep()
    ], (results, originalState) => {
      return {
        ...originalState,
        planBudgets: results[0]?.planBudgets,
        planRiskLevel: results[1]?.planRiskLevel
      } as T;
    })
  ]);
};

// ---------- Dependency Resolution ----------

/**
 * Resolve dependencies between plan steps
 */
function resolveDependencies(steps: PlanStep[]): PlanStep[] {
  const resolved: PlanStep[] = [];
  const remaining = [...steps];
  const provided = new Set<string>();

  while (remaining.length > 0) {
    let progress = false;

    for (let i = remaining.length - 1; i >= 0; i--) {
      const step = remaining[i];
      if (!step) continue;
      
      // Check if all dependencies are satisfied
      const dependenciesSatisfied = step.consumes.every(dep => provided.has(dep));
      
      if (dependenciesSatisfied) {
        resolved.push(step);
        step.provides.forEach(prov => provided.add(prov));
        remaining.splice(i, 1);
        progress = true;
      }
    }

    if (!progress) {
      throw new Error('Circular dependency detected in plan steps');
    }
  }

  return resolved;
}


/**
 * Determine overall risk level
 */
function calculateRiskLevel(steps: PlanStep[]): 'low' | 'medium' | 'high' | 'critical' {
  const riskLevels = steps.map(step => step.tool.risk);
  
  if (riskLevels.includes('critical')) return 'critical';
  if (riskLevels.includes('high')) return 'high';
  if (riskLevels.includes('medium')) return 'medium';
  return 'low';
}

// ---------- Step Inference ----------

/**
 * Infer what a step provides based on tool type
 */
function inferProvides(tool: ToolSpec<unknown, unknown>, args: unknown): string[] {
  const provides: string[] = [];
  
  switch (tool.name) {
    case 'read_file':
      provides.push('file_content');
      break;
    case 'write_file':
      provides.push('file_written');
      break;
    case 'http_request':
      provides.push('http_response');
      break;
    case 'execute_command':
      provides.push('command_output');
      break;
    case 'search':
      provides.push('search_results');
      break;
    default:
      provides.push(`${tool.name}_result`);
  }
  
  return provides;
}

/**
 * Infer what a step consumes based on tool type and args
 */
function inferConsumes(tool: ToolSpec<unknown, unknown>, args: unknown): string[] {
  const consumes: string[] = [];
  
  // Check if args reference previous outputs
  const argsStr = JSON.stringify(args);
  
  if (argsStr.includes('file_content')) consumes.push('file_content');
  if (argsStr.includes('http_response')) consumes.push('http_response');
  if (argsStr.includes('command_output')) consumes.push('command_output');
  if (argsStr.includes('search_results')) consumes.push('search_results');
  
  return consumes;
}

/**
 * Infer a plan step from an operation string
 */
function inferStep(
  operation: string, 
  availableTools: ToolSpec<unknown, unknown>[]
): PlanStep | null {
  // Try to match operation to available tools
  for (const tool of availableTools) {
    const parser = argSpec[tool.name as keyof typeof argSpec];
    if (!parser) continue;
    
    const args = parser(operation);
    if (args) {
      const provides = inferProvides(tool, args);
      const consumes = inferConsumes(tool, args);
      
      return {
        tool,
        args,
        provides,
        consumes,
        order: 0 // Will be set during dependency resolution
      };
    }
  }
  
  return null;
}

// ---------- Main Planning Function ----------

/**
 * Create a plan from a user message and available tools
 */
export function createPlanFromMessage(
  msg: string, 
  availableTools: ToolSpec<unknown, unknown>[]
): Plan {
  // Split multi-tool sentences
  const operations = splitMultiToolSentence(msg);
  
  // Infer steps from operations
  const steps: PlanStep[] = [];
  
  for (const operation of operations) {
    const step = inferStep(operation, availableTools);
    if (step) {
      steps.push(step);
    }
  }
  
  if (steps.length === 0) {
    throw new Error('No valid operations found in utterance');
  }
  
  // Resolve dependencies
  const resolvedSteps = resolveDependencies(steps);
  
  // Set order
  const orderedSteps = resolvedSteps.map((step, index) => ({
    ...step,
    order: index
  }));
  
  // Calculate budgets and risk
  const { time, memory } = calculateBudgets(orderedSteps);
  const riskLevel = calculateRiskLevel(orderedSteps);
  
  return {
    steps: orderedSteps,
    totalTimeBudgetMs: time,
    totalMemoryBudgetMB: memory,
    riskLevel
  };
}

// ---------- Plan Validation ----------

/**
 * Validate a plan before execution
 */
export async function validatePlan(
  plan: Plan, 
  context: ExecutionContext
): Promise<{ valid: true } | { valid: false; error: PlanningError }> {
  // Check resource quotas
  if (plan.totalTimeBudgetMs > context.quotas.maxCpuTimeMs) {
    return {
      valid: false,
      error: {
        type: 'resource_exceeded',
        message: `Plan time budget ${plan.totalTimeBudgetMs}ms exceeds quota ${context.quotas.maxCpuTimeMs}ms`
      }
    };
  }
  
  if (plan.totalMemoryBudgetMB > context.quotas.maxMemoryMB) {
    return {
      valid: false,
      error: {
        type: 'resource_exceeded',
        message: `Plan memory budget ${plan.totalMemoryBudgetMB}MB exceeds quota ${context.quotas.maxMemoryMB}MB`
      }
    };
  }
  
  // Check preconditions for each step
  for (const step of plan.steps) {
    for (const precondition of step.tool.pre) {
      const satisfied = await precondition.check(context.state, step.args);
      if (!satisfied) {
        return {
          valid: false,
          error: {
            type: 'unsatisfied_precondition',
            message: `Precondition '${precondition.name}' not satisfied: ${precondition.message}`,
            step
          }
        };
      }
    }
  }
  
  return { valid: true };
}

// ---------- Plan Execution ----------

/**
 * Execute a plan step by step
 */
export async function executePlan(
  plan: Plan,
  context: ExecutionContext
): Promise<{ success: true; results: unknown[] } | { success: false; error: PlanningError; results: unknown[] }> {
  const results: unknown[] = [];
  let currentState = context.state;
  
  for (const step of plan.steps) {
    try {
      // Check if step should be skipped due to idempotency
      if (step.tool.idempotencyKey) {
        const key = step.tool.idempotencyKey(step.args);
        const existingResult = currentState[`idempotent_${key}`];
        if (existingResult) {
          results.push(existingResult);
          continue;
        }
      }
      
      // Execute the step
      const result = await step.tool.exec(step.args, {
        ...context,
        state: currentState
      });
      
      // Check postconditions
      for (const postcondition of step.tool.post) {
        if (!postcondition.check(currentState, result)) {
          throw new Error(`Postcondition '${postcondition.name}' failed: ${postcondition.message}`);
        }
      }
      
      // Store result for idempotency
      if (step.tool.idempotencyKey) {
        const key = step.tool.idempotencyKey(step.args);
        currentState = { ...currentState, [`idempotent_${key}`]: result };
      }
      
      // Update state with step results
      step.provides.forEach(prov => {
        currentState = { ...currentState, [prov]: result };
      });
      
      results.push(result);
      
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'unsatisfied_precondition',
          message: `Step execution failed: ${(error as Error).message}`,
          step
        },
        results
      };
    }
  }
  
  return { success: true, results };
}

// ---------- Plan Utilities ----------

/**
 * Get plan summary
 */
export function getPlanSummary(plan: Plan): string {
  const stepNames = plan.steps.map(step => step.tool.name).join(' → ');
  return `Plan: ${stepNames} (${plan.steps.length} steps, ${plan.totalTimeBudgetMs}ms, ${plan.riskLevel} risk)`;
}

/**
 * Check if plan requires approval
 */
export function planRequiresApproval(plan: Plan): boolean {
  return plan.riskLevel === 'high' || plan.riskLevel === 'critical';
}

/**
 * Get estimated execution time
 */
export function getEstimatedExecutionTime(plan: Plan): number {
  return plan.totalTimeBudgetMs;
}

/**
 * Get plan dependencies as a graph
 */
export function getPlanDependencyGraph(plan: Plan): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  
  for (const step of plan.steps) {
    const stepId = `${step.tool.name}_${step.order}`;
    graph.set(stepId, [...step.consumes]);
  }
  
  return graph;
}
