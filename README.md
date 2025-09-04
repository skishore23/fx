# Fx Framework

Build production-ready AI agents with functional programming and category theory.

[![CI](https://github.com/fx-framework/fx/workflows/CI/badge.svg)](https://github.com/fx-framework/fx/actions)
[![npm version](https://badge.fury.io/js/%40fx%2Fcore.svg)](https://badge.fury.io/js/%40fx%2Fcore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why Fx?

Building AI agents that actually work in production is hard. Fx makes it easier by providing:

- **Functional Programming**: Pure functions, immutable state, and composable operations
- **Category Theory**: Mathematical foundations for reliable composition
- **Type Safety**: Full TypeScript support with comprehensive error handling
- **Production Ready**: Built-in logging, error handling, and state management
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
const updateUser = compose(
  updateState({ lastActive: Date.now() }),
  addState('action', 'User updated')
);
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

### 3. **Production-Ready Error Handling**
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

Here's a coding agent that can read files, search code, and generate responses:

```typescript
import { 
  step, 
  sequence, 
  parallel, 
  createValidatedTool,
  createOpenAIProvider,
  llmTemplateStep 
} from '@fx/core';

// Define tools with validation
const readFileTool = createValidatedTool(
  'read_file',
  'Read a file from the filesystem',
  z.object({ filePath: z.string() }),
  async ({ filePath }, state) => {
    const content = await fs.readFile(filePath, 'utf8');
    return updateState({ fileContent: content })(state);
  }
);

// Create LLM provider
const llmProvider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4'
});

// Build the agent
const codingAgent = sequence([
  step('processInput', (state) => 
    updateState({ userInput: state.userInput.trim() })(state)
  ),
  
  step('handleTools', async (state) => {
    const toolCalls = parseToolCalls(state.response);
    for (const toolCall of toolCalls) {
      state = await toolRegistry.execute(toolCall.name, state, toolCall.input);
    }
    return state;
  }),
  
  llmTemplateStep(
    'generateResponse',
    llmProvider,
    'You are a coding assistant. User input: {{userInput}}',
    (state) => ({ userInput: state.userInput })
  ),
  
  step('logAction', (state) => 
    addState('action', `Generated response for: ${state.userInput}`)(state)
  )
]);

// Run the agent
const result = await codingAgent({ 
  userInput: 'Read package.json and explain the dependencies',
  memory: [] 
});
```

## Documentation

- **[Installation & Setup](./docs/getting-started/installation.md)** - Get up and running in 5 minutes
- **[Quick Start Guide](./docs/getting-started/quick-start.md)** - Build your first agent
- **[Core Concepts](./docs/getting-started/concepts.md)** - Understanding functional programming in Fx
- **[Composition System](./docs/api/composition.md)** - How to build agent workflows
- **[API Reference](./docs/api/core.md)** - Complete function reference

## Examples

- **[Coding Agent](./examples/coding-agent/)** - Full-featured coding assistant
- **[Basic Examples](./examples/basic/)** - Simple use cases
- **[Advanced Examples](./examples/advanced/)** - Complex workflows

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
git clone https://github.com/fx-framework/fx.git
cd fx
npm install
npm run build
npm test
```

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Support

- 📖 [Documentation](./docs/)
- 🐛 [Issues](https://github.com/fx-framework/fx/issues)
- 💬 [Discussions](https://github.com/fx-framework/fx/discussions)