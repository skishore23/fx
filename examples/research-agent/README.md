# Research Agent with Chain of Thought

A sophisticated research agent built with the Fx Framework that demonstrates advanced AI-powered research capabilities using Chain of Thought reasoning patterns.

## Features

- **🧠 Chain of Thought Reasoning**: Uses fx-core's `createChainOfThoughtPattern` for sophisticated reasoning
- **🚫 Zero Hardcoding**: Everything is AI-generated and dynamic - no hardcoded content
- **🔍 AI-Powered Research**: Uses OpenAI GPT-4 for intelligent content analysis
- **🌐 Web Scraping**: Integrates with Firecrawl for comprehensive web content extraction
- **🔗 Dynamic URL Discovery**: AI-powered source identification for any topic
- **🔍 Google Search Integration**: AI-powered search result generation
- **📊 Comprehensive Reports**: Generates detailed research reports for any subject
- **⚡ Functional Composition**: Built using fx-core's composition patterns
- **🎯 Generic Workflow**: Can research any topic without modification

## Key Improvements

- ✅ **Removed all hardcoded content** - everything is AI-generated
- ✅ **Integrated Chain of Thought** from `fx-core/patterns.ts`
- ✅ **Added Google search tool** for dynamic research
- ✅ **Removed example.com fallbacks** - fails fast if no URL provided
- ✅ **Cleaned up unnecessary files** - streamlined codebase

## Prerequisites

1. **Firecrawl API Key**: Get your API key from [Firecrawl](https://firecrawl.dev)
2. **OpenAI API Key**: Get your API key from [OpenAI](https://openai.com)
3. **Node.js**: Version 20+

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file in the project root with:
   ```env
   FIRECRAWL_KEY=your_firecrawl_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Usage

### Basic Usage

```typescript
import { runResearchAgent } from './research-agent';

// Run research on any topic - completely dynamic
const result = await runResearchAgent('Quantum Computing Applications', {
  depth: 'deep',
  maxSources: 10
});

console.log(`Report saved to: ${result.reportPath}`);
```

### Command Line Usage

```bash
# Run research with default settings
npm start "Your Research Topic"

# Run tests
npm test
```

## Architecture

The research agent uses fx-core's Chain of Thought pattern:

### 1. Initialize Chain of Thought
- Sets up reasoning state with problem definition
- Initializes thoughts array and step counter

### 2. Execute Chain of Thought Pattern
- Uses `createChainOfThoughtPattern` from `fx-core/patterns.ts`
- Implements step-by-step reasoning process
- Generates thoughts and reasoning for each step

### 3. Process Tools Based on Reasoning
- Executes research tools based on Chain of Thought conclusions
- Uses AI-powered tool selection and parameter extraction
- No hardcoded tool parameters - everything is dynamic

### 4. Update Conversation
- Incorporates Chain of Thought results into conversation
- Maintains reasoning trail for transparency

## Research Process

The agent follows a sophisticated Chain of Thought research process:

### 1. Problem Analysis
- AI analyzes the research topic using Chain of Thought
- Breaks down complex topics into manageable components
- Identifies key research questions and approaches

### 2. Dynamic Source Discovery
- Uses AI-powered Google search for any topic
- Discovers relevant URLs through intelligent analysis
- No hardcoded source lists - everything is dynamic

### 3. Content Extraction
- Scrapes content from discovered sources using Firecrawl
- Extracts metadata and analyzes content quality
- Handles any URL format dynamically

### 4. AI-Powered Analysis
- Uses Chain of Thought for content analysis
- Generates insights, themes, and conclusions
- All analysis is AI-generated - no hardcoded templates

### 5. Report Generation
- Creates comprehensive reports using AI reasoning
- Adapts report structure to any research topic
- Generates professional-quality output

## Tools Available

- **`google_search`**: AI-powered search for any topic
- **`discover_urls`**: Dynamic URL discovery using AI reasoning
- **`scrape_url`**: Web scraping with Firecrawl integration
- **`crawl_website`**: Multi-page crawling capabilities
- **`analyze_content`**: AI-powered content analysis
- **`generate_report`**: Comprehensive report generation

## Example Output

```markdown
# Comprehensive Research Report: Quantum Computing Applications

**Generated:** 2025-09-03T04:11:41.280Z
**Research Topic:** Quantum Computing Applications
**Report Type:** comprehensive
**Research Depth:** deep
**Total Sources:** 5
**Total Analyses:** 5

## Executive Summary

This comprehensive research report provides an in-depth analysis of Quantum Computing Applications, examining 5 authoritative sources and conducting 5 detailed analyses. The research employs advanced web scraping techniques, AI-powered content analysis, and systematic evaluation methodologies to deliver actionable insights.

### Key Findings:

1. Quantum computing offers exponential speedup for certain optimization problems
2. Quantum error correction is crucial for practical quantum applications
3. Major tech companies are investing heavily in quantum research

## Chain of Thought Analysis

The research process utilized Chain of Thought reasoning to:
- Break down complex quantum computing concepts
- Identify key application areas and use cases
- Analyze technical challenges and solutions
- Synthesize findings into actionable insights

## References

1. IBM Quantum Computing Research. Retrieved from https://www.ibm.com/quantum
2. Google AI Quantum Research. Retrieved from https://ai.googleblog.com/quantum
...
```

## Key Benefits

### 1. **Truly Dynamic**
- No hardcoded content or templates
- Adapts to any research topic automatically
- AI generates all analysis and insights

### 2. **Chain of Thought Reasoning**
- Uses fx-core's sophisticated reasoning patterns
- Transparent step-by-step thinking process
- Better quality analysis and conclusions

### 3. **Fail-Fast Design**
- No fallback to generic content
- Clear error messages when inputs are missing
- Ensures high-quality, relevant results

### 4. **Functional Architecture**
- Built using fx-core's composition patterns
- Pure functions and immutable state
- Easy to test and maintain

## Error Handling

The agent includes comprehensive error handling:

- **No URL Fallbacks**: Fails fast if no valid URL provided
- **AI-Powered Error Recovery**: Uses Chain of Thought for error analysis
- **Graceful Degradation**: Continues research with available sources
- **Clear Error Messages**: Provides actionable feedback

## Performance

- **Parallel Processing**: Scrapes multiple sources concurrently
- **AI Optimization**: Intelligent source prioritization
- **Memory Efficiency**: Optimized state management
- **Rate Limiting**: Respects API limits

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.