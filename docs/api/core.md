# Core API Reference

Everything you need to build agents with Fx.

## Core Functions

### `step(name, fn)`
Create a named step that transforms state.

```typescript
const myStep = step('processInput', (state) => {
  return updateState({ processed: true })(state);
});
```

### `sequence(steps)`
Run steps in order, passing state from one to the next.

```typescript
const workflow = sequence([
  processInput,
  callLLM,
  handleTools,
  updateMemory
]);
```

### `parallel(steps)`
Run steps concurrently and merge results.

```typescript
const parallelWork = parallel([
  readFile,
  searchCode,
  listDirectory
]);
```

### `when(predicate, thenStep, elseStep?)`
Conditional execution based on state.

```typescript
const conditional = when(
  (state) => state.user.isAdmin,
  adminTask,
  userTask
);
```

## State Management

### `updateState(updates)`
Update multiple fields in state.

```typescript
const newState = updateState({
  field1: 'value1',
  field2: 'value2'
})(state);
```

### `logAction(content, metadata?)`
Log an action to memory.

```typescript
const newState = logAction('User updated profile')(state);
```

### `logObservation(content, metadata?)`
Log an observation to memory.

```typescript
const newState = logObservation('File read successfully')(state);
```

### `logOutcome(content, metadata?)`
Log an outcome to memory.

```typescript
const newState = logOutcome('Task completed successfully')(state);
```

### `logError(content, metadata?)`
Log an error to memory.

```typescript
const newState = logError('Failed to read file')(state);
```

## Patterns

### `createReActPattern(llmProvider, tools?)`
Create a ReAct pattern for reasoning and acting.

```typescript
const reactPattern = createReActPattern(llmProvider, ['tool1', 'tool2']);
const result = await reactPattern.workflow(state);
```

### `createChainOfThoughtPattern(llmProvider)`
Create a Chain of Thought pattern for step-by-step reasoning.

```typescript
const cotPattern = createChainOfThoughtPattern(llmProvider);
const result = await cotPattern.workflow(state);
```

### `createPattern(predicate, action)`
Create a custom pattern.

```typescript
const customPattern = createPattern(
  (state) => state.userInput?.includes('urgent'),
  (state) => updateState({ priority: 'high' })(state)
);
```

## High-Level API

### `Agent` class
The agent class with methods for starting and monitoring.

```typescript
import { Agent, step, sequence } from '@fx/core';

const workflow = sequence([
  step('init', (state) => state),
  step('process', processInput),
  step('respond', generateResponse)
]);

const agent = new Agent(workflow);
await agent.start(initialState);
console.log(agent.getStatus()); // 'running' | 'completed' | 'error'
console.log(agent.getState()); // current state
```

### Durable Execution
Create durable agents with checkpointing capabilities.

```typescript
import { executeDurable, createMemoryPersistence } from '@fx/core';

const persistence = createMemoryPersistence();
const config = {
  persistence,
  checkpointInterval: 1000
};

const result = await executeDurable(workflow, initialState, config);
```

## Error Handling

### `Either`
Functional error handling with `Either.left()` and `Either.right()`.

```typescript
import { Either } from '@fx/core';

const result = Either.right('success');
const error = Either.left(new Error('Something went wrong'));

// Handle results
Either.fold(
  result,
  (error) => console.error('Error:', error.message),
  (value) => console.log('Success:', value)
);
```

### `safe` and `safeAsync`
Wrap potentially throwing functions into Either monads.

```typescript
import { safe, safeAsync } from '@fx/core';

// Synchronous safe wrapper
const safeParse = safe((json: string) => JSON.parse(json));
const result = safeParse('{"valid": "json"}');

// Asynchronous safe wrapper
const safeApiCall = safeAsync(async (url: string) => {
  const response = await fetch(url);
  return response.json();
});
const apiResult = await safeApiCall('https://api.example.com/data');
```

## Durable Execution

### `checkpoint(persistence, reason?)`
Create a checkpoint of the current state.

```typescript
import { checkpoint, createMemoryPersistence } from '@fx/core';

const persistence = createMemoryPersistence();
const checkpointStep = checkpoint(persistence, 'saving progress');
```

### `resumeFromCheckpoint(persistence, checkpointId, extras?)`
Resume execution from a saved checkpoint.

```typescript
import { resumeFromCheckpoint } from '@fx/core';

const resumeStep = resumeFromCheckpoint(persistence, 'checkpoint-123', {
  additionalData: 'new data'
});
```

### `pause(persistence, reason?)`
Pause execution and save current state.

```typescript
import { pause } from '@fx/core';

const pauseStep = pause(persistence, 'user requested pause');
```

### `executeDurable(step, initialState, config)`
Execute a step with automatic checkpointing.

```typescript
import { executeDurable, createMemoryPersistence } from '@fx/core';

const persistence = createMemoryPersistence();
const config = {
  persistence,
  checkpointInterval: 1000
};

const result = await executeDurable(myStep, initialState, config);
```

## Types

### `BaseContext`
Base interface that all agent states must extend.

```typescript
interface MyAgentState extends BaseContext {
  userInput: string;
  response?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}
```

### `Step<T>`
A step function that transforms state of type `T`.

```typescript
type Step<T> = (state: T) => T | Promise<T>;
```

### `Plan<T>`
A plan containing a name and executable workflow.

```typescript
interface Plan<T> {
  name: string;
  execute: Step<T>;
}
```

## Examples

### Basic Agent
```typescript
import { 
  step, sequence, createPlan, createAgent,
  updateState, addState
} from '@fx/core';

const workflow = sequence([
  step('processInput', (state) => 
    updateState({ processed: true })(state)
  ),
  step('generateResponse', (state) => 
    updateState({ response: 'Hello!' })(state)
  ),
  step('logAction', (state) => 
    addState('action', 'Response generated')(state)
  )
]);

const plan = createPlan('basic-agent', workflow);
const agent = createAgent('basic-agent', plan);

const result = await agent.start({ userInput: 'Hello' });
```

### Using Patterns
```typescript
import { 
  createReActPattern, createChainOfThoughtPattern, createPattern
} from '@fx/core';

// ReAct pattern
const reactPattern = createReActPattern('reasoning-agent');

// Chain of thought pattern
const cotPattern = createChainOfThoughtPattern('thinking-agent');

// Custom pattern
const urgentPattern = createPattern(
  (state) => state.userInput?.includes('urgent'),
  (state) => updateState({ priority: 'high' })(state)
);
```

### Parallel Processing
```typescript
import { parallel } from '@fx/core';

const parallelWork = parallel([
  step('analyze', (state) => updateState({ analysis: 'done' })(state)),
  step('categorize', (state) => updateState({ category: 'text' })(state)),
  step('summarize', (state) => updateState({ summary: 'done' })(state))
]);
```

### Conditional Logic
```typescript
import { when } from '@fx/core';

const conditionalStep = when(
  (state) => state.userInput?.includes('admin'),
  step('adminTask', (state) => updateState({ role: 'admin' })(state)),
  step('userTask', (state) => updateState({ role: 'user' })(state))
);
```

## Best Practices

1. **Keep steps focused** - Each step should do one thing well
2. **Use meaningful names** - Step names should describe what they do
3. **Handle errors gracefully** - Use try/catch blocks appropriately
4. **Keep state immutable** - Always return new state, never mutate
5. **Compose from small pieces** - Build complex workflows from simple steps
6. **Test individual steps** - Test each step in isolation
7. **Use patterns for common behaviors** - ReAct, Chain of Thought, etc.

## Common Patterns

### State Updates
```typescript
// Update multiple fields
const newState = updateState({
  field1: 'value1',
  field2: 'value2'
})(state);

// Add to memory
const newState = addState('memory', 'New entry')(state);
```

### Error Handling
```typescript
const safeStep = step('safeStep', (state) => {
  try {
    // Your logic here
    return updateState({ result: 'success' })(state);
  } catch (error) {
    return updateState({ error: error.message })(state);
  }
});
```

### Conditional Updates
```typescript
const conditionalUpdate = when(
  (state) => state.userInput?.includes('urgent'),
  step('urgent', (state) => updateState({ priority: 'high' })(state)),
  step('normal', (state) => updateState({ priority: 'normal' })(state))
);
```

This reference covers all the essential functions in the Fx Framework. Start with the basic composition functions and gradually explore the patterns and high-level APIs as you build more complex agents.