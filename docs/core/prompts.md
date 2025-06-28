# Prompt Management

The f(x) framework provides a sophisticated system for managing LLM prompts with built-in logging, caching, and error handling.

## Core Concepts

### Prompt Step

A prompt step is a pure function that:
1. Builds a prompt from state
2. Calls an LLM
3. Updates state with the response

## Basic Usage

### `Fx.prompt`

Creates a prompt step with logging and error handling.

```typescript
Fx.prompt<State>(
  name: string,
  buildPrompt: (state: Readonly<State>) => string,
  llm: (prompt: string) => Promise<string>
): Step<State>
```

#### Example

```typescript
const generateQueries = Fx.prompt<ResearchState>(
  "generateQueries",
  (state) => `Generate search queries for: ${state.userQuery}`,
  async (prompt) => {
    const response = await openai.createCompletion({
      model: "gpt-4",
      prompt
    });
    return response.choices[0].text;
  }
);
```

### `Fx.promptAndExtract`

Combines prompt execution with response extraction.

```typescript
const [newState, response] = await Fx.promptAndExtract<State>(
  "stepName",
  buildPrompt,
  llm
)(state, log);
```

## Structured Output

### JSON Schema Validation

```typescript
// Define output schema
const schema = z.object({
  queries: z.array(z.object({
    query: z.string(),
    reasoning: z.string(),
    priority: z.number()
  }))
});

// Use with structured LLM call
const response = await llm(prompt, schema);
```

### Function Calling

```typescript
const functionSchema = {
  name: "analyze_text",
  parameters: {
    sentiment: z.string(),
    keywords: z.array(z.string()),
    summary: z.string()
  }
};

const result = await llm(prompt, functionSchema);
```

## Prompt Templates

### Template Management

```typescript
const templates = {
  research: (query: string) => `
Research the following topic: ${query}

Provide:
1. Key findings
2. Related topics
3. Open questions
  `,
  
  analyze: (text: string) => `
Analyze this text:
${text}

Extract:
- Main points
- Supporting evidence
- Conclusions
  `
};
```

### Template Composition

```typescript
const composedPrompt = (state: State) => `
${templates.research(state.query)}

${templates.analyze(state.context)}
`;
```

## System Messages

### Setting Context

```typescript
const systemMessage = {
  role: "system",
  content: "You are a research assistant..."
};

const userMessage = {
  role: "user",
  content: buildPrompt(state)
};
```

### Conversation History

```typescript
const messages = [
  systemMessage,
  ...state.conversationHistory,
  userMessage
];
```

## Error Handling

### Retry Logic

```typescript
const resilientPrompt = Fx.retry(
  generateQueries,
  {
    maxAttempts: 3,
    backoff: 'exponential'
  }
);
```

### Fallback Handling

```typescript
try {
  const result = await llm(prompt);
  return parseResult(result);
} catch (error) {
  console.error("LLM error:", error);
  return generateFallback(state);
}
```

## Performance Optimization

### Caching

```typescript
const cachedPrompt = Fx.cache(
  generateQueries,
  {
    ttl: 3600,
    maxSize: 1000
  }
);
```

### Batching

```typescript
const batchedPrompts = Fx.batch(
  generateQueries,
  {
    maxBatchSize: 5,
    maxWaitMs: 100
  }
);
```

## Best Practices

1. **Clear Instructions**
```typescript
const prompt = `
TASK: ${task}

CONTEXT:
${context}

INSTRUCTIONS:
1. ${instruction1}
2. ${instruction2}
3. ${instruction3}

RESPONSE FORMAT:
${format}
`;
```

2. **Validation**
```typescript
const validateResponse = (response: any) => {
  const result = schema.safeParse(response);
  if (!result.success) {
    throw new Error(`Invalid response: ${result.error}`);
  }
  return result.data;
};
```

3. **Temperature Control**
```typescript
const preciseResponse = await llm(prompt, {
  temperature: 0.2  // Lower for more deterministic output
});

const creativeResponse = await llm(prompt, {
  temperature: 0.8  // Higher for more creative output
});
```

4. **Context Management**
```typescript
const buildContext = (state: State) => {
  const relevantHistory = state.history.slice(-5);
  return `
Previous Context:
${relevantHistory.join('\n')}

Current State:
${JSON.stringify(state.current)}
  `;
};
```

## Testing

### Unit Testing

```typescript
describe('generateQueries', () => {
  it('should generate valid queries', async () => {
    const state = { userQuery: "test" };
    const result = await generateQueries(state, []);
    expect(result.queries).toBeDefined();
    expect(result.queries.length).toBeGreaterThan(0);
  });
});
```

### Mock LLM

```typescript
const mockLLM = async (prompt: string) => {
  return {
    queries: [
      { query: "test query", priority: 1 }
    ]
  };
};
``` 