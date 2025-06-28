# f(x) Library API Reference

This document provides detailed documentation for all functions in the f(x) library.

## Core Functions

### `Fx.wrap`

Creates a wrapped function with logging, error handling, and other middleware capabilities.

```typescript
function wrap<S>(
  name: string, 
  fn: (state: S, log: Ledger<S>) => Promise<S>
): Step<S>
```

#### Parameters
- `name`: String identifier for the wrapped function
- `fn`: The function to wrap that transforms state

#### Returns
A wrapped function that includes logging and error handling

### `Fx.sequence`

Composes multiple steps into a sequential workflow.

```typescript
function sequence<S>(...steps: Step<S>[]): Step<S>
```

#### Parameters
- `steps`: Array of steps to execute in sequence

#### Returns
A composed function that runs all steps in order

### `Fx.parallel`

Executes multiple steps in parallel and combines their results.

```typescript
function parallel<S>(...steps: Step<S>[]): Step<S>
```

#### Parameters
- `steps`: Array of steps to execute in parallel

#### Returns
A function that runs all steps concurrently

### `Fx.focus`

Creates a lens that focuses on a specific part of the state.

```typescript
function focus<S, A>(
  path: Path<S, A>,
  step: Step<A>
): Step<S>
```

#### Parameters
- `path`: Path to focus on in the state
- `step`: Step to execute on focused state

#### Returns
A function that operates only on the focused part of state

### `Fx.tool`

Registers a new tool with validation.

```typescript
function tool<S, Schema extends z.ZodType>(
  name: string,
  schema: Schema,
  factory: (...args: z.infer<Schema>) => Step<S>
): (...args: z.infer<Schema>) => Step<S>
```

#### Parameters
- `name`: Tool identifier
- `schema`: Zod schema for validating arguments
- `factory`: Function that creates the tool step

#### Returns
A function that creates validated tool steps

### `Fx.spawn`

Spawns a new agent instance.

```typescript
function spawn<S>(
  agent: Agent<S>,
  initialState: S
): Promise<S>
```

#### Parameters
- `agent`: Agent definition to spawn
- `initialState`: Initial state for the agent

#### Returns
Promise resolving to final state

### `Fx.debug`

Attaches a debug handler to monitor execution.

```typescript
function debug(
  handler: (event: Event, state: unknown) => void
): void
```

#### Parameters
- `handler`: Function to handle debug events

### `Fx.retry`

Adds retry capability to a step.

```typescript
function retry<S>(
  step: Step<S>,
  options: RetryOptions
): Step<S>
```

#### Parameters
- `step`: Step to add retries to
- `options`: Retry configuration

#### Returns
Step with retry capability

### `Fx.cache`

Adds caching to a step.

```typescript
function cache<S>(
  step: Step<S>,
  options: CacheOptions
): Step<S>
```

#### Parameters
- `step`: Step to cache
- `options`: Cache configuration

#### Returns
Step with caching

## State Management

### `Fx.record`

Records an event in the ledger.

```typescript
function record<S>(
  log: Ledger<S>,
  event: Event<S>,
  snapshot: S
): Promise<void>
```

### `Fx.replayEvents`

Replays a sequence of events to reconstruct state.

```typescript
function replayEvents<S>(
  events: Event<S>[],
  initialState: S
): S
```

## Type Definitions

```typescript
type Step<S> = (state: S, log: Ledger<S>) => Promise<S>

type Event<S> = {
  id: string
  name: string
  ts: number
  beforeHash: string
  afterHash: string
  meta?: unknown
}

type Ledger<S> = Event<S>[]

type Agent<S> = {
  name: string
  workflow: Step<S>
}

interface RetryOptions {
  maxAttempts: number
  delay: number
  backoff: number
}

interface CacheOptions {
  ttl: number
  maxSize: number
}
``` 