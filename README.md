# f(x)

**Build reliable AI agents.**

f(x) is a functional agent framework where every step is a pure function `Context → Context`. This makes your agents predictable, testable, and debuggable.

## Core insight

**Context = a Value, Steps = Transformations**

f(x) treats context as an explicit state value where every step is a pure function `Context → Context`. This makes context **testable and replayable** - you can diff context before/after each step, assert contracts, and audit the exact payload the LLM saw at any moment.

f(x) gives you the tools to engineer context effectively.

## The problem

Most AI agent failures stem from poor context. f(x) makes context **explicit, testable, and auditable**.

## Quick start

```bash
npm install @fx/core
```

```typescript
import { step, sequence, Agent } from '@fx/core';

// Every step is Context → Context
const analyzeStep = step('analyze', (context) => ({
  ...context,
  analysis: `Analyzing: ${context.userInput}`,
  timestamp: Date.now()
}));

const generateStep = step('generate', (context) => ({
  ...context,
  response: `Based on: ${context.analysis}`,
  confidence: 0.95
}));

// Create workflow and agent
const workflow = sequence([analyzeStep, generateStep]);
const agent = new Agent(workflow);

// Run with explicit context
const result = await agent.start({ 
  userInput: 'Hello world' 
});

console.log(result.response); // "Based on: Analyzing: Hello world"
console.log(result.confidence); // 0.95
```

**What happened:**
- Each step received the complete context
- You can see exactly what data each step processed
- Context is immutable - no hidden state changes
- You can test each step independently

## What f(x) provides

f(x) is a functional agent framework with these core capabilities:

### 1. **Pure function composition**
Every step is a pure function `Context → Context` that can be composed.

```typescript
// Sequential composition
const workflow = sequence([
  step('analyze', (context) => ({ ...context, analysis: 'done' })),
  step('generate', (context) => ({ ...context, response: 'response' }))
]);

// Parallel composition
const parallelWork = parallel([
  step('readFile', readFile),
  step('searchCode', searchCode)
]);

// Conditional composition
const conditional = when(
  (context) => context.needsReview,
  reviewStep,
  skipStep
);
```

### 2. **Functional error handling**
Use the `Either` monad for predictable error handling.

```typescript
const safeOperation = step('safeOperation', (context) => {
  const result = Either.right('success');
  return Either.fold(
    result,
    (error) => ({ ...context, error: error.message }),
    (value) => ({ ...context, result: value })
  );
});
```

### 3. **State management**
Immutable state transformations with lenses.

```typescript
import { updateState, logAction } from '@fx/core';

const updateUser = step('updateUser', (context) => 
  updateState({ lastActive: Date.now() })(context)
);

const addMemory = step('addMemory', (context) =>
  logAction('User updated')(context)
);
```

### 4. **Built-in patterns**
Common AI agent patterns ready to use.

```typescript
import { createReActPattern, createChainOfThoughtPattern } from '@fx/core';

// ReAct pattern for reasoning and acting
const reactPattern = createReActPattern(llmProvider, ['tool1', 'tool2']);

// Chain of thought pattern
const cotPattern = createChainOfThoughtPattern(llmProvider);
```

### 5. **Observability & logging**
Track what your agent is doing.

```typescript
import { enableLogging, logEvent } from '@fx/core';

// Enable logging
enableLogging();

// Log custom events
const logStep = step('logStep', (context) => {
  logEvent('user_action', { userId: context.userId });
  return context;
});
```

## Why f(x) Works

### 1. **Test what the LLM actually sees**
Every step receives explicit context. Test the exact data your AI processes.

```typescript
// Test individual steps with explicit context
test('analyze step processes context correctly', () => {
  const inputContext = { 
    userInput: 'Fix my React bug',
    filePath: '/src/App.js',
    previousErrors: ['TypeError: Cannot read property']
  };
  
  const result = analyzeStep(inputContext);
  
  // Assert the exact context the LLM will see
  expect(result.analysis).toContain('React bug');
  expect(result.filePath).toBe('/src/App.js');
  expect(result.previousErrors).toHaveLength(1);
});
```

### 2. **Debug with complete visibility**
See exactly what context caused a failure. No more guessing.

```typescript
// Every step logs its input and output context
const debugAgent = createAgent('debug-agent', plan, {
  logging: true,  // Logs: "Step 'analyze' received: {...}, produced: {...}"
  tracing: true   // Full context diff between steps
});

// When it fails, you see the exact context
// "Step 'generate' failed with context: { analysis: '...', userInput: '...' }"
```

### 3. **Audit AI decisions**
Track what data influenced each decision. Perfect for compliance and debugging.

```typescript
// Every context change is tracked
const auditTrail = agent.getAuditTrail();
console.log(auditTrail);
// [
//   { step: 'analyze', input: {...}, output: {...}, duration: 150ms },
//   { step: 'generate', input: {...}, output: {...}, duration: 2000ms }
// ]
```

### 4. **Replay any scenario**
Reproduce the exact context that led to any outcome.

```typescript
// Save context at any point
const checkpoint = agent.saveContext();

// Later, replay from that exact state
const result = agent.replayFrom(checkpoint);
// Identical execution, guaranteed
```

## Real-world example: Code review agent

Here's a practical agent that demonstrates explicit context:

```typescript
import { step, sequence, Agent } from '@fx/core';

// Each step is Context → Context
const readCodeStep = step('readCode', async (context) => {
  const fileContent = await fs.readFile(context.filePath, 'utf8');
  return {
    ...context,
    fileContent,
    fileSize: fileContent.length,
    readAt: Date.now()
  };
});

const analyzeCodeStep = step('analyzeCode', (context) => {
  const issues = findIssues(context.fileContent);
  return {
    ...context,
    issues,
    severity: Math.max(...issues.map(i => i.severity)),
    analysisComplete: true
  };
});

const generateReviewStep = step('generateReview', (context) => {
  const review = generateReviewText(context.issues, context.filePath);
  return {
    ...context,
    review,
    reviewGenerated: true,
    confidence: calculateConfidence(context.issues)
  };
});

// Create workflow and agent
const workflow = sequence([
  readCodeStep,
  analyzeCodeStep,
  generateReviewStep
]);
const codeReviewAgent = new Agent(workflow);

// Run with explicit context
const result = await codeReviewAgent.start({
  filePath: '/src/components/Button.tsx',
  reviewType: 'security',
  previousReviews: []
});

console.log(result.review);        // "Found 3 security issues..."
console.log(result.confidence);    // 0.87
console.log(result.issues.length); // 3
```

**What makes this powerful:**
- **Testable**: Test each step with exact context
- **Debuggable**: See exactly what context caused each decision  
- **Auditable**: Track what data influenced the review
- **Replayable**: Reproduce the exact same review

## Documentation

- **[Installation & Setup](./docs/getting-started/installation.md)** - Get up and running in 5 minutes
- **[Quick Start Guide](./docs/getting-started/quick-start.md)** - Build your first agent
- **[Context as a Value](./docs/getting-started/concepts.md)** - Understanding Context as a Value
- **[Testing AI Agents](./docs/guides/testing-agents.md)** - Test individual steps and scenarios
- **[Debugging & Observability](./docs/guides/debugging.md)** - Debug with complete context visibility
- **[API Reference](./docs/api/core.md)** - Complete function reference

## Examples

- **[Coding Agent](./examples/coding-agent/)** - Full-featured coding assistant
- **[Research Agent](./examples/research-agent/)** - Advanced research and analysis
- **[Navigator Coding Agent](./examples/navigator-coding-agent/)** - Topological coding agent
- **[Navigator Research Agent](./examples/navigator-research-agent/)** - Topological research agent


## With f(x) you get

- **Explicit context** - See exactly what your AI processes
- **Testable steps** - Test individual transformations  
- **Debuggable failures** - Know exactly what went wrong
- **Auditable decisions** - Track what influenced each choice
- **Replayable scenarios** - Reproduce any execution
- **Functional composition** - Build agents with pure functions
- **Error handling** - Use Either monad for predictable failures

f(x) is a functional framework that makes context explicit and controllable, giving you the tools to build reliable AI agents.

## Three Frameworks, One Philosophy

f(x) provides three specialized frameworks, all built on the same functional principles:

### **@fx/core** - Foundation
The core functional composition engine with pure functions, Either monads, and essential patterns.

### **@fx/navigator** - Topological Agents  
Guard-driven execution where steps run based on state conditions. Perfect for autonomous, emergent behavior.

### **@fx/flow** - Explicit Workflows
Sequential workflow execution with explicit step ordering. Ideal for predictable, linear processes.

## Installation

```bash
# Core framework
npm install @fx/core

# Navigator framework (topological agents)
npm install @fx/navigator

# Flow framework (explicit workflows)
npm install @fx/flow

# With OpenAI integration
npm install @fx/core openai
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Development setup

```bash
git clone https://github.com/skishore23/fx.git
cd fx
npm install
npm run build
npm test
```

## Support

- 📖 [Documentation](./docs/)