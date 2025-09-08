# @fx/core

TypeScript framework for building AI agents.

## Installation

```bash
npm install @fx/core
```

## Quick Start

```typescript
import { step, sequence, updateState } from '@fx/core';

const workflow = sequence([
  step('process', (state) => updateState({ processed: true })(state)),
  step('save', (state) => updateState({ saved: true })(state))
]);

const result = await workflow({ data: 'example' });
```

## Documentation

See the [main documentation](../../docs/) for complete guides and API reference.