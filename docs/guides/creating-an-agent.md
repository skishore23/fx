# Creating an Agent with Fx Framework

This guide walks you through creating a complete agent using the Fx Framework, including both the core framework and the Navigator framework for topological execution.

## Table of Contents

1. [60-Second Quickstart](#60-second-quickstart)
2. [Pick Your Runtime](#pick-your-runtime)
3. [Step 1: Define Your Agent State](#step-1-define-your-agent-state)
4. [Step 2: Build Workflow](#step-2-build-workflow)
5. [Step 3: Create Agent](#step-3-create-agent)
6. [Hello World Examples](#hello-world-examples)
7. [Advanced Patterns](#advanced-patterns)
8. [Best Practices](#best-practices)

## 60-Second Quickstart

Get up and running in under a minute! Choose your runtime:

### Core Framework Quickstart

```typescript
// quickstart-core.ts
import { step, sequence, updateState, createPlan, createAgent } from '@fx/core';

type Msg = { role: 'user'|'assistant'; content: string };
interface Ctx {
  conversation: Msg[];
  goal: string;
  response?: string;
}

const readGoal = step<Ctx>('readGoal', (s) =>
  updateState({ goal: s.conversation.at(-1)?.content ?? '' })(s)
);

const reply = step<Ctx>('reply', (s) => {
  const response = `I understand: ${s.goal}`;
  return updateState({ 
    response, 
    conversation: [...s.conversation, { role: 'assistant', content: response }]
  })(s);
});

const plan = createPlan('hello-core', [sequence([readGoal, reply])]);
const agent = createAgent<Ctx>('hello-core', plan);

agent.start({ conversation: [{ role: 'user', content: 'Hello!' }], goal: '' })
  .then(final => console.log('✅ Done:', final))
  .catch(err => console.error('❌', err));
```

**Run:** `tsx quickstart-core.ts` (or `node --loader tsx quickstart-core.ts`)

**Expected output:**
```
✅ Done: {
  conversation: [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'I understand: Hello!' }
  ],
  goal: 'Hello!',
  response: 'I understand: Hello!'
}
```

### Navigator Framework Quickstart

```typescript
// quickstart-navigator.ts
import { createAgent, when, step, updateState } from '@fx/navigator';

interface NCtx { 
  conversation: {role:string;content:string}[]; 
  goal?: string; 
  done?: boolean; 
}

const read = step<NCtx>('read',
  when(c => !c.goal && c.conversation.length > 0),
  s => updateState({ goal: s.conversation.at(-1)?.content })(s)
);

const finish = step<NCtx>('finish',
  when(c => !!c.goal && !c.done),
  s => updateState({ done: true })(s)
);

const nav = createAgent<NCtx>([read, finish]);

nav.run({ conversation: [{ role:'user', content:'Plan my day' }] })
  .then(r => console.log('▶ plan:', r.plan, '\n✅ ctx:', r.ctx));
```

**Run:** `tsx quickstart-navigator.ts`

**Expected output:**
```
▶ plan: { layers: [['read'], ['finish']], blocked: {} }
✅ ctx: { conversation: [...], goal: 'Plan my day', done: true }
```

## Pick Your Runtime

### Core Framework (@fx/core)
- **Core = predictable sequences.** Linear workflow with step-by-step processing
- **Pattern Matching**: Advanced pattern matching for conditional logic
- **Chain of Thought**: Built-in reasoning patterns
- **ReAct Pattern**: Iterative problem-solving approach
- **Tool Registry**: Comprehensive tool system with validation

### Navigator Framework (@fx/navigator)
- **Navigator = state-driven & parallel.** Guard-driven steps that run based on state conditions
- **Conditional Logic**: Steps execute when specific conditions are met
- **Parallel Processing**: Multiple steps can run simultaneously when conditions allow
- **State-Driven**: Execution flow determined by current state rather than predefined sequence

### Package Exports

| Package         | Exports (non-exhaustive)                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@fx/core`      | `step`, `sequence`, `parallel`, `updateState`, `addState`, `createPlan`, `createAgent`, `Either`, `safe`, `safeAsync` |
| `@fx/navigator` | `createAgent`, `step`, `when`, `updateState`, `addState`                                                              |

**Requirements:** Node ≥ 18, TypeScript ≥ 5.0. Works with both ESM and CommonJS.

## Step 1: Define Your Agent State

Start by defining your agent's state interface, extending `BaseContext`:

```typescript
import { BaseContext } from '@fx/core';

interface MyAgentState extends BaseContext {
  // Core conversation
  conversation: Array<{ role: string; content: string }>;
  
  // Agent-specific state
  currentGoal: string;
  response?: string;
  
  // Memory
  memory: Array<{
    type: 'action' | 'observation' | 'error';
    content: string;
    timestamp: string;
  }>;
}
```

### State Management Principles

- **Immutable**: State is never mutated directly
- **Lens-based**: Use `updateState`, `addState` for transformations (they're curried and compose)
- **Composable**: State changes are pure functions that can be composed

### Deep State Updates

For nested state updates, use the lens pattern:

```typescript
// Update nested conversation
const addMessage = step('addMessage', (state) => 
  updateState({
    conversation: [...state.conversation, { role: 'assistant', content: 'New message' }]
  })(state)
);

// Or use the lens pattern for deep updates
const updateNested = step('updateNested', (state) => 
  updateState({
    'user.profile.lastActive': Date.now(),
    'user.preferences.theme': 'dark'
  })(state)
);
```

## Step 2: Build Workflow

Create your agent's workflow using functional composition:

```typescript
import { step, sequence, updateState, addState } from '@fx/core';

// Process user input
const processUserInput = step('processUserInput', (state: MyAgentState) => {
  const lastMessage = state.conversation?.[state.conversation.length - 1];
  if (!lastMessage) return state;

  console.log(`👤 User: ${lastMessage.content}`);
  
  return updateState({
    currentGoal: lastMessage.content
  })(state);
});

// Generate response
const generateResponse = step('generateResponse', (state: MyAgentState) => {
  const response = `I understand you want: ${state.currentGoal}`;
  console.log(`🤖 Assistant: ${response}`);
  
  return updateState({
    response,
    conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
  })(state);
});

// Log action
const logAction = step('logAction', (state: MyAgentState) => {
  return addState('action', `Processed: ${state.currentGoal}`)(state);
});

// Main workflow
const agentWorkflow = sequence([
  processUserInput,
  generateResponse,
  logAction
]);
```

## Step 3: Create Agent

### Core Framework Agent

Create your agent using the workflow:

```typescript
import { createPlan, createAgent } from '@fx/core';

// Create the agent plan
const plan = createPlan('my-agent', [
  step('initialize', (state: MyAgentState) => {
    console.log('🚀 My Agent started!');
    return state;
  }),
  
  agentWorkflow,
  
  step('goodbye', (state: MyAgentState) => {
    console.log('👋 Goodbye!');
    return state;
  })
]);

// Create the agent
const myAgent = createAgent('my-agent', plan);

// Run the agent
export const runMyAgent = async () => {
  const initialState: MyAgentState = {
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: []
  };
  
  try {
    const result = await myAgent.start(initialState);
    console.log('Final result:', result);
  } catch (error) {
    console.error('Agent failed:', error);
  }
};

// What does myAgent.start return?
// Returns: Promise<MyAgentState> - the final state after all steps complete
```

### Navigator Framework Agent

For topological execution with guard-driven steps:

```typescript
import { createAgent, when, step, updateState } from '@fx/navigator';

// Define steps with guards
const analyzeInput = step('analyzeInput', 
  when(ctx => !!ctx.conversation?.length && !ctx.analyzed),
  async (state: MyAgentState) => {
    console.log('🔍 Analyzing input...');
    return updateState({ 
      analyzed: true,
      currentGoal: state.conversation[state.conversation.length - 1]?.content || ''
    })(state);
  }
);

const processRequest = step('processRequest',
  when(ctx => !!ctx.analyzed && !ctx.processed),
  async (state: MyAgentState) => {
    console.log('⚙️ Processing request...');
    return updateState({ 
      processed: true,
      response: `Processed: ${state.currentGoal}`
    })(state);
  }
);

const generateResponse = step('generateResponse',
  when(ctx => !!ctx.processed && !ctx.responseGenerated),
  async (state: MyAgentState) => {
    console.log('📝 Generating response...');
    return updateState({ 
      responseGenerated: true,
      conversation: [...(state.conversation || []), { role: 'assistant', content: state.response || '' }]
    })(state);
  }
);

// Create navigator agent
const navigatorAgent = createAgent<MyAgentState>([analyzeInput, processRequest, generateResponse]);

// Run the agent
export const runNavigatorAgent = async () => {
  const initialState: MyAgentState = {
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: [],
    analyzed: false,
    processed: false,
    responseGenerated: false
  };
  
  try {
    const result = await navigatorAgent.run(initialState);
    console.log('Final result:', result.ctx);
    console.log('Execution plan:', result.plan);
  } catch (error) {
    console.error('Agent failed:', error);
  }
};

// Navigator scheduler semantics:
// - Guards re-evaluate every tick until no more steps can run
// - Steps run in parallel when guards allow (maxParallel configurable)
// - Run terminates when no guards are true or maxIterations reached
```

## Hello World Examples

### Core Framework Hello World

```typescript
import { step, sequence, updateState, createPlan, createAgent } from '@fx/core';

interface HelloState {
  message: string;
  response?: string;
}

const processMessage = step<HelloState>('processMessage', (state) => 
  updateState({ response: `Echo: ${state.message}` })(state)
);

const plan = createPlan('hello-world', [processMessage]);
const agent = createAgent<HelloState>('hello-world', plan);

// Run it
agent.start({ message: 'Hello Fx!' })
  .then(result => console.log(result.response)); // "Echo: Hello Fx!"
```

### Navigator Framework Hello World

```typescript
import { createAgent, when, step, updateState } from '@fx/navigator';

interface HelloNavState {
  message: string;
  processed?: boolean;
  response?: string;
}

const process = step<HelloNavState>('process',
  when(ctx => !ctx.processed),
  state => updateState({ 
    processed: true, 
    response: `Echo: ${state.message}` 
  })(state)
);

const agent = createAgent<HelloNavState>([process]);

agent.run({ message: 'Hello Navigator!' })
  .then(result => console.log(result.ctx.response)); // "Echo: Hello Navigator!"
```

## Advanced Patterns

### Core Framework Patterns

#### Using Chain of Thought

For complex reasoning tasks, use the Chain of Thought pattern:

```typescript
import { createChainOfThoughtPattern } from '@fx/core';

// Extend your state to include Chain of Thought properties
interface MyAgentState extends BaseContext {
  // ... existing properties
  
  // Chain of Thought properties
  problem: string;
  thoughts: Array<{
    step: number;
    thought: string;
    reasoning: string;
  }>;
  conclusion?: string;
}

// Create Chain of Thought workflow
const createReasoningWorkflow = () => {
  const chainOfThoughtPattern = createChainOfThoughtPattern('reasoning-agent');
  
  return sequence([
    step('initializeChainOfThought', (state: MyAgentState) => {
      return updateState({
        problem: state.currentGoal || 'Solve the user\'s request',
        thoughts: [],
        conclusion: undefined
      })(state);
    }),
    
    step('executeChainOfThought', async (state: MyAgentState) => {
      return chainOfThoughtPattern(state);
    })
  ]);
};
```

#### Using ReAct Pattern

For iterative problem solving:

```typescript
import { createReActPattern } from '@fx/core';

// Create ReAct workflow
const createReActWorkflow = () => {
  const reactPattern = createReActPattern('reasoning-agent');
  
  return sequence([
    step('executeReAct', async (state: MyAgentState) => {
      return reactPattern(state);
    })
  ]);
};
```

#### Using Custom Patterns

```typescript
import { createPattern } from '@fx/core';

// Create a custom pattern
const customPattern = createPattern(
  (state) => state.currentGoal.includes('urgent'),
  (state) => updateState({ priority: 'high' })(state)
);

const customWorkflow = sequence([
  processUserInput,
  customPattern,
  generateResponse
]);
```

#### Parallel Execution (Core)

Core's `parallel` is fork-join - returns when all steps complete:

```typescript
import { parallel, timeout } from '@fx/core';

const parallelWork = parallel([
  step('fetchUser', fetchUserData),
  step('fetchProducts', fetchProductData),
  step('fetchOrders', fetchOrderData)
]);

// With timeout
const parallelWithTimeout = parallel([
  timeout(step('slowOp', slowOperation), 5000),
  step('fastOp', fastOperation)
]);
```

### Navigator Framework Patterns

#### Guard-Driven Execution

Steps execute based on state conditions:

```typescript
import { step, when, updateState } from '@fx/navigator';

const dataProcessingStep = step('dataProcessing',
  when(ctx => ctx.hasData && !ctx.processed),
  async (state: MyAgentState) => {
    // Only runs when hasData is true and processed is false
    return updateState({ processed: true })(state);
  }
);

const validationStep = step('validation',
  when(ctx => ctx.processed && !ctx.validated),
  async (state: MyAgentState) => {
    // Only runs after data is processed
    return updateState({ validated: true })(state);
  }
);
```

#### Parallel Execution

Multiple steps can run simultaneously:

```typescript
const parallelAnalysis = step('parallelAnalysis',
  when(ctx => ctx.readyForAnalysis),
  async (state: MyAgentState) => {
    // This step can run in parallel with others when conditions are met
    return updateState({ analysisComplete: true })(state);
  }
);

const parallelValidation = step('parallelValidation',
  when(ctx => ctx.readyForAnalysis),
  async (state: MyAgentState) => {
    // This can run at the same time as parallelAnalysis
    return updateState({ validationComplete: true })(state);
  }
);
```

#### State-Driven Workflows

Execution flow determined by current state:

```typescript
const conditionalStep = step('conditionalStep',
  when(ctx => {
    // Complex guard conditions
    return ctx.userAuthenticated && 
           ctx.hasPermission && 
           !ctx.alreadyProcessed;
  }),
  async (state: MyAgentState) => {
    // Only runs when all conditions are met
    return updateState({ alreadyProcessed: true })(state);
  }
);
```

## Best Practices

### 1. State Management
- Keep state immutable
- Use lenses for state transformations
- Avoid direct mutations
- Use TypeScript interfaces for type safety

### 2. Error Handling
- Use `Either` monad for functional error handling (recommended)
- Use `safe` and `safeAsync` for wrapping operations
- Provide meaningful error messages
- Handle errors gracefully

```typescript
import { Either, safe, safeAsync } from '@fx/core';

// Either-first approach
const safeOperation = step('safeOperation', async (state) => {
  const result = await safeAsync(async () => {
    return await riskyApiCall(state.data);
  });
  
  return Either.fold(
    result,
    (error) => updateState({ error: error.message })(state),
    (value) => updateState({ result: value })(state)
  );
});
```

### 3. Composition
- Build workflows from small, composable steps
- Use `sequence` for linear workflows (Core Framework)
- Use `parallel` for concurrent operations (Core Framework)
- Use `when` for conditional logic (Navigator Framework)
- Design steps to be independent and testable

### 4. Framework Selection
- **Use Core Framework** for:
  - Sequential workflows with clear step order
  - Complex pattern matching requirements
  - Chain of Thought reasoning
  - ReAct pattern implementations
  
- **Use Navigator Framework** for:
  - State-driven execution flows
  - Parallel processing requirements
  - Complex conditional logic
  - Dynamic workflow adaptation

### 5. Observability

Replace `console.log` with proper logging:

```typescript
import { enableLogging, logEvent } from '@fx/core';

// Enable logging
enableLogging();

// Log custom events
const logStep = step('logStep', (state) => {
  logEvent('user_action', { userId: state.userId });
  return state;
});

// Get execution timeline
const events = getEvents();
console.log('Execution timeline:', events);
```

### 6. Durable Execution

Pause, resume, and checkpoint your agents:

```typescript
import { createDurableAgent, createMemoryPersistence } from '@fx/core';

const persistence = createMemoryPersistence();
const config = {
  persistence,
  checkpointInterval: 1000
};

const { agent, executeDurable, pause, resume } = createDurableAgent(steps, config);

// Execute with automatic checkpointing
const result = await executeDurable(initialState);

// Pause execution
await pause(initialState, 'user requested pause');

// Resume from checkpoint
const resumed = await resume('checkpoint-123');
```

### 7. Guard Design (Navigator Framework)
- Make guards specific and clear
- Avoid complex guard conditions
- Use state flags to track progress
- Design guards to be mutually exclusive when needed

### 8. Testing

Test individual steps and complete workflows:

```typescript
import { describe, it, expect } from 'vitest';
import { step, updateState } from '@fx/core';

// Test individual step
describe('processMessage step', () => {
  it('should update response correctly', () => {
    const processMessage = step('processMessage', (state) => 
      updateState({ response: `Echo: ${state.message}` })(state)
    );
    
    const result = processMessage({ message: 'Hello' });
    expect(result.response).toBe('Echo: Hello');
  });
});

// Test complete plan
describe('hello-world plan', () => {
  it('should process message end-to-end', async () => {
    const result = await agent.start({ message: 'Hello Fx!' });
    expect(result.response).toBe('Echo: Hello Fx!');
  });
});
```

## Complete Examples

### Core Framework Example

Here's a complete example using the Core Framework:

```typescript
import { 
  step, sequence, createPlan, createAgent,
  updateState, addState
} from '@fx/core';

// State
interface SimpleAgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  response?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

// Workflow
const simpleAgentWorkflow = sequence([
  step('processInput', (state: SimpleAgentState) => {
    const lastMessage = state.conversation?.[state.conversation.length - 1];
    return updateState({
      currentGoal: lastMessage?.content || ''
    })(state);
  }),
  
  step('generateResponse', (state: SimpleAgentState) => {
    const response = `I understand: ${state.currentGoal}`;
    return updateState({
      response,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    })(state);
  }),
  
  step('logAction', (state: SimpleAgentState) => {
    return addState('action', `Processed: ${state.currentGoal}`)(state);
  })
]);

// Agent
const plan = createPlan('simple-agent', [
  step('init', (state) => {
    console.log('🚀 Simple Agent started!');
    return state;
  }),
  simpleAgentWorkflow
]);

export const simpleAgent = createAgent('simple-agent', plan);

// Usage
export const runSimpleAgent = async () => {
  const result = await simpleAgent.start({
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: []
  });
  
  console.log('Result:', result);
};
```

### Navigator Framework Example

Here's a complete example using the Navigator Framework:

```typescript
import { 
  createAgent, when, step, updateState, addState
} from '@fx/navigator';

// State
interface NavigatorAgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  response?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
  
  // Navigator state flags
  inputProcessed?: boolean;
  responseGenerated?: boolean;
  actionLogged?: boolean;
}

// Steps with guards
const processInput = step('processInput',
  when(ctx => !!ctx.conversation?.length && !ctx.inputProcessed),
  async (state: NavigatorAgentState) => {
    const lastMessage = state.conversation[state.conversation.length - 1];
    console.log('🔍 Processing input...');
    
    return updateState({
      currentGoal: lastMessage?.content || '',
      inputProcessed: true
    })(state);
  }
);

const generateResponse = step('generateResponse',
  when(ctx => !!ctx.inputProcessed && !ctx.responseGenerated),
  async (state: NavigatorAgentState) => {
    const response = `I understand: ${state.currentGoal}`;
    console.log('📝 Generating response...');
    
    return updateState({
      response,
      responseGenerated: true,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    })(state);
  }
);

const logAction = step('logAction',
  when(ctx => !!ctx.responseGenerated && !ctx.actionLogged),
  async (state: NavigatorAgentState) => {
    console.log('📊 Logging action...');
    
    return updateState({ actionLogged: true })(
      addState('action', `Processed: ${state.currentGoal}`)(state)
    );
  }
);

// Create navigator agent
const navigatorAgent = createAgent<NavigatorAgentState>([processInput, generateResponse, logAction]);

// Usage
export const runNavigatorAgent = async () => {
  const result = await navigatorAgent.run({
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: [],
    inputProcessed: false,
    responseGenerated: false,
    actionLogged: false
  });
  
  console.log('Final state:', result.ctx);
  console.log('Execution plan:', result.plan);
  console.log('Success:', result.success);
  console.log('Duration:', result.duration + 'ms');
};
```

## Quick Reference

### Essential Imports

#### Core Framework
```typescript
import { 
  // Core composition
  step, sequence, parallel,
  
  // State operations
  updateState, addState,
  
  // Patterns
  createReActPattern, createChainOfThoughtPattern, createPattern,
  
  // Agent creation
  createPlan, createAgent,
  
  // Error handling
  Either, safe, safeAsync
} from '@fx/core';
```

#### Navigator Framework
```typescript
import { 
  // Core composition
  createAgent, when, step,
  
  // State operations
  updateState, addState,
  
  // Tool system
  createToolRegistry, createValidatedTool,
  
  // LLM integration
  createOpenAIProvider, llmTemplateStep, promptTemplate
} from '@fx/navigator';

import { Either, safe, safeAsync } from '@fx/core';
```

### Common Patterns

#### Core Framework Agent Structure
```typescript
interface MyAgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

const plan = createPlan('my-agent', [
  step('init', (state) => { /* initialize */ return state; }),
  workflow,
  step('cleanup', (state) => { /* cleanup */ return state; })
]);

const agent = createAgent('my-agent', plan);
```

#### Navigator Framework Agent Structure
```typescript
interface MyNavigatorState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
  
  // State flags for guards
  step1Complete?: boolean;
  step2Complete?: boolean;
}

const step1 = step('step1',
  when(ctx => !ctx.step1Complete),
  async (state) => { /* step logic */ return updateState({ step1Complete: true })(state); }
);

const agent = createAgent<MyNavigatorState>([step1, step2, step3]);
```

#### State Updates
```typescript
// Multiple field update
const newState = updateState({
  field1: value1,
  field2: value2
})(state);

// Add to memory
const newState = addState('action', 'Something happened')(state);

// Navigator state flag updates
const newState = updateState({
  stepComplete: true,
  result: 'Success'
})(state);
```

### Common Gotchas

#### Core Framework Specific
1. **Don't mutate state directly** - use lenses
2. **Order matters in sequences** - steps execute in the order they're defined
3. **Use `parallel` for concurrent operations** - don't try to run async operations in sequence
4. **Pattern matching is powerful** - use it for complex conditional logic
5. **Use `Either` for error handling** - avoid try/catch in steps

#### Navigator Framework Specific
6. **Guard conditions should be specific** - avoid overly complex guard logic
7. **State flags are crucial** - use them to track step completion
8. **Steps can run in parallel** - design them to be independent
9. **Guard evaluation happens on every tick** - keep guards efficient
10. **Use `when` for all conditional logic** - don't use if/else inside steps

#### General
11. **Keep steps focused** and single-purpose
12. **Test with meaningful data**
13. **Use patterns for common behaviors**

### Framework Decision Guide

**Choose Core Framework when:**
- You need predictable, sequential execution
- Complex pattern matching is required
- You're building reasoning agents with Chain of Thought
- You need ReAct pattern capabilities

**Choose Navigator Framework when:**
- You need state-driven execution
- Steps can run in parallel
- Complex conditional logic is required
- You want dynamic workflow adaptation
- You're building research or analysis agents

This guide provides everything you need to create agents using the Fx Framework. Start simple and gradually add complexity as you become more familiar with the patterns and composition techniques.