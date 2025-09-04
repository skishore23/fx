# @fx/core

**Functional Programming Framework with Category Theory Principles** - A TypeScript framework for building composable, immutable, and type-safe AI agents using functional programming and category theory.

## ✨ Features

- ✅ **Category Theory**: Built on morphisms, functors, and monads
- ✅ **Immutable State**: All state transformations are pure functions
- ✅ **Type Safety**: Full TypeScript support with strict typing
- ✅ **Composable Operations**: Sequence, parallel, conditional composition
- ✅ **Tool System**: Pluggable tool registration with validation
- ✅ **Event Sourcing**: Built-in ledger system for audit trails
- ✅ **LLM Integration**: Built-in AI workflow helpers
- ✅ **Async by Default**: Everything works with promises
- ✅ **Fail-Fast**: No fallbacks, explicit error propagation

## Installation

```bash
npm install @fx/core
```

## Quick Start

### Basic Usage

```typescript
import { agent, task, sequence, parallel, plan } from '@fx/core';

// Create tasks (lambda functions that transform context)
const validate = task('validate', (ctx) => {
  (data) => ({ ...data, counter: 0 }),
  (data) => ({ ...data, counter: data.counter + 1 }),
  async (data) => {
    // This can be async and will be handled automatically
    await someAsyncOperation();
    return { ...data, processed: true };
  }
);

const result = await myWorkflow({});
console.log(result); // { counter: 1, processed: true }

// Method 2: Agent with lifecycle management
const myAgent = agent('data-processor')
  .step('validate', (data) => {
    if (!data.input) throw new Error('Input required');
    return { ...data, validated: true };
  })
  .step('process', async (data) => {
    const result = await someAPI.call(data.input);
    return { ...data, result };
  })
  .catch((error, data) => {
    console.error('Agent failed:', error.message);
    return { ...data, error: error.message };
  });

// Start the agent
await myAgent.start({ input: 'hello world' });

// Later, stop it
await myAgent.stop();
```

### LLM Integration

```typescript
import { agent, llm } from '@fx/core';

// Create LLM helper
const ai = llm(async (prompt: string) => {
  // Your LLM call here (OpenAI, Anthropic, etc.)
  return await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }]
  }).then(res => res.choices[0].message.content || '');
});

const chatAgent = agent('chat-bot')
  .step('analyze', ai.conversation(
    'You are a helpful assistant.',
    'Analyze this input: {{input}}'
  ))
  .step('validate', ai.validate(
    { sentiment: 'string', confidence: 'number' },
    'Extract sentiment and confidence from: {{lastResponse}}'
  ))
  .catch((error, data) => {
    console.error('AI processing failed:', error.message);
    return { ...data, fallback: 'Unable to process request' };
  });

await chatAgent.start({ input: 'I love this product!' });
```

### Error Handling & Resilience

```typescript
import { agent, autoLift } from '@fx/core';

// Automatic retries with exponential backoff
const resilientAgent = agent('api-caller')
  .step('fetch', autoLift(async (data) => {
    const response = await fetch(data.url);
    if (!response.ok) throw new Error('API call failed');
    return { ...data, result: await response.json() };
  }, { maxRetries: 5 }))
  .step('transform', (data) => {
    return { ...data, transformed: data.result.map(item => item.name) };
  })
  .catch((error, data) => {
    return { ...data, error: error.message, fallback: [] };
  });

await resilientAgent.start({ url: 'https://api.example.com/data' });
```

### Durable Agent with Persistence

```typescript
import { agent } from '@fx/core';

const durableAgent = agent('long-running-task', {
  persistence: true,
  autoRestart: true
})
  .step('load-data', async (data) => {
    // This step might take a long time
    const result = await expensiveOperation(data);
    return { ...data, loaded: result };
  })
  .step('process', (data) => {
    return { ...data, processed: data.loaded.map(transform) };
  })
  .catch((error, data) => {
    console.error('Processing failed, will retry later');
    return data; // Agent will persist state and can be restarted
  });

// Start the long-running agent
await durableAgent.start({ input: largeDataset });

// Later, you can check status
console.log(durableAgent.getStatus()); // 'running' | 'completed' | 'error'

// Pause and resume
await durableAgent.pause();
// ... some time later ...
await durableAgent.resume();
```

## Category Theory Concepts

### Morphisms and Composition

Every Fx operation is a **morphism** - a function between objects in a category:

```typescript
// Identity morphism (fundamental categorical construct)
Fx.identity<A>() // A → A

// Composition of morphisms
Fx.compose<A, B, C>(f: Step<B, C>, g: Step<A, B>): Step<A, C>

// Sequence as monadic bind
Fx.sequence(steps: Step<A, A>[]): Step<A, A>
```

### Functors and Natural Transformations

```typescript
// Functor type class
type Functor<F> = {
  map: <A, B>(fa: F & { __type: A }, f: (a: A) => B) => F & { __type: B };
};

// Natural transformation between functors
type NaturalTransformation<F, G> = <A>(fa: F & { __type: A }) => G & { __type: A };

// Built-in natural transformations
Fx.identityToMaybe: NaturalTransformation<Id, Maybe>;
Fx.maybeToIdentity: NaturalTransformation<Maybe, Id>;
```

### Monads

```typescript
// Monad type class
type Monad<M> = Functor<M> & {
  of: <A>(a: A) => M & { __type: A };
  chain: <A, B>(ma: M & { __type: A }, f: (a: A) => M & { __type: B }) => M & { __type: B };
};

// Maybe monad for optional values
Maybe.of(42); // Just(42)
Maybe.chain(Just(42), x => Just(x * 2)); // Just(84)

// Either monad for error handling
Either.of("success"); // Right("success")
Either.chain(Right("data"), processData); // Right(processedData) or Left(error)
```

### Kleisli Arrows

```typescript
// Kleisli arrow - function in monadic context
type Kleisli<M, A, B> = (a: A) => M & { __type: B };

// Compose Kleisli arrows
const composeK = <M>(monad: Monad<M>) =>
  <A, B, C>(f: Kleisli<M, B, C>, g: Kleisli<M, A, B>): Kleisli<M, A, C> =>
    (a: A) => monad.chain(g(a), f);

// Usage with Maybe monad
const safeDivide = (x: number) => x !== 0 ? Maybe.of(10 / x) : Maybe.Nothing;
const safeWorkflow = composeK(Maybe)(
  (result: number) => Maybe.of(result + 1),
  safeDivide
);
```

## Core Concepts

### State Operations

Fx provides simple, powerful operations for working with state:

```typescript
// Set values at any path
const setCounter = Fx.set('counter', 0);
const setUser = Fx.set('user.name', 'Alice');

// Update values with functions
const increment = Fx.update('counter', n => n + 1);
const addToList = Fx.update('items', items => [...items, 'new item']);

// Get values (returns a function)
const getCounter = Fx.get('counter');
const getName = Fx.get('user.name');
```

### Composition

Combine operations in flexible ways:

```typescript
// Execute in sequence
const workflow = Fx.sequence(
  Fx.set('status', 'processing'),
  Fx.update('counter', n => n + 1),
  Fx.log('Step completed')
);

// Execute in parallel
const parallelWork = Fx.parallel(
  Fx.set('task1', 'done'),
  Fx.set('task2', 'done'),
  Fx.set('task3', 'done')
);

// Conditional execution
const conditional = Fx.when(
  state => state.isValid,
  Fx.set('status', 'approved'),
  Fx.set('status', 'rejected')
);
```

### Actions and Prompts

Create reusable workflow steps:

```typescript
// Simple actions
const saveData = Fx.action('save-data', async (state) => {
  await database.save(state.data);
  return { ...state, saved: true };
});

// LLM prompts
const summarize = Fx.prompt(
  'summarize',
  state => `Summarize: ${state.text}`,
  async (prompt) => {
    return await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }]
    }).then(res => res.choices[0].message.content);
  }
);
```

## API Reference

### Simple Agent API (Recommended)

#### Agent Creation & Methods
```typescript
const myAgent = agent('my-agent')
  .step('validate', (data) => {
    if (!data.input) throw new Error('Input required');
    return { ...data, validated: true };
  })
  .step('process', async (data) => {
    const result = await api.call(data.input);
    return { ...data, result };
  })
  .catch((error, data) => {
    console.error('Failed:', error.message);
    return { ...data, error: error.message };
  });

// Control the agent
await myAgent.start({ input: 'hello' });
await myAgent.stop();
await myAgent.pause();
await myAgent.resume();
```

#### Utility Functions
```typescript
// Simple workflow with automatic error handling
const myWorkflow = workflow(
  (data) => ({ ...data, step1: 'done' }),
  async (data) => {
    const result = await apiCall();
    return { ...data, apiResult: result };
  }
);

// Auto-lift functions with retries
const resilientFn = autoLift(
  async (data) => {
    const response = await fetch(data.url);
    return { ...data, response: await response.json() };
  },
  { maxRetries: 3, fallback: { error: 'API failed' } }
);
```

#### LLM Integration
```typescript
const ai = llm(async (prompt) => {
  // Your LLM call here
  return await openai.complete(prompt);
});

const chatAgent = agent('chat-bot')
  .step('analyze', ai.conversation(
    'You are a helpful assistant.',
    'Analyze: {{input}}'
  ))
  .step('validate', ai.validate(
    { sentiment: 'string' },
    'Extract sentiment from: {{lastResponse}}'
  ));
```

### Advanced Category Theory API

#### Workflow Functions
- `Fx.prompt(name, buildPrompt, llm)` - Create an LLM prompt morphism

#### State Operations (Pure Morphisms)
- `Fx.set(path, value)` - Set a value at the specified path
- `Fx.get(path)` - Get a value at the specified path (returns function)
- `Fx.update(path, updater)` - Update a value with a function
- `Fx.push(path, item)` - Push an item to an array
- `Fx.remove(path, predicate)` - Remove items from an array

#### Composition
- `Fx.sequence(...steps)` - Execute steps in sequence
- `Fx.parallel(...steps)` - Execute steps in parallel
- `Fx.compose(f, g)` - Compose two morphisms
- `Fx.composeK(monad)` - Kleisli arrow composition for monads

#### Monadic Operations
- `Fx.liftM(monad, f)` - Lift a function to monadic context

#### Category Theory
- `Fx.identity()` - Identity morphism
- `Fx.compose(f, g)` - Morphism composition

#### Execution
- `Fx.run(workflow, initialState)` - Execute a workflow

#### Configuration
- `Fx.configure(config)` - Configure Fx behavior

### Additional Utilities

#### Composition Helpers
- `Fx.log(message?)` - Log the current state
- `Fx.validate(predicate, errorMessage?)` - Validate state
- `Fx.tap(effect)` - Perform side effects without changing state
- `Fx.delay(ms)` - Delay execution

#### Resilience
- `Fx.retry(step, options?)` - Retry a step on failure

#### Event Logging (Optional)
- `enableLogging()` - Enable event logging
- `disableLogging()` - Disable event logging
- `getEvents()` - Get recent events

## Examples

### Simple Counter
```typescript
import Fx from '@fx/core';

const workflow = Fx.sequence(
  Fx.set('counter', 0),
  Fx.update('counter', n => n + 1),
  Fx.update('counter', n => n * 2)
);

const result = await Fx.run(workflow, {});
console.log(result.counter); // 2
```

### User Registration (with Kleisli)
```typescript
import Fx, { Either } from '@fx/core';

const registerUser = Fx.composeK(Either)(
  // Success handler
  (state: any) => Either.of({ ...state, status: 'success' }),

  // Validation and creation
  async (state: any) => {
    if (!state.email || !state.email.includes('@')) {
      return Either.of({ error: 'Invalid email' });
    }

    try {
      const user = await api.createUser(state);
      return Either.of({ ...state, user, registered: true });
    } catch (error) {
      return Either.of({ error: 'Failed to create user' });
    }
  }
);

// Extract result from Either monad
const result = registerUser({
  email: 'user@example.com',
  name: 'John Doe'
});
```

### LLM Integration
```typescript
const analyzeText = Fx.sequence(
  Fx.prompt(
    'analyze-sentiment',
    state => `Analyze sentiment of: ${state.text}`,
    async (prompt) => {
      return await llm.generate(prompt);
    }
  ),
  Fx.set('analysis', 'completed')
);

const result = await Fx.run(analyzeText, {
  text: 'I love this product!'
});
```

## Configuration

```typescript
import Fx from '@fx/core';

// Configure logging and retries
Fx.configure({
  enableLogging: true,
  maxRetries: 3,
  retryDelay: 1000
});
```

## License

MIT
