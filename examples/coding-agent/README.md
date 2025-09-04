# Coding Agent

A coding agent built with the Fx Framework that can read, write, and analyze files.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Add your OpenAI API key to .env
```

3. Run the agent:
```bash
npm start
```

4. Run tests:
```bash
npm test
```

## What it does

- Reads and writes files
- Executes shell commands
- Searches codebases
- Uses OpenAI for reasoning

## Files

- `agent-fx.ts` - Main agent implementation
- `test-agent-fx.ts` - Simple test
- `complex-test-suite.ts` - Full test suite