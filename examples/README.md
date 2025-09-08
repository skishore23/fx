# Fx Examples

This directory contains examples demonstrating the Fx framework's capabilities.

## Examples

### Core Examples

#### Flow Agent Example (`flow-agent/`)
Demonstrates explicit workflow execution using the flow package. Shows how to create agents following the creating-an-agent.md pattern with functional composition, state management, and workflow validation.

**Key Features:**
- Functional composition using sequence, parallel, and while loops
- State management with lenses
- Workflow validation and dependency checking
- Event-driven execution monitoring

**Run:**
```bash
cd examples/flow-agent
npm install
npm start
```

### Navigator Examples

#### RAG Example (`navigator-rag/`)
Demonstrates emergent parallelism with the navigator runtime. Two independent steps (`fetch` and `warmCache`) automatically run in the same layer without explicit parallel configuration.

**Key Features:**
- Guard-driven step execution
- Emergent parallelism
- Independent step policies
- Plan inspection

**Run:**
```bash
cd examples/navigator-rag
npm install
npm start
```

#### Code Agent Example (`navigator-code-agent/`)
Demonstrates the ReAct pattern with iterative problem solving. The agent loops through `edit → test` until tests pass, then commits.

**Key Features:**
- ReAct pattern implementation
- Retry policies
- Goal-oriented execution
- Iterative problem solving

**Run:**
```bash
cd examples/navigator-code-agent
npm install
npm start
```

#### Navigator Coding Agent (`navigator-coding-agent/`)
Topological agent for autonomous code generation. Uses guard-driven execution with intelligent decision-making for code analysis, generation, testing, and optimization.

**Key Features:**
- Autonomous code generation decisions
- LLM-powered code analysis
- Intelligent tool selection
- Emergent development workflow

**Run:**
```bash
cd examples/navigator-coding-agent
npm install
npm start
```

#### Navigator Research Agent (`navigator-research-agent/`)
Topological agent for autonomous research tasks. Uses guard-driven execution with intelligent decision-making for web search, academic research, content analysis, and insight extraction.

**Key Features:**
- Autonomous research planning
- Multi-source information gathering
- LLM-powered content analysis
- Intelligent insight extraction

**Run:**
```bash
cd examples/navigator-research-agent
npm install
npm start
```

## Architecture

The examples showcase the two agent approaches:

- **@fx/flow**: **Workflow-Style Agents** - Explicit, deterministic workflows with clear step sequences
- **@fx/navigator**: **Topological Agents** - Autonomous, emergent execution with intelligent decision-making

Both agent types build on `@fx/core` and use core's prompts, tools, and patterns:
- **Core Integration**: Both use `createOpenAIProvider`, `llmTemplateStep`, `createToolRegistry`, `createValidatedTool`
- **Functional Composition**: Both use `sequence`, `parallel`, `while` loops from core
- **Patterns**: Both use `createReActPattern`, `createChainOfThoughtPattern` for intelligent behavior
- **State Management**: Both use `updateState`, `addState`, `get`, `set` for state operations

## Getting Started

1. Install dependencies in the root directory:
   ```bash
   npm install
   ```

2. Build all packages:
   ```bash
   npm run build
   ```

3. Run an example:
   ```bash
   cd examples/navigator-rag
   npm start
   ```

## Key Concepts Demonstrated

### Functional Composition
Steps are composed using core's functional operators:

```typescript
const workflow = sequence([
  processUserInput,
  generateResponse,
  logAction
]);
```

### Guard-Driven Execution
Steps run based on state conditions rather than explicit sequencing:

```typescript
const fetch = step('fetch', when(ctx => !!ctx.query), async (ctx) => {
  // Only runs when ctx.query exists
});
```

### Emergent Parallelism
Independent steps automatically run in parallel:

```typescript
agent.policy.independent(['warmCache'], ['fetch']);
// Both steps run in the same layer when their guards are true
```

### ReAct Pattern
Iterative reasoning and acting:

```typescript
const agent = createAgent()
  .react({
    decide: async (ctx) => ctx.testsPassing ? 'commit' : 'test',
    goal: (ctx) => ctx.committed === true
  });
```

### Plan Inspection
View execution plans before running:

```typescript
const plan = await agent.plan(initialState);
console.log('Layers:', plan.layers);
console.log('Blocked:', plan.blocked);
```