# Fx Framework

Build AI agents with functional programming and category theory.

## Why Fx?

Building AI agents that actually work in production is hard. Fx makes it easier by providing:

- **Functional Programming**: Pure functions, immutable state, and composable operations
- **Category Theory**: Mathematical foundations for reliable composition
- **Type Safety**: Full TypeScript support with comprehensive error handling
- **Intelligent Tool Calling**: Pattern-based routing with learned fallbacks
- **Built-in Safety**: Safety controls, observability, and state management
- **Developer Experience**: Clean API that feels natural to use

## Quick Start

```bash
npm install @fx/core
```

```typescript
import { step, sequence, updateState, addState } from '@fx/core';

// Create a simple agent workflow
const agent = sequence([
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

// Run the agent
const result = await agent({ input: 'Hello' });
console.log(result.response); // "Hello!"
```

## What Makes Fx Different?

### 1. **Functional by Design**
Every operation is a pure function that transforms state. No mutations, no side effects.

```typescript
// State transformations are composable
const updateUser = sequence([
  updateState({ lastActive: Date.now() }),
  addState('action', 'User updated')
]);
```

### 2. **Category Theory Principles**
Built on mathematical foundations that make composition predictable and reliable.

```typescript
// Parallel execution with proper result merging
const parallelWork = parallel([
  readFile,
  searchCode,
  listDirectory
], mergeStrategies.default);
```

### 3. **Error Handling**
No try/catch blocks. Use `Either` for functional error handling.

```typescript
const result = await safeReadFile(filePath);
return Either.fold(
  result,
  (error) => updateState({ error: error.message })(state),
  (content) => updateState({ content })(state)
);
```

### 4. **Built-in Observability**
Every action is logged automatically. Track your agent's behavior.

```typescript
enableLogging();
// All agent lifecycle events are automatically logged
// Custom events: logEvent('user_action', { action: 'login' });
```

## Real-World Example

Here's an agent that uses intelligent tool calling to read files, search code, and generate responses:

```typescript
import { 
  createAgentExecutor,
  createPlan,
  createAgent,
  step,
  sequence,
  updateState,
  addState
} from '@fx/core';

// Create an agent executor with intelligent tool calling
const executor = createAgentExecutor();

// Build the agent workflow
const codingAgent = sequence([
  step('processInput', (state) => 
    updateState({ userInput: state.userInput.trim() })(state)
  ),
  
  step('executeTools', async (state) => {
    const { state: newState, result } = await executor.runTurn(state, state.userInput);
    return {
      ...newState,
      toolResults: result.results,
      executionTime: result.executionTimeMs
    };
  }),
  
  step('logAction', (state) => 
    addState('action', `Processed: ${state.userInput}`)(state)
  )
]);

// Create and run the agent
const agent = createAgent('coding-agent', createPlan('coding-workflow', codingAgent));
const result = await agent.start({ 
  userInput: 'read package.json and write summary to output.txt',
  memory: [] 
});
```

The agent automatically:
- Routes user input to appropriate tools using pattern matching
- Parses complex arguments like file paths with spaces
- Plans multi-step operations with dependency resolution
- Applies safety policies and resource quotas
- Tracks all decisions for observability

## Documentation

- **[Installation & Setup](./docs/getting-started/installation.md)** - Get up and running in 5 minutes
- **[Quick Start Guide](./docs/getting-started/quick-start.md)** - Build your first agent
- **[Core Concepts](./docs/getting-started/concepts.md)** - Understanding functional programming in Fx
- **[Tool Calling & Routing](./docs/guides/tool-calling-and-routing.md)** - Intelligent tool selection and execution
- **[Composition System](./docs/api/composition.md)** - How to build agent workflows
- **[API Reference](./docs/api/core.md)** - Complete function reference

## Examples

- **[Tool Calling Example](./examples/tool-calling-example.ts)** - Complete tool calling demonstration
- **[Coding Agent](./examples/coding-agent/)** - Full-featured coding assistant
- **[Research Agent](./examples/research-agent/)** - Advanced research and analysis

## Installation

```bash
# Core framework
npm install @fx/core

# With OpenAI integration
npm install @fx/core openai
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Development Setup

```bash
git clone https://github.com/skishore23/fx.git
cd fx
npm install
npm run build
npm test
```

## Support

- 📖 [Documentation](./docs/)