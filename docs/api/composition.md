# Composition System

The composition system is the heart of Fx. It's how you build agents that actually work in production.

## Unified Composition

Fx has a unified composition system where everything is async by default. This simplifies the API and makes it more predictable:

```typescript
// Sequential execution
const workflow = sequence([
  step1,
  step2, 
  step3
]);

// Parallel execution with default merge strategy
const parallelWork = parallel([
  step1,
  step2,
  step3
]);

// Parallel execution with custom merge strategy
const parallelWithMerge = parallel([
  step1,
  step2,
  step3
], mergeStrategies.first); // or .last, .collect, .selective(['field1', 'field2'])

// Conditional execution
const conditional = when(
  (state) => state.shouldRun,
  someStep
);
```

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

Every state operation is a pure function that takes state and returns new state. No mutations, no side effects:

| Function | Type | Purpose | Use Case |
|----------|------|---------|----------|
| `updateState` | `Record<string,any> → (T→T)` | General state updates | Update multiple fields |
| `addState` | `string × string → (T→T)` | Add memory entries | Log actions/observations |
| `get` | `string → (T→unknown)` | Get field value | Extract data |
| `set` | `string × any → (T→T)` | Set field value | Update single field |
| `update` | `string × (any→any) → (T→T)` | Update field with function | Transform field value |
| `push` | `string × any → (T→T)` | Add to array | Append to lists |
| `remove` | `string × Predicate → (T→T)` | Remove from array | Filter arrays |

## When to Use What

| Function | When to Use | Real Example |
|----------|-------------|--------------|
| `sequence` | Chain agent steps | `processInput → callLLM → handleTools → updateMemory` |
| `parallel` | Run independent operations | `readFile + searchCode + listDirectory` |
| `when` | Conditional logic | `if (user.isAdmin) runAdminTask else runUserTask` |

## Parallel Execution

When you run operations in parallel, you need to decide how to combine the results:

```typescript
// Default: merge everything (most common)
parallel([step1, step2, step3])

// Take first result (useful for fallbacks)
parallel([step1, step2, step3], mergeStrategies.first)

// Collect all results (useful for aggregating data)
parallel([step1, step2, step3], mergeStrategies.collect)

// Only merge specific fields (useful for selective updates)
parallel([step1, step2, step3], mergeStrategies.selective(['user', 'timestamp']))
```

## Real-World Examples

### Building an Agent Workflow
```typescript
const codingAgent = sequence([
  processUserInput,      // Parse what the user wants
  runInference,          // Call the LLM
  handleToolCalls,       // Execute tools (read files, run commands)
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
  const result = safeReadFile(state.filePath);
  return Either.fold(
    result,
    (error) => sequence([
      step('updateError', (s) => updateState({ error: error.message })(s)),
      step('logError', (s) => addState('observation', `Error: ${error.message}`)(s))
    ])(state),
    (content) => sequence([
      step('updateContent', (s) => updateState({ fileContent: content })(s)),
      step('logSuccess', (s) => addState('action', 'File read successfully')(s))
    ])(state)
  );
});
```

## Naming Convention

All operations use "state" terminology since we work with `AgentState`:

- **`updateState`**: Update multiple fields at once
- **`addState`**: Add memory entries (actions/observations) 
- **`get`**: Get a field value
- **`set`**: Set a field value
- **`update`**: Update a field with a function
- **`push`**: Add to an array
- **`remove`**: Remove from an array



## Best Practices

1. **Use `sequence` for agent workflows** - Chain steps that need to happen in order
2. **Use `parallel` for independent operations** - Speed up your agent by running things concurrently
3. **Use `when` for conditional logic** - Make your agents adaptive
4. **Handle errors functionally** - Use `Either` instead of try/catch blocks
5. **Keep state immutable** - Never mutate state directly, always return new state

## Common Mistakes

**Don't do this:**
```typescript
// Mutating state directly
state.user.name = 'John';

// Using try/catch in steps
try {
  const result = await someOperation();
} catch (error) {
  // Handle error
}
```

**Do this instead:**
```typescript
// Return new state
return updateState({ user: { ...state.user, name: 'John' } })(state);

// Use Either for error handling
const result = await someOperation();
return Either.fold(
  result,
  (error) => updateState({ error: error.message })(state),
  (data) => updateState({ data })(state)
);
```
