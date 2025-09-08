# @fx/navigator

**Topological Agents** - Autonomous, emergent execution with intelligent decision-making

## Overview

`@fx/navigator` is designed for **topological agents** that make autonomous decisions and adapt to changing conditions. It builds on top of `@fx/core` and provides:

- **Guard-driven steps** - Steps run based on state conditions and intelligent decisions
- **Emergent parallelism** - Independent steps automatically run in parallel
- **Core integration** - Uses core's prompts, tools, and patterns for intelligent behavior
- **Policy-driven execution** - Retry, timeout, approval, and other policies
- **ReAct pattern** - Iterative reasoning and acting with LLM-powered decisions
- **Autonomous decision-making** - Intelligent tool selection and execution planning
- **Persistence** - Checkpoint and resume capabilities for long-running agents

## When to Use Navigator

Use `@fx/navigator` when you need:
- **Autonomous agents** that make intelligent decisions
- **Emergent behavior** that adapts to changing conditions
- **Topological execution** where order emerges from conditions
- **LLM-powered reasoning** for decision-making
- **Dynamic tool selection** based on context
- **Self-organizing workflows** that discover optimal execution paths

## Quick Start

```typescript
import { createAgent, step, when } from '@fx/navigator';

// Define steps with guards
const fetch = step('fetch', when(ctx => !!ctx.query), async (ctx) => ({
  ...ctx, 
  docs: await web(ctx.query) 
}));

const chunk = step('chunk', when(ctx => !!ctx.docs), async (ctx) => ({
  ...ctx, 
  chunks: split(ctx.docs) 
}));

const summarize = step('summarize', when(ctx => !!ctx.chunks), async (ctx) => ({
  ...ctx, 
  summary: await llm(ctx.chunks) 
}));

// Create agent and run
const agent = createAgent()
  .add(fetch, chunk, summarize);

const result = await agent.run({ query: 'why fx?' });
// Parallelism and order are inferred automatically!
```

## Core Concepts

### Steps

Steps are the fundamental unit of execution. Each step has:

- **Name** - Unique identifier
- **Guard** - Function that determines if the step should run
- **Run** - Function that performs the work
- **Dependencies** - Optional step dependencies
- **Policies** - Optional execution policies

```typescript
const step = step(
  'processData',
  when(ctx => ctx.data !== undefined), // guard
  async (ctx) => ({ ...ctx, processed: true }), // run
  {
    idempotentKey: (ctx) => ctx.id,
    projection: (ctx) => ctx.data
  }
);
```

### Guards

Guards determine when steps can run. Common guard patterns:

```typescript
import { when } from '@fx/navigator';

// Check for single field
const hasData = when(ctx => ctx.data !== undefined);

// Check for multiple fields
const hasAll = when(ctx => ctx.data && ctx.config);

// Check for any field
const hasAny = when(ctx => ctx.data || ctx.cache);

// Custom guard
const customGuard = when(ctx => ctx.value > 0 && ctx.enabled);
```

### Policies

Policies modify step execution behavior:

```typescript
// Configure policies on the agent
agent.policy.retry('fetch', { times: 3, backoff: 'exp', startMs: 1000 });
agent.policy.timeout(5000);
agent.policy.independent(['fetch'], ['warmCache']);
agent.policy.approval('deploy', { via: 'callback', meta: { prompt: 'Deploy to production?' } });
```

## Execution Modes

### Standard Execution

```typescript
const result = await agent.run(initialState);
```

### ReAct Pattern

```typescript
const result = await agent.react({
  initialState,
  decide: async (state) => 'next action',
  goal: (state) => state.completed === true
});
```

### With Persistence

```typescript
const agent = createAgent()
  .add(tasks)
  .persist({
    save: async (id, state) => { /* save to DB */ },
    load: async (id) => { /* load from DB */ }
  });

// Resume from checkpoint
const result = await agent.resume('checkpoint-123');
```

## Examples

### RAG Pipeline

```typescript
const agent = createAgent()
  .add(fetchDocs)
  .add(warmCache)  // Independent of fetchDocs
  .add(chunkDocs)
  .add(summarize)
  .withPolicy(createIndependentPolicy({
    taskNames: ['fetchDocs', 'warmCache'],
    canRunInParallel: true
  }));

// fetchDocs and warmCache run in parallel automatically!
const result = await agent.run({ query: 'why fx?' });
```

### Code Agent with ReAct

```typescript
const agent = createAgent()
  .add(readRepo)
  .add(plan)
  .add(edit)
  .add(test)
  .add(commit)
  .withPolicy(createRetryPolicy({ maxAttempts: 3 }));

const result = await agent.react({
  initialState: { repoPath: '/path/to/repo' },
  decide: async (state) => state.testsPassing ? 'commit' : 'fix tests',
  goal: (state) => state.committed === true
});
```

### Human-in-the-Loop

```typescript
const agent = createAgent()
  .add(writeCode)
  .add(runTests)
  .add(deploy)
  .withPolicy(createApprovalPolicy({
    taskName: 'deploy',
    via: 'console',
    prompt: 'Deploy to production?'
  }));

// Execution pauses for human approval
const result = await agent.run({});
```

## API Reference

### createAgent(config?)

Creates a new navigator agent.

### task(name, guard, execute)

Creates a task with guard and execution function.

### createTask(name, guard, execute, options?)

Creates a task with additional options.

### Policies

- `createRetryPolicy(config)` - Retry failed tasks
- `createTimeoutPolicy(config)` - Timeout task execution
- `createApprovalPolicy(config)` - Require human approval
- `createIndependentPolicy(config)` - Allow parallel execution
- `createCompactPolicy(selector, maxSize, compactFn)` - Limit data size
- `createPausePolicy(condition, reason)` - Pause execution
- `createValidationPolicy(validator, errorMessage)` - Validate state
- `createLoggingPolicy(level)` - Log task execution

### Agent Methods

- `add(task)` - Add a task
- `addMany(tasks)` - Add multiple tasks
- `withPolicy(policy)` - Add a policy
- `withConfig(config)` - Update configuration
- `run(state)` - Execute tasks
- `plan(state)` - Get execution plan
- `react(options)` - Execute with ReAct pattern
- `persist(options)` - Enable persistence
- `resume(checkpointId, extras?)` - Resume from checkpoint
- `on(eventType, handler)` - Add event handler

## When to Use Navigator

Use `@fx/navigator` when you need:

- **Adaptive execution** - Tasks that run based on state conditions
- **Emergent parallelism** - Independent tasks that can run in parallel
- **Policy-driven behavior** - Retry, timeout, approval, etc.
- **ReAct patterns** - Iterative reasoning and acting
- **Human-in-the-loop** - Approval gates and manual intervention
- **Durability** - Checkpoint and resume capabilities

For explicit, stable workflows, use `@fx/flow` instead.

## Architecture

Navigator builds on `@fx/core` and provides:

1. **Router** - Picks runnable tasks based on guards
2. **Scheduler** - Executes tasks in layers with optional parallelism
3. **Policies** - Modify task execution behavior
4. **Agent** - High-level API for task orchestration

The shared algebra from `@fx/core` ensures both runtimes are composable and provable.
