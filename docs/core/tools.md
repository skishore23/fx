# Tool Registration and Management

The f(x) framework provides a robust system for registering and managing tools that agents can use. Tools are pure functions that transform state and are validated using Zod schemas.

## Tool Registration

### `Fx.registerTool`

Registers a new tool with type-safe validation.

```typescript
Fx.registerTool<State, Schema>(
  name: string,
  schema: Schema,
  factory: (...args: z.infer<Schema>) => Step<State>
): void
```

#### Parameters
- `name`: Unique identifier for the tool
- `schema`: Zod schema for validating tool arguments
- `factory`: Function that creates a state transformer

#### Example

```typescript
// Register a web search tool
Fx.registerTool<ResearchState, z.ZodTuple<[z.ZodString]>>(
  "web_search",
  z.tuple([z.string()]),
  (query: string) => async (state) => {
    // Implementation
    return updatedState;
  }
);
```

### `Fx.callTool`

Calls a registered tool with validated arguments.

```typescript
Fx.callTool<State>(
  name: string,
  args: any[]
): Step<State>
```

#### Parameters
- `name`: Name of the registered tool
- `args`: Arguments to pass to the tool

#### Example

```typescript
const updatedState = await Fx.callTool<ResearchState>(
  "web_search", 
  [searchQuery]
)(currentState, log);
```

## Tool Patterns

### Concurrency Control

Control concurrent tool execution:

```typescript
const concurrentTool = Fx.concurrency(myTool, maxConcurrent);
```

### Rate Limiting

Add rate limiting to tools:

```typescript
const rateLimitedTool = Fx.rateLimit(myTool, {
  maxCalls: 10,
  perSeconds: 60
});
```

### Caching

Cache tool results:

```typescript
const cachedTool = Fx.cache(myTool, {
  ttl: 3600,  // Cache for 1 hour
  maxSize: 1000
});
```

## Best Practices

1. **Validation**: Always use Zod schemas to validate tool inputs
```typescript
const schema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(100)
});
```

2. **Error Handling**: Implement proper error handling in tools
```typescript
try {
  // Tool implementation
} catch (error) {
  console.error(`Tool error: ${error}`);
  return state; // Return unchanged state on error
}
```

3. **State Immutability**: Never modify state directly
```typescript
// Good
return {
  ...state,
  results: [...state.results, newResult]
};

// Bad
state.results.push(newResult);
return state;
```

4. **Logging**: Add appropriate logging
```typescript
console.log(`Executing tool: ${name} with args:`, args);
```

## MCP Server Integration

The framework supports integration with MCP (Model Control Protocol) servers:

### Tool Resolution

```typescript
const resolveLibrary = Fx.registerTool<State>(
  "mcp_context7_resolve-library-id",
  z.object({
    libraryName: z.string()
  }),
  async (params) => {
    // Implementation
  }
);
```

### Documentation Retrieval

```typescript
const getLibraryDocs = Fx.registerTool<State>(
  "mcp_context7_get-library-docs",
  z.object({
    context7CompatibleLibraryID: z.string(),
    tokens: z.number().optional(),
    topic: z.string().optional()
  }),
  async (params) => {
    // Implementation
  }
);
```

## Tool Categories

Organize tools by category:

### System Tools
- File operations
- Process management
- Environment variables

### API Tools
- External API calls
- Authentication
- Rate limiting

### State Management Tools
- State updates
- State validation
- State persistence

### Utility Tools
- Data transformation
- Validation
- Formatting

## Tool Composition

Compose multiple tools into a single operation:

```typescript
const composedTool = Fx.sequence(
  toolA,
  toolB,
  toolC
);
```

## Tool Testing

Test tools in isolation:

```typescript
describe('web_search tool', () => {
  it('should update state with search results', async () => {
    const initialState = { /* ... */ };
    const tool = webSearchTool('query');
    const newState = await tool(initialState, []);
    expect(newState.results).toBeDefined();
  });
});
``` 