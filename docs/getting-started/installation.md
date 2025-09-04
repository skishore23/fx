# Installation & Setup

Get Fx running in your project in under 5 minutes.

## Prerequisites

- **Node.js**: Version 16 or higher
- **TypeScript**: Version 5.0 or higher (recommended)
- **Package Manager**: npm, yarn, or pnpm

## Installation

### Install the Core Package

```bash
npm install @fx/core
```

### TypeScript Setup (Recommended)

If you're using TypeScript, install the types:

```bash
npm install -D typescript @types/node
```

Create a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Verify Installation

Create a simple test file to verify everything works:

```typescript
// test.ts
import { step, sequence, updateState } from '@fx/core';

const hello = step('hello', (state) => 
  updateState({ message: 'Hello, Fx!' })(state)
);

const workflow = sequence([hello]);

workflow({ input: 'test' }).then(result => {
  console.log(result.message); // "Hello, Fx!"
});
```

Run it:

```bash
npx ts-node test.ts
```

You should see: `Hello, Fx!`

## Next Steps

- [Quick Start Guide](./quick-start.md) - Build your first application
- [Core Concepts](./concepts.md) - Understand the fundamentals
- [Basic Examples](../examples/basic/) - See practical examples

## Troubleshooting

### Common Issues

**TypeScript Errors**: Make sure you have TypeScript 5.0+ and proper type definitions.

**Import Errors**: Ensure you're using the correct import syntax:
```typescript
import { step, sequence, updateState } from '@fx/core';
```

**Build Issues**: Check that your `tsconfig.json` is properly configured.

### Getting Help

- Check the [API Reference](../api/core.md)
- Browse [Examples](../examples/)
- Open an issue on [GitHub](https://github.com/fx-framework/fx/issues)
