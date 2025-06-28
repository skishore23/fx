# State Management in f(x)

The f(x) framework uses immutable state management with pure functional transformations. This document explains the core concepts and patterns for managing state in f(x) agents.

## Core Concepts

### Immutable State

All state in f(x) is immutable. Instead of modifying state directly, we create new state objects:

```typescript
// Bad - mutating state
state.count++;

// Good - creating new state
return {
  ...state,
  count: state.count + 1
};
```

### State Transitions

Every state change is an explicit transformation:

```typescript
type Step<S> = (state: S, log: Ledger<S>) => Promise<S>
```

### Event Logging

All state transitions are recorded in an event ledger:

```typescript
interface Event<S> {
  id: string;
  name: string;
  ts: number;
  beforeHash: string;
  afterHash: string;
  meta?: unknown;
}

type Ledger<S> = Event<S>[];
```

## State Management Patterns

### 1. Focused Updates

Use lenses to update nested state:

```typescript
const updateUserPreference = Fx.focus(
  ['user', 'preferences', 'theme'],
  Fx.action("setTheme", (theme: string) => () => theme)
);
```

### 2. Batch Updates

Combine multiple updates atomically:

```typescript
const batchUpdate = Fx.sequence(
  updateA,
  updateB,
  updateC
);
```

### 3. Conditional Updates

Update state based on conditions:

```typescript
const conditionalUpdate = Fx.wrap("conditional", async (state, log) => {
  if (state.needsUpdate) {
    return await updateState(state);
  }
  return state;
});
```

## State Validation

Use Zod schemas to validate state:

```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  preferences: z.object({
    theme: z.enum(['light', 'dark'])
  })
});

const validateUser = Fx.validate(UserSchema);
```

## Time Travel and Debugging

### 1. Event Replay

Reconstruct state from events:

```typescript
const finalState = Fx.replayEvents(events, initialState);
```

### 2. State Inspection

Debug state at any point:

```typescript
Fx.debug((event, state) => {
  console.log(`State after ${event.name}:`, state);
});
```

### 3. State Snapshots

Create checkpoints for important states:

```typescript
const withSnapshot = Fx.wrap("snapshot", async (state, log) => {
  await Fx.record(log, {
    name: "checkpoint",
    state: state
  });
  return state;
});
```

## Best Practices

1. **Keep State Minimal**
   - Only store essential data
   - Derive computed values when needed
   - Split large state into focused domains

2. **Validate State Changes**
   - Use schemas to validate state shape
   - Add runtime checks for invariants
   - Log validation failures

3. **Handle Edge Cases**
   - Plan for all possible state transitions
   - Provide fallback values
   - Document assumptions

4. **Performance Considerations**
   - Use shallow copies when possible
   - Batch related updates
   - Consider using immutable.js for large states

## Example: Complex State Management

```typescript
interface ComplexState {
  users: Record<string, User>;
  transactions: Transaction[];
  settings: Settings;
}

const complexWorkflow = Fx.sequence(
  // Update user
  Fx.focus(['users', userId], updateUser),
  
  // Add transaction
  Fx.focus(['transactions'], addTransaction),
  
  // Update settings if needed
  Fx.focus(['settings'], 
    Fx.wrap("updateSettings", async (settings, log) => {
      if (needsUpdate(settings)) {
        return await updateSettings(settings);
      }
      return settings;
    })
  ),
  
  // Validate final state
  validateState
);
```

## Debugging Tools

The framework provides several tools for debugging state:

1. **State Diffing**
   ```typescript
   const diff = Fx.diff(beforeState, afterState);
   ```

2. **State History**
   ```typescript
   const history = Fx.getStateHistory(ledger);
   ```

3. **State Visualization**
   ```typescript
   Fx.visualize(state, options);
   ```

## Further Reading

- [Immutable Data Patterns](https://immutable-js.com/docs/concepts/)
- [Functional State Management](https://redux.js.org/understanding/thinking-in-redux/three-principles)
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) 