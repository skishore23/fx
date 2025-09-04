# Composition System

The composition system is the heart of Fx. It's how you build agents that actually work.

## Core Composition

Fx has a unified composition system where everything is async by default:

```typescript
// Sequential execution
const workflow = sequence([
  step1,
  step2, 
  step3
]);

// Parallel execution
const parallelWork = parallel([
  step1,
  step2,
  step3
]);

// Conditional execution
const conditional = when(
  (state) => state.shouldRun,
  someStep
);
```

## Basic Examples

```typescript
// Sequence two steps
const combined = sequence([
  step('update', (state) => updateState({ field1: 'value1' })(state)),
  step('log', (state) => addState('action', 'Updated field1')(state))
]);

// Sequence multiple steps
const multiStep = sequence([
  step('step1', (state) => updateState({ field1: 'value1' })(state)),
  step('log1', (state) => addState('action', 'Step 1')(state)),
  step('step2', (state) => updateState({ field2: 'value2' })(state)),
  step('log2', (state) => addState('action', 'Step 2')(state))
]);
```

## State Operations

Every state operation is a pure function that takes state and returns new state:

| Function | Purpose | Use Case |
|----------|---------|----------|
| `updateState` | Update multiple fields | General state updates |
| `addState` | Add memory entries | Log actions/observations |

## When to Use What

| Function | When to Use | Real Example |
|----------|-------------|--------------|
| `sequence` | Chain agent steps | `processInput → callLLM → handleTools → updateMemory` |
| `parallel` | Run independent operations | `readFile + searchCode + listDirectory` |
| `when` | Conditional logic | `if (user.isAdmin) runAdminTask else runUserTask` |

## Real-World Examples

### Building an Agent Workflow
```typescript
const codingAgent = sequence([
  processUserInput,      // Parse what the user wants
  runInference,          // Call the LLM
  handleToolCalls,       // Execute tools
  updateConversation     // Save the response
]);
```

### Updating State
```typescript
const updateUserSession = sequence([
  step('update', (state) => updateState({ lastActive: Date.now() })(state)),
  step('log', (state) => addState('action', 'User session updated')(state))
]);
```

### Error Handling in Steps
```typescript
const readFileStep = step('readFile', async (state) => {
  try {
    // Your file reading logic here
    const content = await readFile(state.filePath);
    return updateState({ fileContent: content })(state);
  } catch (error) {
    return updateState({ error: error.message })(state);
  }
});
```

### Using Patterns
```typescript
import { createReActPattern, createChainOfThoughtPattern } from '@fx/core';

const patternWorkflow = sequence([
  step('reason', createReActPattern('reasoning-agent')),
  step('think', createChainOfThoughtPattern('thinking-agent')),
  step('respond', generateResponse)
]);
```

## Best Practices

1. **Use `sequence` for agent workflows** - Chain steps that need to happen in order
2. **Use `parallel` for independent operations** - Speed up your agent by running things concurrently
3. **Use `when` for conditional logic** - Make your agents adaptive
4. **Handle errors functionally** - Use try/catch blocks appropriately
5. **Keep state immutable** - Never mutate state directly, always return new state

## Common Mistakes

**Don't do this:**
```typescript
// Mutating state directly
state.user.name = 'John';

// Not handling errors
const result = await someOperation();
// What if it fails?
```

**Do this instead:**
```typescript
// Return new state
return updateState({ user: { ...state.user, name: 'John' } })(state);

// Handle errors properly
try {
  const result = await someOperation();
  return updateState({ data: result })(state);
} catch (error) {
  return updateState({ error: error.message })(state);
}
```