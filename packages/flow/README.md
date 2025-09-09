# @fx/flow

**Workflow-Style Agents** - Explicit, stable workflow execution

## Overview

`@fx/flow` is designed for **workflow-style agents** that require explicit, deterministic execution. It builds on top of `@fx/core` and provides:

- **Explicit workflows** - Clear, deterministic execution paths with step dependencies
- **Stable execution** - Predictable, reproducible results for production workflows
- **Core integration** - Uses core's prompts, tools, and patterns for intelligent workflows
- **Workflow validation** - Built-in dependency checking and error handling
- **Event monitoring** - Comprehensive execution monitoring and debugging
- **Retry policies** - Configurable retry, timeout, and validation policies

## When to Use Flow

Use `@fx/flow` when you need:
- **Deterministic workflows** with clear step sequences
- **Production-ready agents** with explicit error handling
- **Workflow validation** and dependency management
- **Stable, reproducible** execution patterns
- **Explicit control** over execution order and timing

## Quick Start

```typescript
import { 
  step, 
  sequence, 
  updateState,
  logAction,
  Agent
} from '@fx/core';

// Define workflow steps
const processInput = step('processInput', async (ctx) => {
  return updateState({ processed: true })(ctx);
});

const generateResponse = step('generateResponse', async (ctx) => {
  return updateState({ response: 'Generated response' })(ctx);
});

const logResult = step('logResult', async (ctx) => {
  return logAction('Workflow completed')(ctx);
});

// Create workflow
const workflow = sequence([processInput, generateResponse, logResult]);

// Execute workflow
const agent = new Agent(workflow);
const result = await agent.start(initialState);
```

## Core Integration

`@fx/flow` seamlessly integrates with `@fx/core`:

- **LLM Integration**: Use `createOpenAIProvider`, `llmTemplateStep`, `promptTemplate`
- **Memory System**: Use `logAction`, `logObservation`, `logOutcome`, `logError` for tracking
- **Patterns**: Use `createReActPattern`, `createChainOfThoughtPattern` for intelligent workflows
- **State Management**: Use `updateState`, `get`, `set` for state operations
- **Composition**: Use `sequence`, `parallel`, `when` for workflow composition

## Architecture

Flow agents follow a **workflow-style** architecture:

1. **Explicit Steps**: Each step is clearly defined with dependencies
2. **Deterministic Execution**: Steps run in a predictable order
3. **Validation**: Built-in dependency checking and error handling
4. **Monitoring**: Comprehensive event tracking and debugging
5. **Policies**: Configurable retry, timeout, and validation policies

## Examples

See the `examples/flow-agent/` directory for complete workflow agent examples that demonstrate:
- Core tool integration
- LLM-powered workflows
- State management
- Error handling and validation
