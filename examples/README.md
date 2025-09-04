# Fx Framework Examples

This directory contains sophisticated examples demonstrating how to use the Fx Framework for building functional, composable AI agents and workflows.

## 📁 Directory Structure

```
examples/
├── coding-agent/     # Complete coding agent with tool system
├── research-agent/   # Deep research agent with web scraping
└── README.md         # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ (Firecrawl requires Node 22+, but we handle compatibility)
- TypeScript 5.0+
- @fx/core package installed
- OpenAI API key
- Firecrawl API key (for research agent)

### Running Examples

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run examples:**
   ```bash
   # Run the coding agent
   cd coding-agent
   npm start
   
   # Run the research agent
   cd research-agent
   npm start "Your Research Topic"
   ```

## 🤖 Coding Agent

### [Coding Agent](./coding-agent/)
- **Purpose**: Interactive coding assistant with tool system
- **Features**: 
  - File operations (read, write, list)
  - Bash command execution
  - Code search and analysis
  - LLM integration with OpenAI
  - Interactive human-in-the-loop workflow
- **Concepts**: Tool system, LLM integration, error handling, Kleisli composition
- **Difficulty**: Advanced

**Key Features:**
- ✅ **Tool System**: Comprehensive tool registry with validation
- ✅ **LLM Integration**: OpenAI GPT-4 integration
- ✅ **Interactive Workflow**: Human-in-the-loop agent
- ✅ **Error Handling**: Functional error handling with Either monad
- ✅ **Ledger System**: Complete audit trail
- ✅ **Kleisli Composition**: Proper functional composition

## 🔬 Research Agent

### [Research Agent](./research-agent/)
- **Purpose**: Sophisticated deep research agent with web scraping
- **Features**:
  - Multi-phase research process
  - Web scraping with Firecrawl
  - AI-powered content analysis
  - Comprehensive report generation
  - Citation management
- **Concepts**: Web scraping, content analysis, report generation, multi-phase workflows
- **Difficulty**: Advanced

**Key Features:**
- ✅ **Web Scraping**: Firecrawl integration for content extraction
- ✅ **Multi-Phase Research**: Planning → Gathering → Analysis → Synthesis
- ✅ **AI Analysis**: OpenAI-powered content analysis
- ✅ **Report Generation**: Comprehensive research reports
- ✅ **Citation Management**: Automatic citation generation
- ✅ **Configurable Depth**: Shallow, medium, or deep research modes

## 🎯 Architecture Highlights

Both agents demonstrate:

### Functional Programming
- Pure functions and immutability
- Function composition with Kleisli arrows
- Either monad for error handling
- Category theory principles

### Fx Framework Features
- Step creation and execution
- Sequential and parallel composition
- State management with lenses
- Tool registration and validation
- Ledger system for audit trails
- LLM integration

### Best Practices
- Fail-fast error handling
- Type safety with TypeScript
- Comprehensive error handling
- Proper state management
- Functional composition patterns

## 📚 Learning Path

### For Beginners
1. Start with the [Coding Agent](./coding-agent/) to understand basic agent patterns
2. Explore the tool system and LLM integration
3. Understand error handling with Either monad

### For Advanced Users
1. Study the [Research Agent](./research-agent/) for complex multi-phase workflows
2. Examine web scraping and content analysis patterns
3. Learn report generation and citation management

## 🔧 Development

### Running Tests
```bash
# Test coding agent
cd coding-agent
npm test

# Test research agent
cd research-agent
npm test
```

### Building
```bash
# Build coding agent
cd coding-agent
npm run build

# Build research agent
cd research-agent
npm run build
```

## 🤝 Contributing

We welcome contributions! Here's how to add a new example:

1. **Create a new directory** for your example
2. **Follow the established patterns** from existing agents
3. **Include comprehensive documentation**
4. **Add tests** for your example
5. **Update this README** with your example

### Example Template
```typescript
/**
 * Your Agent Name
 * 
 * Brief description of what this agent does.
 */

import { 
  step, sequence, parallel, when,
  createAgent, createPlan,
  // ... other imports
} from '@fx/core';

// Your agent implementation here

export const yourAgent = createAgent('your-agent', plan);

export async function runYourAgent(options: YourOptions) {
  // Implementation
}
```

## 🔗 Related Resources

- [Getting Started Guide](../docs/getting-started/)
- [API Reference](../docs/api/core.md)
- [Core Concepts](../docs/getting-started/concepts.md)
- [Composition Guide](../docs/api/composition.md)

## 💡 Tips for Learning

1. **Study the Architecture**: Understand how both agents use Fx Framework patterns
2. **Experiment**: Modify examples to see how changes affect behavior
3. **Read the Code**: Understand how each component works
4. **Practice**: Try building your own agents
5. **Ask Questions**: Use GitHub issues for help

## 🎉 What Makes These Examples Special

These examples showcase **production-ready AI agents** that demonstrate:

- **Mathematical Correctness**: Proper category theory and functional programming
- **Real-World Applications**: Actual tools and integrations
- **Scalable Architecture**: Clean, composable, and maintainable code
- **Type Safety**: Full TypeScript support with strict typing
- **Error Handling**: Robust error handling with functional patterns
- **Audit Trails**: Complete logging and event sourcing

Happy coding with Fx! 🚀