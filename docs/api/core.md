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

### `parallel(steps, mergeStrategy?)`
Run steps concurrently and merge results.

```typescript
const parallelWork = parallel([
  readFile,
  searchCode,
  listDirectory
], mergeStrategies.default);
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

### `loopWhile(predicate, body)`
Repeat a step while condition is true.

```typescript
const retryLoop = loopWhile(
  (state) => state.attempts < 3 && state.error,
  retryStep
);
```

## State Operations

### `updateState(updates)`
Update multiple fields in state.

```typescript
const updateUser = updateState({ 
  name: 'John', 
  lastActive: Date.now() 
});
```

### `addState(type, content, metadata?)`
Add a memory entry to state.

```typescript
const logAction = addState('action', 'User logged in', { 
  timestamp: Date.now() 
});
```

### `get(path)`
Get a value from state by path.

```typescript
const getUserName = get('user.name');
```

### `set(path, value)`
Set a value in state by path.

```typescript
const setUserName = set('user.name', 'John');
```

### `update(path, updater)`
Update a value using a function.

```typescript
const incrementCounter = update('counter', (count) => count + 1);
```

### `push(path, item)`
Add an item to an array.

```typescript
const addToHistory = push('history', newEntry);
```

### `remove(path, predicate)`
Remove items from an array.

```typescript
const removeOldEntries = remove('history', (entry) => 
  Date.now() - entry.timestamp > 86400000
);
```

## Composition

### `sequence(steps)`
Execute steps in sequence - the fundamental composition primitive.

```typescript
const workflow = sequence([
  step('update', (state) => updateState({ processed: true })(state)),
  step('log', (state) => addState('action', 'Processing complete')(state))
]);
```

### `parallel(steps, mergeStrategy?)`
Execute steps in parallel with optional merge strategy.

```typescript
const parallelWork = parallel([
  step('readFile', (state) => readFile(state.filePath)(state)),
  step('searchCode', (state) => searchCode(state.query)(state))
], mergeStrategies.collect);
```

## LLM Integration

### `createOpenAIProvider(config)`
Create an OpenAI provider for LLM calls.

```typescript
const llmProvider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4'
});
```

### `llmTemplateStep(name, provider, template, dataExtractor)`
Create a step that calls an LLM with a template.

```typescript
const generateResponse = llmTemplateStep(
  'generateResponse',
  llmProvider,
  'Respond to: {{userInput}}',
  (state) => ({ userInput: state.userInput })
);
```

### `llmStep(name, provider, messages)`
Create a step that calls an LLM with custom messages.

```typescript
const customLLM = llmStep(
  'customLLM',
  llmProvider,
  (state) => [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: state.userInput }
  ]
);
```

## Tool System

### `createToolRegistry()`
Create a registry for tools.

```typescript
const toolRegistry = createToolRegistry<AgentState>();
```

### `createTool(name, description, execute)`
Create a simple tool.

```typescript
const readFileTool = createTool(
  'read_file',
  'Read a file from the filesystem',
  async (state) => {
    const content = await fs.readFile(state.filePath, 'utf8');
    return updateState({ fileContent: content })(state);
  }
);
```

### `createValidatedTool(name, description, schema, execute)`
Create a tool with input validation.

```typescript
import { z } from 'zod';

const ReadFileSchema = z.object({
  filePath: z.string()
});

const validatedTool = createValidatedTool(
  'read_file',
  'Read a file from the filesystem',
  ReadFileSchema,
  async (input, state) => {
    const content = await fs.readFile(input.filePath, 'utf8');
    return updateState({ fileContent: content })(state);
  }
);
```

## Error Handling

### `Either`
Functional error handling without try/catch.

```typescript
import { Either } from '@fx/core';

const result = await someOperation();
return Either.fold(
  result,
  (error) => updateState({ error: error.message })(state),
  (data) => updateState({ data })(state)
);
```

### `safe(fn)`
Wrap a function to return Either.

```typescript
const safeReadFile = safe(async (filePath) => {
  return await fs.readFile(filePath, 'utf8');
});
```

### `safeAsync(fn)`
Wrap an async function to return Either.

```typescript
const safeAsyncOperation = safeAsync(async (state) => {
  const result = await someAsyncOperation(state);
  return result;
});
```

## Agent Management

### `createAgent(name, plan)`
Create an interactive agent.

```typescript
const agent = createAgent('my-agent', sequence([
  processInput,
  generateResponse,
  updateMemory
]));
```

### `agent.start(initialState)`
Start an interactive agent session.

```typescript
await agent.start({
  userInput: '',
  memory: []
});
```

## Ledger System

### `enableLogging()`
Enable automatic event logging.

```typescript
enableLogging();
```

### `logEvent(type, data)`
Log a custom event.

```typescript
logEvent('user_action', { action: 'login', userId: '123' });
```

### `getEvents()`
Get all logged events.

```typescript
const events = getEvents();
console.log('Total events:', events.length);
```

## Merge Strategies

### `mergeStrategies`
Predefined strategies for parallel execution.

```typescript
// Default: merge all results
mergeStrategies.default

// Take first successful result
mergeStrategies.first

// Take last successful result
mergeStrategies.last

// Collect all results in array
mergeStrategies.collect

// Merge only specific fields
mergeStrategies.selective(['field1', 'field2'])

// Custom merge function
mergeStrategies.custom((results, original) => {
  // Your custom logic
  return mergedState;
})
```

## Utility Functions

### `identity()`
Return state unchanged (useful for composition).

```typescript
const noop = identity();
```

### `noop()`
Alias for identity.

```typescript
const emptyStep = noop();
```

### `fail(message)`
Create a step that always fails.

```typescript
const errorStep = fail('Something went wrong');
```

### `log(message?)`
Create a step that logs state.

```typescript
const debugStep = log('Current state:');
```

### `validate(predicate, errorMessage?)`
Create a step that validates state.

```typescript
const validateUser = validate(
  (state) => state.user && state.user.id,
  'User must be authenticated'
);
```

### `tap(effect)`
Create a step that performs side effects without changing state.

```typescript
const logToFile = tap((state) => {
  fs.appendFileSync('log.txt', JSON.stringify(state));
});
```

### `delay(ms)`
Create a step that delays execution.

```typescript
const waitStep = delay(1000); // Wait 1 second
```

### `retry(step, maxAttempts?, baseDelay?)`
Create a step that retries on failure.

```typescript
const retryStep = retry(riskyOperation, 3, 100);
```

### `timeout(step, timeoutMs)`
Create a step with a timeout.

```typescript
const timeoutStep = timeout(slowOperation, 5000);
```