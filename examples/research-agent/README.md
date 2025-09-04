# Research Agent

A research agent that can scrape websites, analyze content, and generate reports.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Add your OpenAI and Firecrawl API keys to .env
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

- Scrapes websites with Firecrawl
- Analyzes content with AI
- Generates research reports
- Uses Chain of Thought reasoning

## Files

- `research-agent.ts` - Main agent implementation
- `test-research-agent.ts` - Test file
- `dynamic-generic-test.ts` - Dynamic test