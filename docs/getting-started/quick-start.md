# Quick Start Guide

Build your first agent with Fx in 10 minutes.

## What You'll Build

A simple agent that processes input and generates responses. This demonstrates the core capabilities of the Fx framework.

## Step 1: Basic Agent

```typescript
import { 
  Agent,
  step, 
  sequence, 
  updateState, 
  logAction
} from '@fx/core';

// Define your agent's state
interface AgentState {
  userInput: string;
  response?: string;
  memory: any[];
  executionTime?: number;
}

// Step 1: Process user input
const processInput = step('processInput', (state: AgentState) => {
  return updateState({ 
    userInput: state.userInput.trim() 
  })(state);
});

// Step 2: Generate response
const generateResponse = step('generateResponse', (state: AgentState) => {
  const response = `Processed: ${state.userInput}`;
  return updateState({ response })(state);
});

// Step 3: Log the action
const logActionStep = step('logAction', (state: AgentState) => {
  return logAction(`Processed: ${state.userInput}`)(state);
});

// Create the agent workflow
const agentWorkflow = sequence([
  processInput,
  generateResponse,
  logActionStep
]);
```

## Step 2: Create and Run Your Agent

```typescript
// Create the agent
const agent = new Agent(agentWorkflow);

// Run the agent
async function runAgent() {
  const initialState: AgentState = {
    userInput: "Hello, world!",
    memory: []
  };

  const result = await agent.start(initialState);
  
  console.log('Response:', result.response);
  console.log('Memory entries:', result.memory.length);
}

runAgent();
```

## Step 3: Add Error Handling

```typescript
import { Either } from '@fx/core';

const processWithErrorHandling = step('processWithErrorHandling', (state: AgentState) => {
  try {
    // Simulate processing that might fail
    if (state.userInput.length < 3) {
      throw new Error('Input too short');
    }
    
    const response = `Processed: ${state.userInput}`;
    return updateState({ response })(state);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return updateState({ 
      response: `Error: ${errorMessage}`,
      error: errorMessage 
    })(state);
  }
});
```

## Step 4: Use Patterns

```typescript
import { createReActPattern, createChainOfThoughtPattern } from '@fx/core';

// ReAct pattern for reasoning and acting
const reactPattern = createReActPattern(llmProvider, ['tool1', 'tool2']);

// Chain of thought pattern for step-by-step reasoning
const cotPattern = createChainOfThoughtPattern(llmProvider);

// Use patterns in your workflow
const patternWorkflow = sequence([
  step('reason', reactPattern.workflow),
  step('think', cotPattern.workflow),
  step('respond', generateResponse)
]);
```

## Step 5: Parallel Processing

```typescript
import { parallel } from '@fx/core';

const parallelWork = parallel([
  step('analyze', (state) => updateState({ analysis: 'Analyzed' })(state)),
  step('categorize', (state) => updateState({ category: 'Text' })(state)),
  step('summarize', (state) => updateState({ summary: 'Summary' })(state))
]);

const parallelWorkflow = sequence([
  processInput,
  parallelWork,
  generateResponse
]);
```

## Step 6: Conditional Logic

```typescript
import { when } from '@fx/core';

const conditionalStep = when(
  (state) => state.userInput.includes('urgent'),
  step('urgentTask', (state) => updateState({ priority: 'high' })(state)),
  step('normalTask', (state) => updateState({ priority: 'normal' })(state))
);

const conditionalWorkflow = sequence([
  processInput,
  conditionalStep,
  generateResponse
]);
```

## Complete Example

```typescript
import { 
  Agent,
  step, 
  sequence, 
  parallel,
  when,
  updateState, 
  logAction
} from '@fx/core';

interface AgentState {
  userInput: string;
  response?: string;
  priority?: string;
  memory: any[];
}

const completeWorkflow = sequence([
  step('processInput', (state) => 
    updateState({ userInput: state.userInput.trim() })(state)
  ),
  
  when(
    (state) => state.userInput.includes('urgent'),
    step('urgentTask', (state) => updateState({ priority: 'high' })(state)),
    step('normalTask', (state) => updateState({ priority: 'normal' })(state))
  ),
  
  parallel([
    step('analyze', (state) => updateState({ analysis: 'Analyzed' })(state)),
    step('categorize', (state) => updateState({ category: 'Text' })(state))
  ]),
  
  step('generateResponse', (state) => {
    const response = `[${state.priority}] Processed: ${state.userInput}`;
    return updateState({ response })(state);
  }),
  
  step('logAction', (state) => 
    logAction(`Processed: ${state.userInput}`)(state)
  )
]);

// Create and run the agent
const agent = new Agent(completeWorkflow);

async function runCompleteAgent() {
  const result = await agent.start({
    userInput: "urgent: process this data",
    memory: []
  });
  
  console.log('Response:', result.response);
  console.log('Priority:', result.priority);
}

runCompleteAgent();
```

## What's Next?

- **Add more steps**: File reading, data processing, API calls
- **Improve error handling**: Better error recovery and user feedback
- **Add memory**: Persistent conversation history
- **Add validation**: Input validation and sanitization
- **Add logging**: Track agent behavior and performance

## Common Patterns

### State Composition
```typescript
const updateUser = sequence([
  step('updateLastActive', (s) => updateState({ lastActive: Date.now() })(s)),
  step('addAction', (s) => logAction('User updated')(s)),
  step('updateVersion', (s) => updateState({ version: '1.0.0' })(s))
]);
```

### Error Handling
```typescript
const safeOperation = step('safeOperation', (state) => {
  try {
    // Your operation here
    return updateState({ result: 'success' })(state);
  } catch (error) {
    return updateState({ error: error.message })(state);
  }
});
```

## Need Help?

- Check the [Composition Guide](../api/composition.md) for more patterns
- Look at [examples](../examples/) for real-world implementations
- Read the [API Reference](../api/core.md) for all available functions