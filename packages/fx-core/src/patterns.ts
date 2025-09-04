/**
 * Built-in Agent Patterns for Fx Framework
 * Simplified implementation with clean types
 */

import { Step, BaseContext } from './types';
import { sequence, loopWhile, setValue } from './composition';
import { addMemory, getMemory } from './memory';
import { llmTemplateStep, llmParseStep, llmTemplateParseStep, promptTemplate } from './llm';
import { LLMProvider, PromptTemplate, ResponseParser } from './llm';
import { createReasoningTemplate, createObservationTemplate, createReActActionParser } from './llm';

// ---------- Agent Pattern Types ----------

export interface AgentPattern<T extends BaseContext> {
  readonly name: string;
  readonly workflow: Step<T>;
  readonly condition?: (state: T) => boolean;
  readonly maxIterations?: number;
  readonly description?: string;
}

export interface ReActState extends BaseContext {
  readonly currentGoal: string;
  readonly plan: Array<{
    readonly step: number;
    readonly action: string;
    readonly reasoning: string;
    readonly status: 'pending' | 'in_progress' | 'completed' | 'failed';
  }>;
  readonly currentStep: number;
  readonly maxIterations: number;
  readonly iterationCount: number;
  readonly lastToolResult?: unknown;
  readonly lastError?: string;
}

export interface ChainOfThoughtState extends BaseContext {
  readonly problem: string;
  readonly thoughts: Array<{
    readonly step: number;
    readonly thought: string;
    readonly reasoning: string;
  }>;
  readonly currentStep: number;
  readonly conclusion?: string;
}

// ---------- ReAct Pattern Implementation ----------

/**
 * Create ReAct pattern
 */
export function createReActPattern<T extends ReActState>(
  provider: LLMProvider,
  tools: string[] = []
): AgentPattern<T> {
  const reasoningTemplate = createReasoningTemplate();
  const observationTemplate = createObservationTemplate();
  const actionParser = createReActActionParser();

  return {
    name: 'react',
    description: 'ReAct (Reasoning and Acting) pattern for iterative problem solving',
    maxIterations: 10,
    condition: (state: T) => {
      const hasReachedMaxIterations = state.iterationCount >= state.maxIterations;
      const isGoalAchieved = state.plan.length > 0 && state.plan.every(step => step.status === 'completed');
      return !hasReachedMaxIterations && !isGoalAchieved;
    },
    workflow: sequence([
      incrementIteration,
      reactReasonStep(provider, reasoningTemplate, actionParser),
      actStep,
      observeStep(provider, observationTemplate)
    ])
  };
}

/**
 * Increment iteration counter
 */
const incrementIteration = <T extends ReActState>(state: T): Promise<T> => {
  const newIterationCount = state.iterationCount + 1;
  console.log(`\n🔄 ReAct Iteration ${newIterationCount}/${state.maxIterations}`);
  
  return Promise.resolve({
    ...state,
    iterationCount: newIterationCount
  } as T);
};

/**
 * Reasoning step
 */
function reactReasonStep<T extends ReActState>(
  provider: LLMProvider,
  template: PromptTemplate,
  parser: ResponseParser<{ reasoning: string; action: string; nextStep: string }>
): Step<T> {
  return async (state: T) => {
    // Prepare context for template
    const context = {
      ...state,
      recentMemory: (state.memory as unknown[])?.slice(-5) || [],
      lastToolResult: state.lastToolResult || 'None'
    };

    // Call LLM with template and parse response
    const result = await llmTemplateParseStep(provider, template, parser)(context);
    
    const parsed = (result as T).reasoningResponseParsed as { reasoning: string; action: string; nextStep: string };
    if (parsed) {
      console.log(`🧠 REASONING: ${parsed.reasoning}`);
      console.log(`🎯 ACTION: ${parsed.action}`);
      console.log(`📋 NEXT_STEP: ${parsed.nextStep}`);
      
      // Update plan
      const newStep = {
        step: state.currentStep + 1,
        action: parsed.action,
        reasoning: parsed.reasoning,
        status: 'pending' as const
      };
      
      return {
        ...result,
        plan: [...state.plan, newStep],
        currentStep: state.currentStep + 1
      } as unknown as T;
    }
    
    return result as unknown as T;
  };
}

/**
 * Action step
 */
const actStep = <T extends ReActState>(state: T): Promise<T> => {
  const currentStep = state.plan[state.plan.length - 1];
  if (!currentStep || currentStep.status !== 'pending') {
    return Promise.resolve(state);
  }
  
  console.log(`⚡ ACTING: ${currentStep.action}`);
  
  // This would parse the action and execute the appropriate tool
  // For now, just mark as completed
  const updatedPlan = state.plan.map(step => 
    step.step === currentStep.step 
      ? { ...step, status: 'completed' as const }
      : step
  );
  
  return Promise.resolve({
    ...state,
    plan: updatedPlan,
    lastToolResult: { type: 'mock', result: 'Action executed' }
  } as T);
};

/**
 * Observation step
 */
function observeStep<T extends ReActState>(
  provider: LLMProvider,
  template: PromptTemplate
): Step<T> {
  return async (state: T) => {
    // Prepare context for template
    const context = {
      ...state,
      lastToolResult: state.lastToolResult || 'None',
      lastError: state.lastError || 'None'
    };

    // Call LLM with template
    const result = await llmTemplateStep(provider, template)(context);
    
    const observation = (result as T).observationResponse as string;
    if (observation) {
      console.log(`👁️ OBSERVATION: ${observation}`);
    }
    
    return result as unknown as T;
  };
}

// ---------- Chain of Thought Pattern Implementation ----------

/**
 * Create Chain of Thought pattern
 */
export function createChainOfThoughtPattern<T extends ChainOfThoughtState>(
  provider: LLMProvider
): AgentPattern<T> {
  return {
    name: 'chain-of-thought',
    description: 'Chain of Thought pattern for step-by-step reasoning',
    maxIterations: 5,
    condition: (state: T) => {
      return !state.conclusion && state.currentStep < 5;
    },
    workflow: sequence([
      thinkStep(provider),
      chainReasonStep(provider),
      concludeStep(provider)
    ])
  };
}

/**
 * Think step
 */
function thinkStep<T extends ChainOfThoughtState>(provider: LLMProvider): Step<T> {
  return async (state: T) => {
    const thinkTemplate = promptTemplate(
      'think',
      `THINKING PHASE:

Problem: {{problem}}

Current Thoughts:
{{#each thoughts}}
  {{step}}. {{thought}}
{{/each}}

What is the next logical step in solving this problem?`,
      ['problem', 'thoughts']
    );

    const result = await llmTemplateStep(provider, thinkTemplate)(state);
    
    const thought = (result as T).thinkResponse as string;
    if (thought) {
      const newThought = {
        step: state.currentStep + 1,
        thought: thought,
        reasoning: 'Generated by thinking step'
      };
      
      return {
        ...result,
        thoughts: [...state.thoughts, newThought],
        currentStep: state.currentStep + 1
      } as unknown as T;
    }
    
    return result as unknown as T;
  };
}

/**
 * Reason step
 */
function chainReasonStep<T extends ChainOfThoughtState>(provider: LLMProvider): Step<T> {
  return async (state: T) => {
    const reasonTemplate = promptTemplate(
      'reason',
      `REASONING PHASE:

Problem: {{problem}}

Current Thoughts:
{{#each thoughts}}
  {{step}}. {{thought}}
{{/each}}

Analyze the current thoughts and provide reasoning for the next step.`,
      ['problem', 'thoughts']
    );

    const result = await llmTemplateStep(provider, reasonTemplate)(state);
    
    const reasoning = (result as T).reasonResponse as string;
    if (reasoning && state.thoughts.length > 0) {
      const lastThought = state.thoughts[state.thoughts.length - 1];
      const updatedThought = { ...lastThought, reasoning };
      
      return {
        ...result,
        thoughts: [...state.thoughts.slice(0, -1), updatedThought]
      } as unknown as T;
    }
    
    return result as unknown as T;
  };
}

/**
 * Conclude step
 */
function concludeStep<T extends ChainOfThoughtState>(provider: LLMProvider): Step<T> {
  return async (state: T) => {
    const concludeTemplate = promptTemplate(
      'conclude',
      `CONCLUSION PHASE:

Problem: {{problem}}

All Thoughts:
{{#each thoughts}}
  {{step}}. {{thought}}
  Reasoning: {{reasoning}}
{{/each}}

Based on all the thoughts and reasoning, what is the final conclusion?`,
      ['problem', 'thoughts']
    );

    const result = await llmTemplateStep(provider, concludeTemplate)(state);
    
    const conclusion = (result as T).concludeResponse as string;
    if (conclusion) {
      return {
        ...result,
        conclusion
      } as unknown as T;
    }
    
    return result as unknown as T;
  };
}

// ---------- Pattern Factory Functions ----------

/**
 * Create an agent pattern
 */
export function agentPattern<T extends BaseContext>(
  name: string,
  workflow: Step<T>,
  options?: {
    condition?: (state: T) => boolean;
    maxIterations?: number;
    description?: string;
  }
): AgentPattern<T> {
  return {
    name,
    workflow,
    condition: options?.condition,
    maxIterations: options?.maxIterations,
    description: options?.description
  };
}

// Factory functions removed - use createReActPattern and createChainOfThoughtPattern directly

// ---------- Pattern Composition ----------

/**
 * Create a step that executes an agent pattern
 */
export function executePattern<T extends BaseContext>(
  pattern: AgentPattern<T>
): Step<T> {
  return async (state: T) => {
    if (pattern.condition && !pattern.condition(state)) {
      return state;
    }

    // Execute the pattern workflow
    return pattern.workflow(state);
  };
}

/**
 * Create a step that loops an agent pattern
 */
export function loopPattern<T extends BaseContext>(
  pattern: AgentPattern<T>
): Step<T> {
  const condition = pattern.condition || (() => true);
  const maxIterations = pattern.maxIterations || 10;
  
  return loopWhile(
    (state: T) => {
      const iterationCount = (state.iterationCount as number) || 0;
      return condition(state) && iterationCount < maxIterations;
    },
    executePattern(pattern)
  );
}

// ---------- Pattern Validation ----------

/**
 * Validate agent pattern state
 */
export const validatePatternState = <T extends BaseContext>(pattern: AgentPattern<T>) => {
  return (state: T): boolean => {
    if (pattern.condition) {
      return pattern.condition(state);
    }
    return true;
  };
};

/**
 * Sanitize agent pattern state
 */
export const sanitizePatternState = <T extends BaseContext>(pattern: AgentPattern<T>) => {
  return (state: T): T => {
    // Add default values if missing
    const sanitized = { ...state };
    
    if (pattern.maxIterations && !sanitized.iterationCount) {
      (sanitized as any).iterationCount = 0;
    }
    
    return sanitized;
  };
};

// ---------- Generic Pattern Templates ----------

// Core patterns are focused on generic reasoning patterns that can be used across different domains:
// 
// ✅ Implemented:
// - ReAct (Reasoning and Acting) - Iterative problem solving with reasoning and action
// - Chain of Thought - Step-by-step reasoning for complex problems
//
// 🔮 Future patterns (generic enough for core):
// - Reflection - Self-evaluation and improvement
// - Planning - Hierarchical task decomposition
// - Memory - Long-term memory and retrieval
// - Meta-reasoning - Reasoning about reasoning
// - Multi-agent - Coordination between multiple reasoning entities
//
// ❌ Domain-specific patterns (belong in examples/applications):
// - Coding agents, research agents, etc.