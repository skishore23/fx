# @fx/core

TypeScript framework for building AI agents.

## Installation

```bash
npm install @fx/core
```

## Quick Start

```typescript
import { step, sequence, updateState, Agent } from '@fx/core';

const workflow = sequence([
  step('process', (state) => updateState({ processed: true })(state)),
  step('save', (state) => updateState({ saved: true })(state))
]);

const agent = new Agent(workflow);
const result = await agent.start({ data: 'example' });
```

## Documentation

See the [main documentation](../../docs/) for complete guides and API reference.