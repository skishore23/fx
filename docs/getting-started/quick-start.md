# Quick Start Guide

Build your first agent with Fx in 10 minutes.

## What You'll Build

A simple agent that uses tool calling to read files and answer questions about them. This demonstrates the core capabilities of the Fx framework.

## Step 1: Agent with Tool Calling

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

// Define your agent's state
interface AgentState {
  userInput: string;
  fileContent?: string;
  response?: string;
  memory: any[];
  toolResults?: any[];
  executionTime?: number;
}

// Create an agent executor with tool calling
const executor = createAgentExecutor();

// Step 1: Process user input
const processInput = step('processInput', (state: AgentState) => {
  return updateState({ 
    userInput: state.userInput.trim() 
  })(state);
});

// Step 2: Execute tools
const executeTools = step('executeTools', async (state: AgentState) => {
  const { state: newState, result } = await executor.runTurn(state, state.userInput);
  
  return {
    ...newState,
    toolResults: result.results,
    executionTime: result.executionTimeMs,
    response: result.success ? 'Tools executed successfully' : `Error: ${result.error}`
  };
});

// Step 3: Log the action
const logAction = step('logAction', (state: AgentState) => {
  return addState('action', `Processed: ${state.userInput} (${state.executionTime}ms)`)(state);
});

// Create the agent workflow
const agentWorkflow = sequence([
  processInput,
  executeTools,
  logAction
]);
```

## Step 2: Create and Run Your Agent

```typescript
// Create the agent
const agent = createAgent('file-agent', createPlan('file-workflow', agentWorkflow));

// Run the agent
async function runAgent() {
  const initialState: AgentState = {
    userInput: "read config.json and write summary to output.txt",
    memory: []
  };

  const result = await agent.start(initialState);
  
  console.log('Response:', result.response);
  console.log('Tool results:', result.toolResults);
  console.log('Execution time:', result.executionTime, 'ms');
  console.log('Memory entries:', result.memory.length);
}

runAgent();
```

## What Happens Automatically

The `createAgentExecutor()` provides tool calling that automatically:

1. **Routes Input**: Uses pattern matching to identify which tools to use
2. **Parses Arguments**: Handles complex inputs like file paths with spaces
3. **Plans Execution**: For multi-step operations, creates a dependency graph
4. **Applies Safety**: Enforces resource quotas and safety policies
5. **Tracks Decisions**: Records all tool selections for observability

For example, when you say "read config.json and write to output.txt", the executor:
- Identifies `read_file` and `write_file` tools
- Parses the file paths correctly
- Plans the execution order (read first, then write)
- Applies appropriate safety policies
- Tracks the decision for future improvement

## Step 3: Add Error Handling

```typescript
import { Either, safe } from '@fx/core';

const readFileWithErrorHandling = step('readFile', async (state: AgentState) => {
  const result = await safe(async () => {
    // Simulate file reading that might fail
    if (Math.random() > 0.5) {
      throw new Error('File not found');
    }
    return "File content here";
  });

  return Either.fold(
    result,
    (error) => sequence([
      step('updateError', (s) => updateState({ error: error.message })(s)),
      step('logError', (s) => addState('observation', `Error: ${error.message}`)(s))
    ])(state),
    (content) => sequence([
      step('updateContent', (s) => updateState({ fileContent: content })(s)),
      step('logSuccess', (s) => addState('action', 'File read successfully')(s))
    ])(state)
  );
});
```

## Step 4: Add Tools

```typescript
import { createToolRegistry, createValidatedTool } from '@fx/core';
import { z } from 'zod';

// Define tool schemas
const ReadFileSchema = z.object({
  filePath: z.string()
});

// Create tool registry
const toolRegistry = createToolRegistry<AgentState>();

// Register tools
toolRegistry.register(
  createValidatedTool(
    'read_file',
    'Read a file from the filesystem',
    ReadFileSchema,
    async (input, state) => {
      // In a real implementation, you'd read the actual file
      const content = `Content of ${input.filePath}`;
      return updateState({ fileContent: content })(state);
    }
  )
);

// Use tools in your agent
const handleToolCalls = step('handleToolCalls', async (state: AgentState) => {
  // Parse tool calls from LLM response
  const toolCalls = parseToolCalls(state.response);
  
  for (const toolCall of toolCalls) {
    const result = await toolRegistry.execute(toolCall.name, state, toolCall.input);
    state = result;
  }
  
  return state;
});
```

## Step 5: Make It Interactive

```typescript
import { createAgent } from '@fx/core';

// Create an interactive agent
const interactiveAgent = createAgent('file-reader', sequence([
  processInput,
  readFileWithErrorHandling,
  generateResponse,
  handleToolCalls,
  updateConversation
]));

// Run interactively
async function runInteractiveAgent() {
  const initialState: AgentState = {
    userInput: '',
    memory: []
  };

  await interactiveAgent.start(initialState);
}

runInteractiveAgent();
```

## What's Next?

- **Add more tools**: File writing, code search, command execution
- **Improve error handling**: Better error recovery and user feedback
- **Add memory**: Persistent conversation history
- **Add validation**: Input validation and sanitization
- **Add logging**: Track agent behavior and performance

## Common Patterns

### Parallel Operations
```typescript
import { parallel, mergeStrategies } from '@fx/core';

const parallelWork = parallel([
  readFile,
  searchCode,
  listDirectory
], mergeStrategies.default);
```

### Conditional Logic
```typescript
import { when } from '@fx/core';

const conditionalStep = when(
  (state) => state.userInput.includes('admin'),
  adminTask,
  userTask
);
```

### State Composition
```typescript
import { sequence, step, updateState, addState } from '@fx/core';

const updateUser = sequence([
  step('updateLastActive', (s) => updateState({ lastActive: Date.now() })(s)),
  step('addAction', (s) => addState('action', 'User updated')(s)),
  step('updateVersion', (s) => updateState({ version: '1.0.0' })(s))
]);
```

## Need Help?

- Check the [Composition Guide](../api/composition.md) for more patterns
- Look at [examples](../examples/) for real-world implementations
- Read the [API Reference](../api/core.md) for all available functions