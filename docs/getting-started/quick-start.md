# Quick Start Guide

Build your first AI agent with Fx in 10 minutes.

## What You'll Build

A simple agent that can read files and answer questions about them. This is the foundation for more complex agents.

## Step 1: Basic Agent Structure

```typescript
import { 
  step, 
  sequence, 
  updateState, 
  addState,
  createOpenAIProvider,
  llmTemplateStep 
} from '@fx/core';

// Define your agent's state
interface AgentState {
  userInput: string;
  fileContent?: string;
  response?: string;
  memory: any[];
}

// Create the LLM provider
const llmProvider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4'
});

// Step 1: Process user input
const processInput = step('processInput', (state: AgentState) => {
  return updateState({ 
    userInput: state.userInput.trim() 
  })(state);
});

// Step 2: Read file if requested
const readFile = step('readFile', async (state: AgentState) => {
  if (state.userInput.includes('read file')) {
    // In a real implementation, you'd read the actual file
    const content = "This is sample file content.";
    return compose(
      updateState({ fileContent: content }),
      addState('action', 'File read successfully')
    )(state);
  }
  return state;
});

// Step 3: Generate response
const generateResponse = llmTemplateStep(
  'generateResponse',
  llmProvider,
  `You are a helpful assistant. 
   
   User input: {{userInput}}
   File content: {{fileContent}}
   
   Respond to the user's request.`,
  (state: AgentState) => ({
    userInput: state.userInput,
    fileContent: state.fileContent || 'No file content available'
  })
);

// Step 4: Update conversation
const updateConversation = step('updateConversation', (state: AgentState) => {
  return addState('observation', `Generated response: ${state.response}`)(state);
});

// Create the agent workflow
const agent = sequence([
  processInput,
  readFile,
  generateResponse,
  updateConversation
]);
```

## Step 2: Run Your Agent

```typescript
// Run the agent
async function runAgent() {
  const initialState: AgentState = {
    userInput: "read file and tell me what it contains",
    memory: []
  };

  const result = await agent(initialState);
  
  console.log('Response:', result.response);
  console.log('Memory entries:', result.memory.length);
}

runAgent();
```

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
    (error) => compose(
      updateState({ error: error.message }),
      addState('observation', `Error: ${error.message}`)
    )(state),
    (content) => compose(
      updateState({ fileContent: content }),
      addState('action', 'File read successfully')
    )(state)
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
import { compose, composeMany } from '@fx/core';

const updateUser = composeMany(
  updateState({ lastActive: Date.now() }),
  addState('action', 'User updated'),
  updateState({ version: '1.0.0' })
);
```

## Need Help?

- Check the [Composition Guide](../api/composition.md) for advanced patterns
- Look at [examples](../examples/) for real-world implementations
- Read the [API Reference](../api/core.md) for all available functions