# Core Concepts

Why Fx works the way it does, and how to think about building agents functionally.

## Functional Programming Principles

Fx is built on functional programming principles that make your code more predictable, testable, and maintainable.

### Pure Functions

All operations in Fx are pure functions:

```typescript
// ✅ Pure function - same input always produces same output
const add = (a: number, b: number) => a + b;

// ❌ Impure function - has side effects
const addWithLogging = (a: number, b: number) => {
  console.log('Adding:', a, b); // Side effect!
  return a + b;
};
```

### Immutability

State is never mutated in place:

```typescript
// ✅ Immutable - creates new object
const updateUser = (user: User, name: string) => ({
  ...user,
  name
});

// ❌ Mutable - modifies existing object
const updateUserBad = (user: User, name: string) => {
  user.name = name; // Mutation!
  return user;
};
```

### Composition

Build complex operations from simple ones:

```typescript
const processData = sequence([
  validate,
  transform,
  save
]);
```

## State Management

### State as Data

State in Fx is just data - objects that flow through your workflow:

```typescript
interface AppState {
  input: string;
  processed?: string;
  result?: any;
  errors?: string[];
}
```

### State Transformations

Each task transforms state:

```typescript
const process = step('process', (state) => {
  return updateState({
    processed: state.input.toUpperCase(),
    timestamp: Date.now()
  })(state);
});
```

### State Lenses

Focus on specific parts of state:

```typescript
import { set, get, update } from '@fx/core';

// Set a value
const setValue = set('user.name', 'John');

// Get a value
const getName = get('user.name');

// Update a value
const increment = update('counter', (n: number) => n + 1);
```

## Composition Patterns

### Sequential Composition

Run operations one after another:

```typescript
const workflow = sequence([
  validateInput,
  processData,
  saveResult
]);
```

### Parallel Composition

Run operations simultaneously:

```typescript
const workflow = parallel([
  fetchUserData,
  fetchProductData,
  fetchOrderData
]);
```

### Conditional Composition

Run operations based on conditions:

```typescript
import { when } from '@fx/core';

const workflow = sequence([
  validateInput,
  when(
    (state) => state.user.isPremium,
    premiumProcessing,
    standardProcessing
  )
]);
```

## Error Handling

### Error Handling

Fx handles errors by propagating them immediately:

```typescript
const validate = step('validate', (state) => {
  if (!state.input) {
    throw new Error('Input required'); // Fails immediately
  }
  return updateState({ validated: true })(state);
});
```


```typescript
// ❌ Bad - hides errors
const processWithDefault = step('process', (state) => {
  try {
    return updateState({ result: processData(state.input) })(state);
  } catch (error) {
    return updateState({ result: 'default' })(state); // Hides the error!
  }
});

// ✅ Good - let errors propagate
const process = step('process', (state) => {
  return updateState({ result: processData(state.input) })(state);
});
```

## Tool System

### Tool Registration

Register tools with validation:

```typescript
import { createValidatedTool } from '@fx/core';
import { z } from 'zod';

const searchTool = createValidatedTool(
  'search',
  'Search for information',
  z.object({ query: z.string() }),
  async ({ query }, state) => {
    const results = await searchAPI(query);
    return updateState({ searchResults: results })(state);
  }
);
```

### Tool Usage

Use registered tools:

```typescript
import { step } from '@fx/core';

const searchStep = step('search', async (state) => {
  return await toolRegistry.execute('search', state, { query: 'typescript' });
});
```

## Category Theory

Fx is built on category theory principles:

### Morphisms

Tasks are morphisms - functions that transform objects:

```typescript
type Step<A, B> = (a: A) => B
```

### Functors

State lenses are functors - they preserve structure:

```typescript
const userLens = focus(['user'], updateUser);
```

### Monads

Sequential composition with context:

```typescript
const workflow = sequence([
  fetchData,    // Returns state with data
  processData,  // Takes data, returns processed state
  saveResult    // Takes processed state, returns saved state
]);
```

## Best Practices

### 1. Keep Tasks Small

```typescript
// ✅ Good - single responsibility
const validateEmail = step('validateEmail', (state) => {
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);
  return updateState({ emailValid: isValid })(state);
});

// ❌ Bad - multiple responsibilities
const validateAndProcess = step('validateAndProcess', (state) => {
  // Validation logic
  // Processing logic
  // Saving logic
});
```

### 2. Use Descriptive Names

```typescript
// ✅ Good
const validateUserInput = step('validateUserInput', ...);
const processPayment = step('processPayment', ...);

// ❌ Bad
const step1 = step('step1', ...);
const doStuff = step('doStuff', ...);
```

### 3. Handle Errors Explicitly

```typescript
// ✅ Good
const process = step('process', (state) => {
  if (!state.data) {
    throw new Error('Data required');
  }
  return updateState({ processed: processData(state.data) })(state);
});
```

## Next Steps

- [API Reference](../api/core.md) - Complete API documentation
- [Basic Examples](../examples/basic/) - Practical examples
- [Topics](../advanced/) - Deep dive into concepts
