# Creating an Agent with Fx Framework

This guide walks you through creating a complete agent using the Fx Framework.

## Table of Contents

1. [Overview](#overview)
2. [Step 1: Define Your Agent State](#step-1-define-your-agent-state)
3. [Step 2: Build Workflow](#step-2-build-workflow)
4. [Step 3: Create Agent](#step-3-create-agent)
5. [Patterns](#patterns)
6. [Best Practices](#best-practices)

## Overview

The Fx Framework provides a functional approach to building AI agents. Every agent follows these core principles:

- **Functional Composition**: Agents are built by composing pure functions
- **State Management**: Immutable state transformations using lenses
- **Error Handling**: Functional error handling with `Either` monad
- **Patterns**: Built-in patterns for common AI behaviors

## Step 1: Define Your Agent State

Start by defining your agent's state interface, extending `BaseContext`:

```typescript
import { BaseContext } from '@fx/core';

interface MyAgentState extends BaseContext {
  // Core conversation
  conversation: Array<{ role: string; content: string }>;
  
  // Agent-specific state
  currentGoal: string;
  response?: string;
  
  // Memory
  memory: Array<{
    type: 'action' | 'observation' | 'error';
    content: string;
    timestamp: string;
  }>;
}
```

### State Management Principles

- **Immutable**: State is never mutated directly
- **Lens-based**: Use `updateState`, `addState` for transformations
- **Composable**: State changes are pure functions that can be composed

## Step 2: Build Workflow

Create your agent's workflow using functional composition:

```typescript
import { step, sequence, updateState, addState } from '@fx/core';

// Process user input
const processUserInput = step('processUserInput', (state: MyAgentState) => {
  const lastMessage = state.conversation?.[state.conversation.length - 1];
  if (!lastMessage) return state;

  console.log(`👤 User: ${lastMessage.content}`);
  
  return updateState({
    currentGoal: lastMessage.content
  })(state);
});

// Generate response
const generateResponse = step('generateResponse', (state: MyAgentState) => {
  const response = `I understand you want: ${state.currentGoal}`;
  console.log(`🤖 Assistant: ${response}`);
  
  return updateState({
    response,
    conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
  })(state);
});

// Log action
const logAction = step('logAction', (state: MyAgentState) => {
  return addState('action', `Processed: ${state.currentGoal}`)(state);
});

// Main workflow
const agentWorkflow = sequence([
  processUserInput,
  generateResponse,
  logAction
]);
```

## Step 3: Create Agent

Create your agent using the workflow:

```typescript
import { createPlan, createAgent } from '@fx/core';

// Create the agent plan
const plan = createPlan('my-agent', [
  step('initialize', (state: MyAgentState) => {
    console.log('🚀 My Agent started!');
    return state;
  }),
  
  agentWorkflow,
  
  step('goodbye', (state: MyAgentState) => {
    console.log('👋 Goodbye!');
    return state;
  })
]);

// Create the agent
const myAgent = createAgent('my-agent', plan);

// Run the agent
export const runMyAgent = async () => {
  const initialState: MyAgentState = {
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: []
  };
  
  try {
    const result = await myAgent.start(initialState);
    console.log('Final result:', result);
  } catch (error) {
    console.error('Agent failed:', error);
  }
};
```

## Patterns

### Using Chain of Thought

For complex reasoning tasks, use the Chain of Thought pattern:

```typescript
import { createChainOfThoughtPattern } from '@fx/core';

// Extend your state to include Chain of Thought properties
interface MyAgentState extends BaseContext {
  // ... existing properties
  
  // Chain of Thought properties
  problem: string;
  thoughts: Array<{
    step: number;
    thought: string;
    reasoning: string;
  }>;
  conclusion?: string;
}

// Create Chain of Thought workflow
const createReasoningWorkflow = () => {
  const chainOfThoughtPattern = createChainOfThoughtPattern('reasoning-agent');
  
  return sequence([
    step('initializeChainOfThought', (state: MyAgentState) => {
      return updateState({
        problem: state.currentGoal || 'Solve the user\'s request',
        thoughts: [],
        conclusion: undefined
      })(state);
    }),
    
    step('executeChainOfThought', async (state: MyAgentState) => {
      return chainOfThoughtPattern(state);
    })
  ]);
};
```

### Using ReAct Pattern

For iterative problem solving:

```typescript
import { createReActPattern } from '@fx/core';

// Create ReAct workflow
const createReActWorkflow = () => {
  const reactPattern = createReActPattern('reasoning-agent');
  
  return sequence([
    step('executeReAct', async (state: MyAgentState) => {
      return reactPattern(state);
    })
  ]);
};
```

### Using Custom Patterns

```typescript
import { createPattern } from '@fx/core';

// Create a custom pattern
const customPattern = createPattern(
  (state) => state.currentGoal.includes('urgent'),
  (state) => updateState({ priority: 'high' })(state)
);

const customWorkflow = sequence([
  processUserInput,
  customPattern,
  generateResponse
]);
```

## Best Practices

### 1. State Management
- Keep state immutable
- Use lenses for state transformations
- Avoid direct mutations

### 2. Error Handling
- Use try/catch blocks appropriately
- Provide meaningful error messages
- Handle errors gracefully

### 3. Composition
- Build workflows from small, composable steps
- Use `sequence` for linear workflows
- Use `parallel` for concurrent operations
- Use `when` for conditional logic

### 4. Testing
- Test individual steps in isolation
- Test complete workflows end-to-end
- Use meaningful test data

## Complete Example

Here's a complete example of a simple agent:

```typescript
import { 
  step, sequence, createPlan, createAgent,
  updateState, addState, createReActPattern
} from '@fx/core';

// State
interface SimpleAgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  response?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

// Workflow
const simpleAgentWorkflow = sequence([
  step('processInput', (state: SimpleAgentState) => {
    const lastMessage = state.conversation?.[state.conversation.length - 1];
    return updateState({
      currentGoal: lastMessage?.content || ''
    })(state);
  }),
  
  step('generateResponse', (state: SimpleAgentState) => {
    const response = `I understand: ${state.currentGoal}`;
    return updateState({
      response,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    })(state);
  }),
  
  step('logAction', (state: SimpleAgentState) => {
    return addState('action', `Processed: ${state.currentGoal}`)(state);
  })
]);

// Agent
const plan = createPlan('simple-agent', [
  step('init', (state) => {
    console.log('🚀 Simple Agent started!');
    return state;
  }),
  simpleAgentWorkflow
]);

export const simpleAgent = createAgent('simple-agent', plan);

// Usage
export const runSimpleAgent = async () => {
  const result = await simpleAgent.start({
    conversation: [{ role: 'user', content: 'Hello!' }],
    currentGoal: '',
    memory: []
  });
  
  console.log('Result:', result);
};
```

## Quick Reference

### Essential Imports
```typescript
import { 
  // Core composition
  step, sequence, parallel, when,
  
  // State operations
  updateState, addState,
  
  // Patterns
  createReActPattern, createChainOfThoughtPattern, createPattern,
  
  // Agent creation
  createPlan, createAgent,
  
  // Error handling
  Either
} from '@fx/core';
```

### Common Patterns

#### Basic Agent Structure
```typescript
interface MyAgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentGoal: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

const plan = createPlan('my-agent', [
  step('init', (state) => { /* initialize */ return state; }),
  workflow,
  step('cleanup', (state) => { /* cleanup */ return state; })
]);

const agent = createAgent('my-agent', plan);
```

#### State Updates
```typescript
// Multiple field update
const newState = updateState({
  field1: value1,
  field2: value2
})(state);

// Add to memory
const newState = addState('action', 'Something happened')(state);
```

### Common Gotchas

1. **Don't mutate state directly** - use lenses
2. **Handle errors gracefully** - use try/catch appropriately
3. **Keep steps focused** and single-purpose
4. **Test with meaningful data**
5. **Use patterns for common behaviors**

This guide provides everything you need to create agents using the Fx Framework. Start simple and gradually add complexity as you become more familiar with the patterns and composition techniques.