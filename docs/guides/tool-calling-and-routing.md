# Tool Calling and Routing

The Fx Framework provides a simple tool calling system with patterns and state management.

## Table of Contents

1. [Overview](#overview)
2. [Basic Tool Calling](#basic-tool-calling)
3. [Patterns](#patterns)
4. [State Management](#state-management)
5. [Complete Examples](#complete-examples)
6. [Best Practices](#best-practices)

## Overview

The Fx Framework uses a simple approach for tool calling:

1. **Pattern Matching** - Use patterns to determine which tools to use
2. **State Management** - Update state with tool results
3. **Error Handling** - Handle tool failures gracefully
4. **Composition** - Build complex workflows from simple steps

## Basic Tool Calling

### Simple Tool Implementation

```typescript
import { step, sequence, updateState, addState } from '@fx/core';

// Define your tool as a step
const readFileTool = step('readFile', (state) => {
  try {
    // Your file reading logic here
    const content = 'File content here';
    return updateState({ 
      fileContent: content,
      lastTool: 'readFile'
    })(state);
  } catch (error) {
    return updateState({ 
      error: error.message,
      lastTool: 'readFile'
    })(state);
  }
});

const writeFileTool = step('writeFile', (state) => {
  try {
    // Your file writing logic here
    console.log('Writing file...');
    return updateState({ 
      lastTool: 'writeFile',
      success: true
    })(state);
  } catch (error) {
    return updateState({ 
      error: error.message,
      lastTool: 'writeFile'
    })(state);
  }
});
```

### Tool Selection with Patterns

```typescript
import { createPattern } from '@fx/core';

// Create patterns for tool selection
const fileReadPattern = createPattern(
  (state) => state.userInput?.includes('read') && state.userInput?.includes('file'),
  (state) => updateState({ selectedTool: 'readFile' })(state)
);

const fileWritePattern = createPattern(
  (state) => state.userInput?.includes('write') && state.userInput?.includes('file'),
  (state) => updateState({ selectedTool: 'writeFile' })(state)
);

// Tool selection workflow
const selectTool = step('selectTool', (state) => {
  // Try patterns in order
  const patterns = [fileReadPattern, fileWritePattern];
  
  for (const pattern of patterns) {
    const result = pattern(state);
    if (result.selectedTool) {
      return result;
    }
  }
  
  // Default fallback
  return updateState({ selectedTool: 'readFile' })(state);
});
```

### Tool Execution

```typescript
const executeTool = step('executeTool', (state) => {
  const tool = state.selectedTool;
  
  switch (tool) {
    case 'readFile':
      return readFileTool(state);
    case 'writeFile':
      return writeFileTool(state);
    default:
      return updateState({ error: 'Unknown tool' })(state);
  }
});
```

## Patterns

### Using Built-in Patterns

```typescript
import { createReActPattern, createChainOfThoughtPattern } from '@fx/core';

// ReAct pattern for reasoning and acting
const reactWorkflow = sequence([
  step('reason', createReActPattern('reasoning-agent')),
  step('act', executeTool)
]);

// Chain of thought pattern for step-by-step reasoning
const cotWorkflow = sequence([
  step('think', createChainOfThoughtPattern('thinking-agent')),
  step('act', executeTool)
]);
```

### Custom Patterns

```typescript
import { createPattern } from '@fx/core';

// Create custom patterns
const urgentPattern = createPattern(
  (state) => state.userInput?.includes('urgent'),
  (state) => updateState({ priority: 'high' })(state)
);

const adminPattern = createPattern(
  (state) => state.userInput?.includes('admin'),
  (state) => updateState({ requiresAuth: true })(state)
);
```

## State Management

### Basic State Updates

```typescript
// Update multiple fields
const updateUser = step('updateUser', (state) => {
  return updateState({
    lastActive: Date.now(),
    version: '1.0.0'
  })(state);
});

// Add to memory
const logAction = step('logAction', (state) => {
  return addState('action', 'User updated')(state);
});
```

### Conditional State Updates

```typescript
import { when } from '@fx/core';

const conditionalUpdate = when(
  (state) => state.userInput?.includes('admin'),
  step('adminUpdate', (state) => updateState({ role: 'admin' })(state)),
  step('userUpdate', (state) => updateState({ role: 'user' })(state))
);
```

## Complete Examples

### Simple File Agent

```typescript
import { 
  step, sequence, createPlan, createAgent,
  updateState, addState, createPattern
} from '@fx/core';

interface FileAgentState extends BaseContext {
  userInput: string;
  selectedTool?: string;
  fileContent?: string;
  error?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

// Tools
const readFileTool = step('readFile', (state: FileAgentState) => {
  try {
    const content = `Content of file from: ${state.userInput}`;
    return updateState({ 
      fileContent: content,
      selectedTool: 'readFile'
    })(state);
  } catch (error) {
    return updateState({ 
      error: error.message,
      selectedTool: 'readFile'
    })(state);
  }
});

const writeFileTool = step('writeFile', (state: FileAgentState) => {
  try {
    console.log('Writing file...');
    return updateState({ 
      selectedTool: 'writeFile',
      success: true
    })(state);
  } catch (error) {
    return updateState({ 
      error: error.message,
      selectedTool: 'writeFile'
    })(state);
  }
});

// Patterns
const fileReadPattern = createPattern(
  (state) => state.userInput?.includes('read'),
  (state) => updateState({ selectedTool: 'readFile' })(state)
);

const fileWritePattern = createPattern(
  (state) => state.userInput?.includes('write'),
  (state) => updateState({ selectedTool: 'writeFile' })(state)
);

// Workflow
const fileAgentWorkflow = sequence([
  step('selectTool', (state: FileAgentState) => {
    // Try patterns
    const patterns = [fileReadPattern, fileWritePattern];
    
    for (const pattern of patterns) {
      const result = pattern(state);
      if (result.selectedTool) {
        return result;
      }
    }
    
    // Default fallback
    return updateState({ selectedTool: 'readFile' })(state);
  }),
  
  step('executeTool', (state: FileAgentState) => {
    const tool = state.selectedTool;
    
    switch (tool) {
      case 'readFile':
        return readFileTool(state);
      case 'writeFile':
        return writeFileTool(state);
      default:
        return updateState({ error: 'Unknown tool' })(state);
    }
  }),
  
  step('logAction', (state: FileAgentState) => {
    return addState('action', `Executed: ${state.selectedTool}`)(state);
  })
]);

// Agent
const plan = createPlan('file-agent', [
  step('init', (state) => {
    console.log('📁 File Agent started!');
    return state;
  }),
  fileAgentWorkflow
]);

export const fileAgent = createAgent('file-agent', plan);
```

### Advanced Agent with Patterns

```typescript
import { 
  step, sequence, parallel, when, createPlan, createAgent,
  updateState, addState, createReActPattern, createChainOfThoughtPattern
} from '@fx/core';

interface AdvancedAgentState extends BaseContext {
  userInput: string;
  analysis?: string;
  action?: string;
  result?: string;
  memory: Array<{ type: string; content: string; timestamp: string }>;
}

const advancedAgentWorkflow = sequence([
  step('analyze', (state: AdvancedAgentState) => {
    const analysis = `Analyzing: ${state.userInput}`;
    return updateState({ analysis })(state);
  }),
  
  // Use ReAct pattern for reasoning
  step('reason', createReActPattern('reasoning-agent')),
  
  // Use Chain of Thought for complex thinking
  step('think', createChainOfThoughtPattern('thinking-agent')),
  
  // Parallel execution
  parallel([
    step('process1', (state) => updateState({ process1: 'done' })(state)),
    step('process2', (state) => updateState({ process2: 'done' })(state))
  ]),
  
  // Conditional logic
  when(
    (state) => state.userInput?.includes('urgent'),
    step('urgentAction', (state) => updateState({ priority: 'high' })(state)),
    step('normalAction', (state) => updateState({ priority: 'normal' })(state))
  ),
  
  step('generateResult', (state: AdvancedAgentState) => {
    const result = `Result: ${state.analysis}`;
    return updateState({ result })(state);
  }),
  
  step('logAction', (state: AdvancedAgentState) => {
    return addState('action', `Processed: ${state.userInput}`)(state);
  })
]);

const plan = createPlan('advanced-agent', [
  step('init', (state) => {
    console.log('🚀 Advanced Agent started!');
    return state;
  }),
  advancedAgentWorkflow
]);

export const advancedAgent = createAgent('advanced-agent', plan);
```

## Best Practices

### 1. Tool Design
- Make tools focused and single-purpose
- Handle errors gracefully
- Return meaningful data

### 2. Pattern Matching
- Start with simple patterns
- Use fallbacks for edge cases
- Test with various inputs

### 3. State Management
- Keep state immutable
- Use lenses for transformations
- Log important actions

### 4. Error Handling
- Use try/catch blocks appropriately
- Provide meaningful error messages
- Don't let tool failures crash the agent

### 5. Composition
- Build workflows from small steps
- Use `sequence` for linear workflows
- Use `parallel` for concurrent operations
- Use `when` for conditional logic

### 6. Testing
- Test individual tools in isolation
- Test pattern matching with various inputs
- Test complete workflows end-to-end

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
  createPlan, createAgent
} from '@fx/core';
```

### Common Patterns

#### Tool Selection
```typescript
const selectTool = step('selectTool', (state) => {
  if (state.userInput?.includes('read')) {
    return updateState({ selectedTool: 'readFile' })(state);
  }
  if (state.userInput?.includes('write')) {
    return updateState({ selectedTool: 'writeFile' })(state);
  }
  return updateState({ selectedTool: 'default' })(state);
});
```

#### Tool Execution
```typescript
const executeTool = step('executeTool', (state) => {
  switch (state.selectedTool) {
    case 'readFile':
      return readFileTool(state);
    case 'writeFile':
      return writeFileTool(state);
    default:
      return updateState({ error: 'Unknown tool' })(state);
  }
});
```

#### Error Handling
```typescript
const safeTool = step('safeTool', (state) => {
  try {
    // Your tool logic here
    return updateState({ result: 'success' })(state);
  } catch (error) {
    return updateState({ error: error.message })(state);
  }
});
```

This guide provides everything you need to implement tool calling and routing with the Fx Framework. Start simple and gradually add complexity as needed.