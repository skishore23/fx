# Building Effective Agents with the f(x) Functional Framework

This guide provides a step-by-step approach to building, testing, and debugging LLM-powered agents using the [f(x)](./src/index.ts) functional library. It draws on best practices from [Anthropic's research on building effective agents](https://www.anthropic.com/research/building-effective-agents) and demonstrates how to implement composable, transparent, and maintainable agentic systems.

---

## Table of Contents
- [Introduction](#introduction)
- [Core Principles](#core-principles)
- [Step 1: Define Your Domain State](#step-1-define-your-domain-state)
- [Step 2: Register Tools](#step-2-register-tools)
- [Step 3: Implement Agent Steps](#step-3-implement-agent-steps)
- [Step 4: Compose the Agent Workflow](#step-4-compose-the-agent-workflow)
- [Step 5: Testing and Debugging](#step-5-testing-and-debugging)
- [Durable Execution and Agent Lifecycle](#durable-execution-and-agent-lifecycle)
  - [Agent Lifecycle Management](#agent-lifecycle-management)
  - [Durable Execution](#durable-execution)
  - [Advanced Debugging](#advanced-debugging)
  - [Best Practices for Production](#best-practices-for-production)
- [Agentic Patterns](#agentic-patterns)
  - [Prompt Chaining](#prompt-chaining)
  - [Routing](#routing)
  - [Parallelization](#parallelization)
  - [Orchestrator-Workers](#orchestrator-workers)
  - [Evaluator-Optimizer](#evaluator-optimizer)
- [Best Practices](#best-practices)
- [References](#references)

---

## Introduction

The f(x) library enables you to build robust, auditable, and highly composable LLM agents using functional programming principles. Agents are defined as pure functions that transform immutable state, with all side effects and tool calls managed through explicit, composable steps.

## Core Principles
- **Immutability**: State is never mutated in place.
- **Pure Functions**: Each step is a pure function from state to state.
- **Composition**: Complex workflows are built from simple, composable steps.
- **Explicit Error Handling**: All errors are handled explicitly, never silently.
- **Transparency**: All state transitions and tool calls are logged for debugging and reproducibility.

## Step 1: Define Your Domain State

Define the types that represent your agent's state and data. For example:

```ts
interface ResearchState {
  userQuery: string;
  breadthParameter: number;
  depthParameter: number;
  iterations: ResearchIteration[];
  currentDepth: number;
  currentBreadth: number;
  isComplete: boolean;
  visitedUrls: string[];
  finalReport?: string;
}
```

## Step 2: Register Tools

Register external tools (APIs, search, etc.) using `Fx.registerTool`. Tools are pure functions that take state and return new state.

```ts
Fx.registerTool<ResearchState, z.ZodTuple<[z.ZodString]>>(
  "web_search",
  z.tuple([z.string()]),
  (query: string) => async (state) => {
    // ... implementation ...
    return { ...state, ...updatedFields };
  }
);
```

## Step 3: Implement Agent Steps

Each step is a pure function (or async function) that transforms state. Use `Fx.wrap` to add logging, caching, and error handling.

```ts
const extractLearnings: Step<ResearchState> = Fx.wrap("extractLearnings", async (state, log) => {
  // ... implementation ...
  return updatedState;
});
```

Use `Fx.focus` to operate on a specific part of the state (lens pattern):

```ts
const updateIteration = Fx.focus(['iterations', index], updateStep);
```

## Step 4: Compose the Agent Workflow

Compose your steps using `Fx.sequence`, `Fx.parallel`, and `Fx.loopWhile`:

```ts
const researchWorkflow = Fx.sequence(
  performWebSearch,
  extractLearnings,
  generateNextDirections,
  selectNextQueries
);

const agent = Fx.agent<ResearchState>("MyAgent", researchWorkflow);
```

Run the agent:

```ts
Fx.spawn(agent, initialState).then(finalState => {
  // ...
});
```

## Step 5: Testing and Debugging

- **Testing**: Each step is a pure function and can be unit tested in isolation.
- **Debugging**: Use `Fx.debug` to attach a debug hook and inspect all state transitions and tool calls.

```ts
Fx.debug((event, state) => {
  console.log(`[${event.ts}] ${event.name}:`, event.args);
});
```

- **Ledger**: All state transitions are recorded in a ledger for full reproducibility.

## Durable Execution and Agent Lifecycle

The f(x) framework provides robust mechanisms for managing agent lifecycle and ensuring durable execution:

### Agent Lifecycle Management

```ts
// Create an agent with start/stop events
const myAgent = Fx.agent<MyState>("AgentName", workflow);

// Spawn an agent instance
const finalState = await Fx.spawn(myAgent, initialState);
```

The `Fx.agent` wrapper adds:
- Start/Stop events for lifecycle tracking
- Automatic state preservation
- Error boundary protection

### Durable Execution

The framework supports durable execution through:

1. **Event Ledger**: All state transitions are recorded
```ts
// Events are automatically recorded to ledger
const log: _Core.Ledger<S> = [];
const result = await wf(seed, log);
```

2. **State Snapshots**: Critical state is preserved at checkpoints
```ts
// State hashes are recorded for each transition
await _Core.record(l, {
  id: crypto.randomUUID(),
  name: `start:${name}`,
  beforeHash: _Core.hash(s),
  afterHash: _Core.hash(s)
}, s);
```

3. **Recovery Mechanisms**: Failed operations can be retried
```ts
// Wrap steps with retry logic
const resilientStep = Fx.retry(myStep, {
  maxAttempts: 3,
  backoff: 'exponential'
});
```

### Advanced Debugging

The framework provides rich debugging capabilities:

1. **Debug Hook**: Attach a debug handler for real-time monitoring
```ts
// Comprehensive debug logging
Fx.debug((ev, state) => {
  const timestamp = new Date(ev.ts).toLocaleTimeString();
  
  switch (true) {
    case ev.name.startsWith('start:'):
      console.log(`[${timestamp}] 🚀 START: ${ev.name.substring(6)}`);
      break;
    case ev.name.startsWith('stop:'):
      console.log(`[${timestamp}] 🏁 FINISH: ${ev.name.substring(5)}`);
      break;
    case ev.name.includes('error'):
      console.error(`[${timestamp}] ❌ ERROR:`, ev.meta?.error);
      break;
  }
});
```

2. **State Inspection**: Monitor state changes at any point
```ts
// Log state transitions
Fx.debug((ev, state) => {
  console.log(`State transition: ${ev.beforeHash} -> ${ev.afterHash}`);
  console.log('Current state:', state);
});
```

3. **Tool Monitoring**: Track tool usage and performance
```ts
Fx.debug((ev, state) => {
  if (ev.name.includes('tool:')) {
    console.log(`Tool called: ${ev.name}`);
    console.log(`Args:`, ev.args);
    console.log(`Result:`, ev.meta?.result);
  }
});
```

4. **Performance Profiling**: Measure step execution times
```ts
Fx.debug((ev, _) => {
  if (ev.meta?.duration) {
    console.log(`Step ${ev.name} took ${ev.meta.duration}ms`);
  }
});
```

### Best Practices for Production

1. **Implement proper error boundaries**
```ts
try {
  const result = await Fx.spawn(agent, initialState);
} catch (error) {
  console.error("Agent execution failed:", error);
  // Implement recovery logic
}
```

2. **Use appropriate logging levels**
```ts
Fx.debug((ev, _) => {
  if (process.env.NODE_ENV === 'production') {
    // Log only critical events
    if (ev.name.startsWith('error:') || ev.name.startsWith('fail:')) {
      console.error(ev);
    }
  } else {
    // Log everything in development
    console.log(ev);
  }
});
```

3. **Monitor agent health**
```ts
let lastHeartbeat = Date.now();
Fx.debug((ev, _) => {
  if (ev.name === 'heartbeat') {
    lastHeartbeat = Date.now();
  }
});

// Health check
setInterval(() => {
  const silence = Date.now() - lastHeartbeat;
  if (silence > 5000) {
    console.warn("Agent potentially stalled");
  }
}, 1000);
```

## Agentic Patterns

### Prompt Chaining
Decompose a task into sequential LLM/tool calls, each building on the previous output.

```ts
const chain = Fx.sequence(step1, step2, step3);
```

### Routing
Classify input and route to specialized steps.

```ts
const router = Fx.wrap("router", async (state, log) => {
  if (isTypeA(state)) return await typeAStep(state, log);
  else return await typeBStep(state, log);
});
```

### Parallelization
Run independent steps in parallel and aggregate results.

```ts
const parallelStep = Fx.parallel(stepA, stepB, stepC);
```

### Orchestrator-Workers
A central step dynamically creates and delegates subtasks to worker steps, then aggregates results.

```ts
const orchestrator = Fx.wrap("orchestrator", async (state, log) => {
  // Generate subtasks
  // Call Fx.sequence or Fx.parallel on workers
  // Aggregate results
  return newState;
});
```

### Evaluator-Optimizer
Iteratively refine outputs by looping between a generator and an evaluator.

```ts
const loop = Fx.loopWhile(
  state => !state.isOptimized,
  Fx.sequence(generatorStep, evaluatorStep)
);
```

## Best Practices
- **Start simple**: Use direct LLM calls and basic composition before adding complexity.
- **Prefer composition over inheritance**: Build workflows from small, testable steps.
- **Make tool interfaces explicit and well-documented**.
- **Log everything**: Use the ledger and debug hooks for full transparency.
- **Test each step in isolation**.
- **Add complexity only when it demonstrably improves outcomes** ([Anthropic](https://www.anthropic.com/research/building-effective-agents)).

## References
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [f(x) library source code](./src/index.ts)
- [Your agent implementation](./src/recursiveResearchAgent.ts)

---

By following these steps and principles, you can build reliable, maintainable, and powerful LLM agents using the f(x) functional framework. 