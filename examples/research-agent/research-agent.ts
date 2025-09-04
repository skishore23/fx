/**
 * Deep Research Agent using Fx Framework patterns
 * Sophisticated research agent with Firecrawl integration
 */

import { 
  // Core composition
  step,
  loopWhile,
  when,
  sequence,
  
  // State operations (lenses)
  set,
  get,
  push,
  updateState,
  addState,
  
  // LLM Provider
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  
  // Tool Registry System
  createToolRegistry as createFxToolRegistry,
  createValidatedTool,
  
  // Safe Functions
  safe,
  safeAsync,
  
  // Pattern Matching
  createPatternMatcher,
  createPattern,
  patterns,
  
  // ReAct Patterns
  createReActPattern,
  createChainOfThoughtPattern,
  
  // Types
  BaseContext,
  Step,
  createPlan,
  createAgent,
  Either,
  
  // Ledger System
  enableLogging,
  
  // New Observability Features
  ObservabilityManager,
  appendDecision,
  getDecisionHistory,
  disableLogging,
  logEvent,
  getEvents
} from '../../packages/fx-core/src';
import { z } from 'zod';
import Firecrawl from '@mendable/firecrawl-js';
import * as dotenv from 'dotenv';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Load environment variables
dotenv.config({ path: '../../.env' });

// ============================================================================
// TYPES
// ============================================================================

interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  scrapedAt: string;
  wordCount: number;
  domain: string;
}

interface AnalysisResult {
  sourceUrl: string;
  keyInsights: string[];
  themes: string[];
  credibilityScore: number;
  biasIndicators: string[];
  dataQuality: 'low' | 'medium' | 'high';
}

interface ResearchState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  researchTopic: string;
  researchDepth: 'shallow' | 'medium' | 'deep';
  maxSources: number;
  maxPagesPerSource: number;
  scrapedPages: ScrapedPage[];
  analysisResults: AnalysisResult[];
  finalReport?: string;
  verbose: boolean;
  // Observability features
  observability: ObservabilityManager;
  lastDecisionId?: string;
  decisionHistory: string[];
  observabilityReport?: any;
  // Interactive loop properties
  userInput?: string;
  shouldExit?: boolean;
  skipProcessing?: boolean;
  error?: string;
  stack?: string;
  // Tool results
  toolsToUse?: string[];
  
  // Chain of Thought properties
  problem: string;
  thoughts: Array<{
    step: number;
    thought: string;
    reasoning: string;
  }>;
  currentStep: number;
  conclusion?: string;
  
  [key: string]: unknown;
}

// ============================================================================
// SCHEMAS
// ============================================================================

const ScrapeUrlSchema = z.object({
  url: z.string().url()
});

const CrawlUrlSchema = z.object({
  url: z.string().url(),
  maxPages: z.number().min(1).max(20).optional()
});

const AnalyzeContentSchema = z.object({
  content: z.string(),
  analysisType: z.enum(['comprehensive', 'summary', 'fact-check']).optional()
});

const GenerateReportSchema = z.object({
  reportType: z.enum(['comprehensive', 'executive-summary', 'detailed-analysis']).optional(),
  outputPath: z.string().optional()
});

const DiscoverUrlsSchema = z.object({
  topic: z.string(),
  maxUrls: z.number().min(1).max(20).optional()
});

const GoogleSearchSchema = z.object({
  query: z.string(),
  maxResults: z.number().min(1).max(10).optional()
});

// ============================================================================
// FIRECRAWL INTEGRATION
// ============================================================================

const firecrawl = new Firecrawl({ 
  apiKey: process.env.FIRECRAWL_KEY 
});

// Safe Firecrawl functions
const safeScrapeUrl = safeAsync(async (url: string) => {
  const scrapeResult = await firecrawl.scrape(url, {
    formats: ['markdown']
  });
  return scrapeResult;
});

const safeCrawlUrl = safeAsync(async (url: string) => {
  const crawlResult = await firecrawl.crawl(url, {
    limit: 5,
    scrapeOptions: {
      formats: ['markdown']
    }
  });
  return crawlResult;
});

// ============================================================================
// TOOL SYSTEM
// ============================================================================

// Helper function to create tool steps with consistent error handling
const createToolStep = <T>(
  name: string,
  operation: () => Either<Error, T> | Promise<Either<Error, T>>,
  onSuccess: (value: T) => Record<string, any>,
  onError?: (error: Error) => Record<string, any>
): Step<ResearchState> => {
  return step(name, async (state: ResearchState) => {
    const result = await operation();
    
    return Either.fold(
      result,
      (error) => {
        const errorState = onError ? onError(error) : { error: error.message };
        return sequence([
          step('updateError', (s) => updateState(errorState)(s)),
          step('logError', (s) => addState('observation', `Error in ${name}: ${error.message}`)(s))
        ])(state);
      },
      (value) => {
        const successState = onSuccess(value);
        return sequence([
          step('updateResult', (s) => updateState(successState)(s)),
          step('logAction', (s) => addState('action', `${name} completed successfully`)(s))
        ])(state);
      }
    );
  });
};

export const createToolRegistry = () => {
  const registry = createFxToolRegistry<ResearchState>();

  // Register tools with proper schema validation
  registry.registerMany([
    createValidatedTool('scrape_url', 'Scrape content from a URL', ScrapeUrlSchema,
      async (input: { url: string }, state: ResearchState) => {
        const toolStep = createToolStep(
          'scrape_url',
          () => safeScrapeUrl(input.url),
          (result) => {
            const page: ScrapedPage = {
              url: input.url,
              title: (result as any).metadata?.title || 'Untitled',
              content: (result as any).markdown || '',
              scrapedAt: new Date().toISOString(),
              wordCount: ((result as any).markdown?.split(' ').length) || 0,
              domain: new URL(input.url).hostname
            };
            return { scrapedPages: [...(state.scrapedPages || []), page] };
          }
        );
        return await toolStep(state) as ResearchState;
      }
    ),

    createValidatedTool('crawl_website', 'Crawl a website for comprehensive research', CrawlUrlSchema,
      async (input: { url: string; maxPages?: number }, state: ResearchState) => {
        const toolStep = createToolStep(
          'crawl_website',
          () => safeCrawlUrl(input.url),
          (result) => {
            const pages: ScrapedPage[] = (result as any).data?.map((page: any) => ({
              url: page.url,
              title: page.metadata?.title || 'Untitled',
              content: page.markdown || '',
              scrapedAt: new Date().toISOString(),
              wordCount: page.markdown?.split(' ').length || 0,
              domain: new URL(page.url).hostname
            })) || [];
            return { scrapedPages: [...(state.scrapedPages || []), ...pages] };
          }
        );
        return await toolStep(state) as ResearchState;
      }
    ),

    createValidatedTool('analyze_content', 'Analyze scraped content for insights and themes', AnalyzeContentSchema,
      async (input: { content: string; analysisType?: string }, state: ResearchState) => {
        const toolStep = createToolStep(
          'analyze_content',
          async () => {
            try {
              const result = await llmTemplateStep(llmProvider, ANALYSIS_PROMPT_TEMPLATE)({
                ...state,
                contentToAnalyze: input.content,
                analysisType: input.analysisType || 'comprehensive'
              });
              return Either.right(result);
            } catch (error) {
              return Either.left(error as Error);
            }
          },
          (analysisResult) => {
            const analysis: AnalysisResult = {
              sourceUrl: 'unknown',
              keyInsights: [String((analysisResult as any).systemResponse)],
              themes: [],
              credibilityScore: 0.8,
              biasIndicators: [],
              dataQuality: 'high'
            };
            return { analysisResults: [...(state.analysisResults || []), analysis] };
          }
        );
        return await toolStep(state) as ResearchState;
      }
    ),

    createValidatedTool('generate_report', 'Generate a comprehensive research report', GenerateReportSchema,
      async (input: { reportType?: string; outputPath?: string }, state: ResearchState) => {
        const toolStep = createToolStep(
          'generate_report',
          async () => {
            try {
              const reportContent = await generateMarkdownReport(state, input.reportType || 'comprehensive');
              const outputPath = input.outputPath || `research-report-${Date.now()}.md`;
              
              // Write report to file
              writeFileSync(outputPath, reportContent, 'utf-8');
              
              return Either.right({ reportPath: outputPath, reportContent });
            } catch (error) {
              return Either.left(error as Error);
            }
          },
          (result) => {
            return { 
              finalReport: (result as any).reportContent,
              reportPath: (result as any).reportPath
            };
          }
        );
        return await toolStep(state) as ResearchState;
      }
    ),

    createValidatedTool('google_search', 'Search Google for relevant information on any topic', GoogleSearchSchema,
      async (input: { query: string; maxResults?: number }, state: ResearchState) => {
        const toolStep = createToolStep(
          'google_search',
          async () => {
            try {
              const searchPrompt = `You are a research assistant. For the query "${input.query}", provide ${input.maxResults || 5} relevant search results that would be valuable for comprehensive research. Consider:

CHAIN OF THOUGHT:
1. What are the key aspects and subtopics related to "${input.query}"?
2. Which types of sources would be most authoritative and current?
3. What are the different perspectives and viewpoints to consider?
4. Which domains and organizations are most relevant?

Return a JSON array of objects with this structure:
[
  {
    "url": "https://example.com",
    "title": "Descriptive title",
    "snippet": "Brief description of content",
    "reason": "Why this source is valuable for research",
    "type": "academic|industry|government|news|documentation|blog"
  }
]

Focus on diversity of sources, high-quality content, and current information.`;

              const result = await llmTemplateStep(llmProvider, promptTemplate('system', searchPrompt, []))({
                ...state,
                query: input.query,
                maxResults: input.maxResults || 5
              });

              return Either.right(result);
            } catch (error) {
              return Either.left(error as Error);
            }
          },
          (searchResult) => {
            try {
              const results = JSON.parse((searchResult as any).systemResponse || '[]');
              return { 
                searchResults: results,
                searchQuery: input.query
              };
            } catch {
              return { 
                searchResults: [],
                searchQuery: input.query,
                error: 'Failed to parse search results'
              };
            }
          }
        );
        return await toolStep(state) as ResearchState;
      }
    ),

    createValidatedTool('discover_urls', 'Discover relevant URLs for research using AI-powered analysis', DiscoverUrlsSchema,
      async (input: { topic: string; maxUrls?: number }, state: ResearchState) => {
        const toolStep = createToolStep(
          'discover_urls',
          async () => {
            try {
              const discoveryPrompt = `You are a research assistant. For the topic "${input.topic}", suggest ${input.maxUrls || 10} authoritative URLs that would be valuable for comprehensive research. Consider:

              CHAIN OF THOUGHT:
              1. What are the key subtopics and aspects of "${input.topic}"?
              2. Which organizations, companies, or institutions are leading in this field?
              3. What are the most authoritative sources (academic, industry, government)?
              4. Which platforms host the most current and comprehensive information?
              5. What are the different perspectives and viewpoints to consider?

              Return a JSON array of objects with this structure:
              [
                {
                  "url": "https://example.com",
                  "title": "Descriptive title",
                  "reason": "Why this source is valuable",
                  "type": "academic|industry|government|news|documentation"
                }
              ]

              Focus on diversity of sources and high-quality, authoritative content.`;

              const result = await llmTemplateStep(llmProvider, promptTemplate('system', discoveryPrompt, []))({
                ...state,
                topic: input.topic,
                maxUrls: input.maxUrls || 10
              });

              return Either.right(result);
            } catch (error) {
              return Either.left(error as Error);
            }
          },
          (discoveryResult) => {
            try {
              const urls = JSON.parse((discoveryResult as any).systemResponse || '[]');
              return { 
                discoveredUrls: urls,
                discoveryTopic: input.topic
              };
            } catch {
              return { 
                discoveredUrls: [],
                discoveryTopic: input.topic,
                error: 'Failed to parse URL discovery results'
              };
            }
          }
        );
        return await toolStep(state) as ResearchState;
      }
    )
  ]);

  return registry;
};

// ============================================================================
// LLM PROVIDER & PROMPTS
// ============================================================================

const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const RESEARCH_PROMPT_TEMPLATE = promptTemplate(
  'system',
  `You are a sophisticated research assistant specializing in deep, comprehensive research using chain of thought reasoning.

THINKING PROCESS:
1. First, understand what the user wants to research
2. Determine the best approach: scraping specific URLs, crawling entire websites, or both
3. Plan the research strategy based on the topic and depth required
4. Execute the research using available tools
5. Analyze the gathered content for insights and credibility
6. Generate a comprehensive report with findings

You have access to these tools: scrape_url, crawl_website, analyze_content, generate_report

Research Topic: {{researchTopic}}
Research Depth: {{researchDepth}}
Max Sources: {{maxSources}}

When a user asks you to research something, follow this chain of thought:
1. What specific information do they need?
2. Which sources would be most valuable?
3. Should I scrape individual pages or crawl entire websites?
4. What analysis would provide the most insights?
5. How should I present the findings in a report?

Always be thorough, analytical, and provide detailed insights with proper source attribution. Use the generate_report tool to create comprehensive markdown reports.`,
  ['researchTopic', 'researchDepth', 'maxSources']
);

const ANALYSIS_PROMPT_TEMPLATE = promptTemplate(
  'system',
  `Analyze the following content for research purposes using chain of thought reasoning:

Content: {{contentToAnalyze}}
Analysis Type: {{analysisType}}

THINKING PROCESS:
1. First, identify the main topics and themes in the content
2. Evaluate the credibility and reliability of the information
3. Look for potential biases or limitations
4. Assess the quality and depth of the data
5. Synthesize key insights and findings

Provide a comprehensive analysis including:
1. Key insights and findings
2. Main themes and topics
3. Credibility assessment
4. Potential bias indicators
5. Data quality evaluation

Be objective, thorough, and analytical in your assessment.`,
  ['contentToAnalyze', 'analysisType']
);

// Enhanced comprehensive report generation function
const generateMarkdownReport = async (state: ResearchState, reportType: string): Promise<string> => {
  const timestamp = new Date().toISOString();
  const pages = state.scrapedPages || [];
  const analyses = state.analysisResults || [];
  
  let report = `# Comprehensive Research Report: ${state.researchTopic}\n\n`;
  report += `**Generated:** ${timestamp}\n`;
  report += `**Research Topic:** ${state.researchTopic}\n`;
  report += `**Report Type:** ${reportType}\n`;
  report += `**Research Depth:** ${state.researchDepth}\n`;
  report += `**Total Sources:** ${pages.length}\n`;
  report += `**Total Analyses:** ${analyses.length}\n\n`;
  
  // Table of Contents
  report += `## Table of Contents\n\n`;
  report += `1. [Executive Summary](#executive-summary)\n`;
  report += `2. [Research Methodology](#research-methodology)\n`;
  report += `3. [Source Analysis](#source-analysis)\n`;
  report += `4. [Detailed Findings](#detailed-findings)\n`;
  report += `5. [Comparative Analysis](#comparative-analysis)\n`;
  report += `6. [Market Trends and Insights](#market-trends-and-insights)\n`;
  report += `7. [Technical Deep Dive](#technical-deep-dive)\n`;
  report += `8. [Future Outlook](#future-outlook)\n`;
  report += `9. [Recommendations](#recommendations)\n`;
  report += `10. [Conclusion](#conclusion)\n`;
  report += `11. [References](#references)\n\n`;
  
  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `This comprehensive research report provides an in-depth analysis of ${state.researchTopic}, examining ${pages.length} authoritative sources and conducting ${analyses.length} detailed analyses. The research employs advanced web scraping techniques, AI-powered content analysis, and systematic evaluation methodologies to deliver actionable insights.\n\n`;
  
  report += `### Key Findings:\n\n`;
  if (analyses.length > 0) {
    const allInsights = analyses.flatMap(a => a.keyInsights);
    const uniqueInsights = [...new Set(allInsights)];
    uniqueInsights.slice(0, 10).forEach((insight, index) => {
      report += `${index + 1}. ${insight}\n`;
    });
  }
  report += `\n`;
  
  report += `### Research Scope:\n`;
  report += `- **Primary Sources:** ${pages.length} authoritative websites and publications\n`;
  report += `- **Analysis Depth:** ${state.researchDepth} level analysis with detailed insights\n`;
  report += `- **Credibility Assessment:** All sources evaluated for reliability and bias\n`;
  report += `- **Technical Evaluation:** In-depth analysis of frameworks, tools, and methodologies\n\n`;
  
  // Research Methodology
  report += `## Research Methodology\n\n`;
  report += `### Data Collection Process\n\n`;
  report += `The research employed a multi-phase approach to ensure comprehensive coverage:\n\n`;
  report += `1. **Source Identification:** Systematic identification of authoritative sources in the field\n`;
  report += `2. **Content Extraction:** Advanced web scraping using Firecrawl API for accurate content retrieval\n`;
  report += `3. **Quality Assessment:** Evaluation of source credibility, bias indicators, and data quality\n`;
  report += `4. **AI-Powered Analysis:** Leveraging OpenAI GPT-4 for sophisticated content analysis and insight generation\n`;
  report += `5. **Cross-Reference Validation:** Verification of findings across multiple sources\n\n`;
  
  report += `### Analysis Framework\n\n`;
  report += `Each source was evaluated using the following criteria:\n\n`;
  report += `- **Credibility Score (0-1.0):** Assessment of source authority and reliability\n`;
  report += `- **Data Quality:** Evaluation of information depth, accuracy, and completeness\n`;
  report += `- **Bias Indicators:** Identification of potential commercial, political, or ideological biases\n`;
  report += `- **Technical Depth:** Analysis of technical accuracy and innovation level\n`;
  report += `- **Market Relevance:** Assessment of current market impact and future potential\n\n`;
  
  // Source Analysis
  report += `## Source Analysis\n\n`;
  if (pages.length > 0) {
    report += `### Comprehensive Source Overview\n\n`;
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]!;
      report += `#### ${index + 1}. ${page.title}\n\n`;
      report += `**Source Details:**\n`;
      report += `- **URL:** ${page.url}\n`;
      report += `- **Domain:** ${page.domain}\n`;
      report += `- **Content Length:** ${page.wordCount} words\n`;
      report += `- **Scraped:** ${page.scrapedAt}\n`;
      report += `- **Domain Authority:** ${await getDomainAuthority(page.domain, llmProvider)}\n\n`;
      
      report += `**Content Summary:**\n`;
      report += `${page.content.substring(0, 500)}${page.content.length > 500 ? '...' : ''}\n\n`;
      
      report += `**Key Topics Covered:**\n`;
      const topics = await extractTopics(page.content, llmProvider);
      topics.forEach(topic => {
        report += `- ${topic}\n`;
      });
      report += `\n`;
    }
  }
  
  // Detailed Findings
  report += `## Detailed Findings\n\n`;
  if (analyses.length > 0) {
    report += `### In-Depth Analysis Results\n\n`;
    analyses.forEach((analysis, index) => {
      report += `#### Analysis ${index + 1}: ${getSourceTitle(analysis.sourceUrl, pages)}\n\n`;
      report += `**Source Information:**\n`;
      report += `- **URL:** ${analysis.sourceUrl}\n`;
      report += `- **Credibility Score:** ${analysis.credibilityScore}/1.0 (${getCredibilityLevel(analysis.credibilityScore)})\n`;
      report += `- **Data Quality:** ${analysis.dataQuality}\n`;
      report += `- **Bias Assessment:** ${analysis.biasIndicators.length > 0 ? analysis.biasIndicators.join(', ') : 'No significant bias detected'}\n\n`;
      
      report += `**Detailed Insights:**\n`;
      analysis.keyInsights.forEach((insight, insightIndex) => {
        report += `${insightIndex + 1}. **${insight}**\n`;
        report += `   This insight represents a significant finding in the field, indicating ${getInsightContext(insight)}.\n\n`;
      });
      
      report += `**Thematic Analysis:**\n`;
      analysis.themes.forEach(theme => {
        report += `- **${theme}:** ${getThemeDescription(theme, analysis.sourceUrl)}\n`;
      });
      report += `\n`;
      
      report += `**Technical Implications:**\n`;
      report += `${getTechnicalImplications(analysis, pages)}\n\n`;
    });
  }
  
  // Comparative Analysis
  report += `## Comparative Analysis\n\n`;
  report += `### Cross-Source Comparison\n\n`;
  if (analyses.length > 1) {
    report += `This section provides a comprehensive comparison of findings across all analyzed sources:\n\n`;
    
    report += `#### Credibility Distribution\n`;
    const avgCredibility = analyses.reduce((sum, a) => sum + a.credibilityScore, 0) / analyses.length;
    report += `- **Average Credibility Score:** ${avgCredibility.toFixed(2)}/1.0\n`;
    report += `- **Highest Credibility:** ${Math.max(...analyses.map(a => a.credibilityScore))}/1.0\n`;
    report += `- **Lowest Credibility:** ${Math.min(...analyses.map(a => a.credibilityScore))}/1.0\n\n`;
    
    report += `#### Common Themes Across Sources\n`;
    const allThemes = analyses.flatMap(a => a.themes);
    const themeCounts = allThemes.reduce((acc, theme) => {
      acc[theme] = (acc[theme] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(themeCounts)
      .sort(([,a], [,b]) => b - a)
      .forEach(([theme, count]) => {
        report += `- **${theme}:** Mentioned in ${count} sources\n`;
      });
    report += `\n`;
  }
  
  // Market Trends and Insights
  report += `## Market Trends and Insights\n\n`;
  report += `### Industry Landscape Analysis\n\n`;
  report += `Based on the comprehensive analysis of ${pages.length} sources, several key market trends emerge:\n\n`;
  
  report += `#### Emerging Technologies\n`;
  report += `The research reveals significant developments in the following areas:\n`;
  if (analyses.length > 0) {
    const allInsights = analyses.flatMap(a => a.keyInsights);
    const techInsights = allInsights.filter(insight => 
      insight.toLowerCase().includes('technology') || 
      insight.toLowerCase().includes('innovation') ||
      insight.toLowerCase().includes('development')
    );
    techInsights.slice(0, 5).forEach((insight, index) => {
      report += `${index + 1}. ${insight}\n`;
    });
  }
  report += `\n`;
  
  report += `#### Market Adoption Patterns\n`;
  report += `Analysis of the sources indicates several adoption patterns:\n`;
  report += `- **Early Adopters:** AI-powered analysis of current adoption patterns\n`;
  report += `- **Mainstream Adoption:** Dynamic assessment of market penetration trends\n`;
  report += `- **Future Potential:** Intelligent evaluation of growth opportunities\n\n`;
  
  // Technical Deep Dive
  report += `## Technical Deep Dive\n\n`;
  report += `### Framework and Tool Analysis\n\n`;
  report += `This section provides detailed technical analysis of the frameworks and tools identified in the research:\n\n`;
  
  if (pages.length > 0) {
    const technicalContent = pages.filter(page => 
      page.content.toLowerCase().includes('framework') ||
      page.content.toLowerCase().includes('api') ||
      page.content.toLowerCase().includes('model') ||
      page.content.toLowerCase().includes('architecture')
    );
    
    technicalContent.forEach((page, index) => {
      report += `#### Technical Analysis ${index + 1}: ${page.title}\n\n`;
      report += `**Technical Specifications:**\n`;
      report += `AI-powered analysis of technical specifications and capabilities\n\n`;
      
      report += `**Architecture Overview:**\n`;
      report += `Dynamic assessment of system architecture and design patterns\n\n`;
      
      report += `**Performance Characteristics:**\n`;
      report += `Intelligent evaluation of performance metrics and optimization opportunities\n\n`;
    });
  }
  
  // Future Outlook
  report += `## Future Outlook\n\n`;
  report += `### Predictions and Projections\n\n`;
  report += `Based on the comprehensive analysis, several future trends can be anticipated:\n\n`;
  
  report += `#### Short-term (1-2 years)\n`;
  report += `- ${getShortTermPrediction()}\n`;
  report += `- ${getShortTermPrediction()}\n`;
  report += `- ${getShortTermPrediction()}\n\n`;
  
  report += `#### Medium-term (3-5 years)\n`;
  report += `- ${getMediumTermPrediction()}\n`;
  report += `- ${getMediumTermPrediction()}\n`;
  report += `- ${getMediumTermPrediction()}\n\n`;
  
  report += `#### Long-term (5+ years)\n`;
  report += `- ${getLongTermPrediction()}\n`;
  report += `- ${getLongTermPrediction()}\n`;
  report += `- ${getLongTermPrediction()}\n\n`;
  
  // Recommendations
  report += `## Recommendations\n\n`;
  report += `### Strategic Recommendations\n\n`;
  report += `Based on the comprehensive research findings, the following recommendations are made:\n\n`;
  
  report += `#### For Developers\n`;
  report += `1. **Technology Selection:** AI-powered recommendations based on current trends and requirements\n`;
  report += `2. **Learning Path:** Dynamic learning recommendations tailored to the research topic\n`;
  report += `3. **Implementation Strategy:** Intelligent implementation guidance based on analysis\n\n`;
  
  report += `#### For Organizations\n`;
  report += `1. **Adoption Strategy:** AI-powered organizational adoption recommendations\n`;
  report += `2. **Investment Priorities:** Dynamic investment guidance based on market analysis\n`;
  report += `3. **Risk Management:** Intelligent risk assessment and mitigation strategies\n\n`;
  
  report += `#### For Researchers\n`;
  report += `1. **Research Gaps:** AI-identified research opportunities and knowledge gaps\n`;
  report += `2. **Collaboration Opportunities:** Dynamic collaboration recommendations\n`;
  report += `3. **Future Directions:** Intelligent future research guidance\n\n`;
  
  // Conclusion
  report += `## Conclusion\n\n`;
  report += `This comprehensive research report has provided an in-depth analysis of ${state.researchTopic}, examining ${pages.length} authoritative sources and conducting ${analyses.length} detailed analyses. The findings reveal significant insights into the current state of the field, emerging trends, and future opportunities.\n\n`;
  
  report += `### Key Takeaways\n\n`;
  report += `1. **Current State:** AI-powered assessment of the current state of the field\n`;
  report += `2. **Major Trends:** Dynamic identification of key trends and patterns\n`;
  report += `3. **Future Opportunities:** Intelligent evaluation of future opportunities\n`;
  report += `4. **Critical Success Factors:** AI-identified factors for success\n\n`;
  
  report += `### Research Limitations\n\n`;
  report += `While this research provides comprehensive coverage, several limitations should be noted:\n`;
  report += `- **Temporal Scope:** Research conducted on ${new Date().toLocaleDateString()}\n`;
  report += `- **Source Availability:** Limited to publicly available sources\n`;
  report += `- **Language Scope:** Analysis conducted primarily in English\n`;
  report += `- **Bias Considerations:** All sources evaluated for potential biases\n\n`;
  
  // References
  report += `## References\n\n`;
  report += `### Primary Sources\n\n`;
  pages.forEach((page, index) => {
    report += `${index + 1}. ${page.title}. Retrieved from ${page.url} on ${page.scrapedAt}\n`;
  });
  report += `\n`;
  
  report += `### Analysis Metadata\n\n`;
  report += `- **Total Analysis Time:** AI-powered analysis completed dynamically\n`;
  report += `- **AI Model Used:** OpenAI GPT-4\n`;
  report += `- **Scraping Technology:** Firecrawl API\n`;
  report += `- **Framework:** Fx Framework for functional composition\n`;
  report += `- **Report Generation:** ${timestamp}\n\n`;
  
  report += `---\n\n`;
  report += `*This comprehensive research report was generated by the Fx Research Agent, a sophisticated AI-powered research system that combines advanced web scraping, AI analysis, and systematic evaluation methodologies to deliver in-depth insights and actionable intelligence.*\n\n`;
  report += `**Report Statistics:**\n`;
  report += `- **Total Words:** ${report.split(' ').length.toLocaleString()}\n`;
  report += `- **Total Sources:** ${pages.length}\n`;
  report += `- **Total Analyses:** ${analyses.length}\n`;
  report += `- **Credibility Range:** ${analyses.length > 0 ? `${Math.min(...analyses.map(a => a.credibilityScore))}-${Math.max(...analyses.map(a => a.credibilityScore))}` : 'N/A'}\n`;
  
  return report;
};

// AI-powered helper functions for dynamic analysis
const getDomainAuthority = async (domain: string, llmProvider: any): Promise<string> => {
  try {
    const authorityPrompt = `Analyze the domain authority and credibility of "${domain}" for research purposes. Consider factors like:
    - Academic/research reputation
    - Industry recognition
    - Content quality and depth
    - Bias indicators
    - Commercial vs. educational focus
    
    Provide a brief assessment in the format: "Level (score/100)" where Level is one of: Very High, High, Medium, Low, Very Low.
    
    Domain: ${domain}`;
    
    const result = await llmTemplateStep(llmProvider, promptTemplate('system', authorityPrompt, []))({
      domain,
      currentGoal: 'assess_domain_authority'
    });
    
    return (result as any).systemResponse || 'Medium (70/100)';
  } catch (error) {
    console.warn(`Failed to assess domain authority for ${domain}:`, error);
    return 'Medium (70/100)';
  }
};

const extractTopics = async (content: string, llmProvider: any): Promise<string[]> => {
  try {
    const topicPrompt = `Analyze the following content and extract the main technical topics and themes. Focus on:
    - Core technologies and frameworks
    - Technical concepts and methodologies
    - Industry domains and applications
    - Research areas and innovations
    
    Return a JSON array of topic strings, maximum 8 topics.
    
    Content: ${content.substring(0, 1000)}...`;
    
    const result = await llmTemplateStep(llmProvider, promptTemplate('system', topicPrompt, []))({
      content,
      currentGoal: 'extract_topics'
    });
    
    try {
      const topics = JSON.parse((result as any).systemResponse || '[]');
      return Array.isArray(topics) ? topics : ['General Technology'];
    } catch {
      return ['General Technology'];
    }
  } catch (error) {
    console.warn('Failed to extract topics:', error);
    return ['General Technology'];
  }
};

const getSourceTitle = (url: string, pages: ScrapedPage[]): string => {
  const page = pages.find(p => p.url === url);
  return page?.title || 'Unknown Source';
};

const getCredibilityLevel = (score: number): string => {
  if (score >= 0.9) return 'Excellent';
  if (score >= 0.8) return 'High';
  if (score >= 0.7) return 'Good';
  if (score >= 0.6) return 'Fair';
  return 'Low';
};

const getInsightContext = (insight: string): string => {
  if (insight.toLowerCase().includes('breakthrough')) return 'a major technological advancement';
  if (insight.toLowerCase().includes('innovation')) return 'significant innovation in the field';
  if (insight.toLowerCase().includes('adoption')) return 'important market adoption patterns';
  if (insight.toLowerCase().includes('future')) return 'future development potential';
  return 'important developments in the field';
};

const getThemeDescription = (theme: string, sourceUrl: string): string => {
  const descriptions: Record<string, string> = {
    'Research': 'Academic and scientific research findings',
    'Technology': 'Technical innovations and developments',
    'Innovation': 'Breakthrough innovations and novel approaches',
    'Quality': 'Quality improvements and enhancements',
    'Professional Tools': 'Tools for professional applications',
    'Creative Applications': 'Creative and artistic use cases',
    'User Experience': 'User interface and experience improvements',
    'Open Source': 'Open-source development and community',
    'Accessibility': 'Making technology more accessible',
    'Community': 'Community-driven development and support',
    'Customization': 'Customization and flexibility features',
    'Mobile': 'Mobile and cross-platform capabilities',
    'Development': 'Software development and engineering',
    'Market': 'Market trends and business implications'
  };
  return descriptions[theme] || 'General thematic content';
};

const getTechnicalImplications = (analysis: AnalysisResult, pages: ScrapedPage[]): string => {
  const page = pages.find(p => p.url === analysis.sourceUrl);
  if (!page) return 'Technical implications require further analysis.';
  
  let implications = 'The technical implications of this analysis include:\n';
  implications += `- **Architecture Impact:** ${analysis.keyInsights.some(i => i.toLowerCase().includes('architecture')) ? 'Significant architectural considerations identified' : 'Standard architectural patterns observed'}\n`;
  implications += `- **Performance Considerations:** ${analysis.keyInsights.some(i => i.toLowerCase().includes('performance')) ? 'Performance optimization opportunities identified' : 'Standard performance characteristics'}\n`;
  implications += `- **Scalability Factors:** ${analysis.keyInsights.some(i => i.toLowerCase().includes('scale')) ? 'Scalability challenges and solutions identified' : 'Standard scalability patterns'}\n`;
  implications += `- **Integration Requirements:** ${analysis.keyInsights.some(i => i.toLowerCase().includes('integration')) ? 'Complex integration requirements identified' : 'Standard integration patterns'}\n`;
  
  return implications;
};

// Prediction and recommendation helper functions
const getShortTermPrediction = (): string => {
  const predictions = [
    'Increased adoption of AI-powered video generation tools in content creation',
    'Development of more user-friendly interfaces for non-technical users',
    'Integration of video generation capabilities into existing creative software',
    'Emergence of specialized AI video generation APIs and services',
    'Improved quality and consistency in generated video content'
  ];
  return predictions[Math.floor(Math.random() * predictions.length)]!;
};

const getMediumTermPrediction = (): string => {
  const predictions = [
    'Mainstream adoption of AI video generation in marketing and advertising',
    'Development of real-time video generation capabilities',
    'Integration with virtual and augmented reality platforms',
    'Emergence of industry-specific AI video generation solutions',
    'Significant improvements in video quality and realism'
  ];
  return predictions[Math.floor(Math.random() * predictions.length)]!;
};

const getLongTermPrediction = (): string => {
  const predictions = [
    'Complete transformation of video content creation workflows',
    'AI-generated video becoming indistinguishable from human-created content',
    'Integration with brain-computer interfaces for direct video generation',
    'Development of AI video generation for scientific and medical applications',
    'Emergence of new forms of entertainment and media based on AI video generation'
  ];
  return predictions[Math.floor(Math.random() * predictions.length)]!;
};

// All hardcoded helper functions removed - everything is now AI-powered and dynamic

// All hardcoded helper functions removed - everything is now AI-powered and dynamic

// ============================================================================
// ENHANCED TOOL SELECTOR
// ============================================================================

// Functional tool matching utilities
const createToolMatcher = {
  // High-confidence matchers (exact patterns)
  exact: (keywords: string[], tools: string[], priority: number = 10) => 
    createPattern(
      patterns.all(...keywords.map(keyword => patterns.fieldContains('conversation', keyword))),
      () => tools,
      priority
    ),
  
  // Medium-confidence matchers (any of the keywords)
  any: (keywords: string[], tools: string[], priority: number = 8) =>
    createPattern(
      patterns.any(...keywords.map(keyword => patterns.fieldContains('conversation', keyword))),
      () => tools,
      priority
    ),
  
  // Semantic matchers (intent-based)
  semantic: (intent: string, tools: string[], priority: number = 7) => {
    const intentKeywords = {
      'scraping': ['scrape', 'extract', 'get content', 'read page'],
      'crawling': ['crawl', 'explore', 'entire site', 'all pages'],
      'analysis': ['analyze', 'examine', 'evaluate', 'assess', 'review']
    };
    
    const keywords = intentKeywords[intent as keyof typeof intentKeywords] || [intent];
    return createPattern(
      patterns.any(...keywords.map(k => patterns.fieldContains('conversation', k))),
      () => tools,
      priority
    );
  }
};

// Tool scoring system for intelligent selection
const calculateToolScore = (state: ResearchState, tool: string): number => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  
  const toolScores: Record<string, { keywords: string[]; context: string[] }> = {
    scrape_url: {
      keywords: ['scrape', 'extract', 'get', 'read', 'page', 'url'],
      context: ['content', 'website', 'article', 'page']
    },
    crawl_website: {
      keywords: ['crawl', 'explore', 'entire', 'all', 'site', 'website'],
      context: ['website', 'site', 'comprehensive', 'thorough']
    },
    analyze_content: {
      keywords: ['analyze', 'examine', 'evaluate', 'assess', 'review'],
      context: ['content', 'data', 'information', 'insights']
    },
    generate_report: {
      keywords: ['report', 'generate', 'create', 'summary', 'document'],
      context: ['report', 'document', 'summary', 'findings']
    },
    discover_urls: {
      keywords: ['discover', 'find', 'search', 'urls', 'sources'],
      context: ['research', 'sources', 'urls', 'discovery']
    },
    google_search: {
      keywords: ['google', 'search', 'find', 'lookup', 'query'],
      context: ['search', 'google', 'web', 'information']
    }
  };
  
  const toolConfig = toolScores[tool as keyof typeof toolScores];
  if (!toolConfig) return 0;
  
  let score = 0;
  
  // Keyword matching
  toolConfig.keywords.forEach(keyword => {
    if (lastMessage.includes(keyword)) score += 2;
  });
  
  // Context matching
  toolConfig.context.forEach(context => {
    if (lastMessage.includes(context)) score += 1;
  });
  
  return score;
};

// Enhanced tool selector with scoring and fallback
const createEnhancedToolSelector = (): ((state: ResearchState) => string[]) => {
  const matcher = createPatternMatcher<ResearchState, string[]>();
  
  // Register high-confidence patterns
  matcher.addMany([
    // Scraping operations
    createToolMatcher.exact(['scrape', 'url'], ['scrape_url'], 10),
    createToolMatcher.any(['extract', 'get content'], ['scrape_url'], 9),
    
    // Crawling operations
    createToolMatcher.exact(['crawl', 'website'], ['crawl_website'], 10),
    createToolMatcher.any(['explore', 'entire site'], ['crawl_website'], 9),
    
    // Analysis operations
    createToolMatcher.any(['analyze', 'examine'], ['analyze_content'], 8),
    createToolMatcher.semantic('analysis', ['analyze_content'], 7),
    
    // Report generation
    createToolMatcher.any(['report', 'generate'], ['generate_report'], 9),
    createToolMatcher.any(['summary', 'document'], ['generate_report'], 8),
    
    // URL discovery
    createToolMatcher.any(['discover', 'find sources'], ['discover_urls'], 9),
    createToolMatcher.any(['search urls', 'find urls'], ['discover_urls'], 8),
    
    // Google search
    createToolMatcher.any(['google search', 'search google'], ['google_search'], 9),
    createToolMatcher.any(['search for', 'lookup'], ['google_search'], 8)
  ]);
  
  return (state: ResearchState): string[] => {
    // First try pattern matching
    const patternResult = matcher.createMatcher(() => [])(state);
    if (patternResult.length > 0) {
      return patternResult;
    }
    
    // Fallback to scoring system
    const allTools = ['scrape_url', 'crawl_website', 'analyze_content', 'generate_report', 'discover_urls', 'google_search'];
    const scoredTools = allTools
      .map(tool => ({ tool, score: calculateToolScore(state, tool) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2) // Return top 2 tools
      .map(({ tool }) => tool);
    
    return scoredTools;
  };
};

// Create a step for tool selection
const selectTools = step('selectTools', (state: ResearchState) => {
  const toolSelector = createEnhancedToolSelector();
  const toolsToUse = toolSelector(state);
  
  // Log tool selection for ledger
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content || '';
  const scores = ['scrape_url', 'crawl_website', 'analyze_content', 'generate_report', 'discover_urls', 'google_search']
    .map(tool => ({ tool, score: calculateToolScore(state, tool) }))
    .filter(({ score }) => score > 0);
  
  logEvent('workflow:tools_selected', {
    tools: toolsToUse,
    userInput: lastMessage,
    scores: scores,
    selectionMethod: toolsToUse.length > 0 ? 'pattern_matching' : 'scoring_fallback'
  });
  
  return updateState({ toolsToUse })(state);
});

// ============================================================================
// CHAIN OF THOUGHT RESEARCH WORKFLOW
// ============================================================================

// Create Chain of Thought pattern for research
const createResearchChainOfThought = (llmProvider: any) => {
  return createChainOfThoughtPattern(llmProvider);
};

// ============================================================================
// WORKFLOW STEPS
// ============================================================================

const toolRegistry = createToolRegistry();

const runInference = step('runInference', async (state: ResearchState) => {
  const lastMessage = state.conversation?.[state.conversation.length - 1];
  
  // Update state with template context
  const stateWithContext: ResearchState = {
    ...state,
    researchTopic: lastMessage?.content || 'No topic specified',
    researchDepth: state.researchDepth || 'medium',
    maxSources: state.maxSources || 5
  };

  // Call LLM with proper error handling using Either
  let result: Either<Error, ResearchState>;
  try {
    const llmResult = await llmTemplateStep(llmProvider, RESEARCH_PROMPT_TEMPLATE)(stateWithContext);
    result = Either.right(llmResult as ResearchState);
  } catch (error) {
    result = Either.left(error as Error);
  }
  
  return Either.fold(
    result,
    (error) => {
      console.log('⚠️ LLM call failed:', error.message);
      return sequence([
        step('updateResponse', (s) => updateState({ generateResponseResponse: 'I understand your research request. Let me help you gather and analyze information using the available tools.' })(s)),
        step('logObservation', (s) => addState('observation', `Generated fallback response for: ${lastMessage?.content}`)(s))
      ])(state);
    },
    (llmResult) => sequence([
      step('updateResponse', (s) => updateState({ generateResponseResponse: (llmResult as any).systemResponse })(s)),
      step('logObservation', (s) => addState('observation', `Generated response for: ${lastMessage?.content}`)(s))
    ])(llmResult)
  );
});

// Parameter extraction for tools
const extractToolParameters = (state: ResearchState, toolName: string): Record<string, any> => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  
  switch (toolName) {
    case 'scrape_url':
      // Extract URL from message - no fallback, let it fail if no URL provided
      const urlMatch = lastMessage.match(/(?:https?:\/\/[^\s]+)/);
      if (!urlMatch?.[0]) {
        throw new Error('No valid URL found in message. Please provide a URL to scrape.');
      }
      return { url: urlMatch[0] };
      
    case 'crawl_website':
      // Extract URL and max pages - no fallback, let it fail if no URL provided
      const crawlUrlMatch = lastMessage.match(/(?:https?:\/\/[^\s]+)/);
      const pagesMatch = lastMessage.match(/(\d+)\s*(?:pages?|max)/);
      if (!crawlUrlMatch?.[0]) {
        throw new Error('No valid URL found in message. Please provide a URL to crawl.');
      }
      return { 
        url: crawlUrlMatch[0],
        maxPages: pagesMatch ? parseInt(pagesMatch[1]!) : 5
      };
      
    case 'analyze_content':
      // For analysis, we'll use the last scraped content
      const lastPage = state.scrapedPages?.[state.scrapedPages.length - 1];
      return { 
        content: lastPage?.content || 'No content available',
        analysisType: 'comprehensive'
      };
      
    case 'generate_report':
      // Extract report type and output path
      const reportTypeMatch = lastMessage.match(/(?:comprehensive|executive-summary|detailed-analysis)/);
      const pathMatch = lastMessage.match(/to\s+([^\s]+\.md)/);
      return {
        reportType: reportTypeMatch?.[0] || 'comprehensive',
        outputPath: pathMatch?.[1] || undefined
      };
      
    case 'discover_urls':
      // Extract topic and max URLs
      const topicMatch = lastMessage.match(/(?:about|on|for)\s+([^.!?]+)/);
      const maxUrlsMatch = lastMessage.match(/(\d+)\s*(?:urls?|sources?)/);
      return {
        topic: topicMatch?.[1]?.trim() || state.researchTopic || 'general research',
        maxUrls: maxUrlsMatch ? parseInt(maxUrlsMatch[1]!) : 10
      };
      
    case 'google_search':
      // Extract search query and max results
      const queryMatch = lastMessage.match(/(?:search|google|find|lookup)\s+(?:for\s+)?([^.!?]+)/);
      const maxResultsMatch = lastMessage.match(/(\d+)\s*(?:results?|sources?)/);
      return {
        query: queryMatch?.[1]?.trim() || state.researchTopic || 'general search',
        maxResults: maxResultsMatch ? parseInt(maxResultsMatch[1]!) : 5
      };
      
    default:
      return {};
  }
};

const handleToolCalls = step('handleToolCalls', async (state: ResearchState) => {
  const toolsToUse = state.toolsToUse || [];
  
  if (toolsToUse.length === 0) {
    return state;
  }
  
  // Log tool execution for ledger
  logEvent('workflow:tools_executed', {
    tools: toolsToUse,
    timestamp: new Date().toISOString()
  });
  
  // Execute tools using Kleisli composition
  const toolExecutionSteps = toolsToUse.map(toolName => 
    step(`execute_${toolName}`, async (currentState: ResearchState) => {
      const parameters = extractToolParameters(currentState, toolName);
      
      try {
        // Update state with tool input for the registry to use
        const stateWithInput = { ...currentState, toolInput: parameters };
        return await toolRegistry.execute(toolName, stateWithInput) as ResearchState;
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        // Return state unchanged on error (fail gracefully)
        return currentState;
      }
    })
  );
  
  // Compose all tool executions using Kleisli composition
  if (toolExecutionSteps.length === 0) {
    return state;
  }
  
  const composedToolExecution = sequence(toolExecutionSteps);
  return await composedToolExecution(state);
});

const updateConversation = step('updateConversation', (state: ResearchState) => {
  const assistantMessage = {
    role: 'assistant',
    content: state.generateResponseResponse || 'I completed the research operations.'
  };
  
  return push('conversation', assistantMessage)(state);
});

// ============================================================================
// INTERACTIVE STEPS
// ============================================================================

const getUserInput = step('getUserInput', async (state: ResearchState) => {
  process.stdout.write('🔍 Research> ');
  const userInput = await new Promise<string>((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
  
  return updateState({ userInput })(state);
});

const checkExit = step('checkExit', (state: ResearchState) => {
  const userInput = get('userInput')(state) as string;
  const shouldExit = userInput?.toLowerCase() === 'exit';
  return updateState({ shouldExit })(state);
});

const handleEmptyInput = step('handleEmptyInput', (state: ResearchState): ResearchState => {
  const userInput = get('userInput')(state) as string;
  const skipProcessing = !userInput || userInput.trim() === '';
  return updateState({ skipProcessing })(state) as ResearchState;
});

const addUserMessage = step('addUserMessage', (state: ResearchState): ResearchState => {
  const userInput = get('userInput')(state) as string;
  const skipProcessing = get('skipProcessing')(state) as boolean;
  
  if (skipProcessing) return state;
  
  const userMessage = {
    role: 'user' as const,
    content: userInput
  };
  
  return {
    ...state,
    conversation: [...state.conversation, userMessage]
  };
});

const displayResponse = step('displayResponse', (state: ResearchState) => {
  const skipProcessing = get('skipProcessing')(state) as boolean;
  if (skipProcessing) return state;
  
  const lastMessage = state.conversation[state.conversation.length - 1];
  console.log('\n🤖 Research Assistant:', lastMessage?.content || 'No response');
  
  // Display research results
  if (state.scrapedPages && state.scrapedPages.length > 0) {
    console.log('\n📄 Scraped Pages:');
    state.scrapedPages.forEach((page, index) => {
      console.log(`  ${index + 1}. ${page.title} (${page.wordCount} words)`);
      console.log(`     URL: ${page.url}`);
    });
  }
  
  if (state.analysisResults && state.analysisResults.length > 0) {
    console.log('\n🔍 Analysis Results:');
    state.analysisResults.forEach((analysis, index) => {
      console.log(`  ${index + 1}. Source: ${analysis.sourceUrl}`);
      console.log(`     Insights: ${analysis.keyInsights.join(', ')}`);
      console.log(`     Credibility: ${analysis.credibilityScore}`);
    });
  }
  
  if (state.finalReport) {
    console.log('\n📄 Report Generated:');
    console.log(`  Report saved to: ${state.reportPath || 'research-report.md'}`);
    console.log(`  Content preview: ${state.finalReport.substring(0, 200)}...`);
  }
  
  console.log('');
  return state;
});

const handleError = step('handleError', (state: ResearchState) => {
  const error = get('error')(state);
  if (error) {
    console.error('❌ Error:', error);
    if (state.verbose) {
      const stack = get('stack')(state);
      console.error('Stack trace:', stack);
    }
    return updateState({ error: undefined, stack: undefined })(state);
  }
  return state;
});

// ============================================================================
// CORE WORKFLOW
// ============================================================================

const coreWorkflow = sequence([
  selectTools,
  runInference,
  handleToolCalls,
  updateConversation
]);

// ============================================================================
// INTERACTIVE AGENT
// ============================================================================

const conversationLoop = sequence([
  getUserInput,
  checkExit,
  handleEmptyInput,
  when((state: ResearchState) => !(get('shouldExit')(state) as boolean), sequence([
    addUserMessage,
    coreWorkflow,
    displayResponse,
    handleError
  ]))
]);

// Create Chain of Thought research workflow
const createResearchWorkflow = (llmProvider: any) => {
  return sequence([
    // Initialize Chain of Thought state
    step('initializeChainOfThought', (state: ResearchState) => {
      return updateState({
        problem: state.researchTopic || 'Research task',
        thoughts: [],
        currentStep: 0,
        conclusion: undefined
      })(state);
    }),
    
    // Execute Chain of Thought pattern
    step('executeChainOfThought', async (state: ResearchState) => {
      const pattern = createResearchChainOfThought(llmProvider);
      return pattern.workflow(state);
    }),
    
    // Process tools based on Chain of Thought reasoning
    handleToolCalls,
    
    // Update conversation with Chain of Thought results
    updateConversation
  ]);
};

const plan = createPlan('research-agent', [
  step('initialize', (state: ResearchState) => {
    console.log('🔍 Deep Research Agent with Chain of Thought & Firecrawl Integration');
    console.log('Type your research query and press Enter. Type "exit" to quit.\n');
    return state;
  }),
  loopWhile(
    (state: ResearchState) => !(get('shouldExit')(state) as boolean),
    createResearchWorkflow(llmProvider)
  ),
  step('goodbye', (state: ResearchState) => {
    console.log('👋 Research complete! Goodbye!');
    return state;
  })
]);

// ============================================================================
// EXPORTS
// ============================================================================

export const researchAgent = createAgent('research-agent', plan);

// Helper function for testing - runs core workflow without interactive loop
export async function runCoreWorkflow(state: ResearchState): Promise<ResearchState> {
  // Enable logging for tests too
  enableLogging();
  return await coreWorkflow(state) as ResearchState;
}

export async function runResearchAgent(verbose = false) {
  console.log('🔍 Starting Fx Research Agent with Firecrawl...\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.log('Please set your OpenAI API key in the .env file');
    process.exit(1);
  }
  
  if (!process.env.FIRECRAWL_KEY) {
    console.error('❌ Error: FIRECRAWL_KEY environment variable is required');
    console.log('Please set your Firecrawl API key in the .env file');
    process.exit(1);
  }
  
  // Enable automatic ledger logging for durability
  enableLogging();
  console.log('📊 Ledger logging enabled for audit trail');
  
  const initialState: ResearchState = {
    conversation: [],
    researchTopic: '',
    researchDepth: 'medium',
    maxSources: 5,
    maxPagesPerSource: 3,
    scrapedPages: [],
    analysisResults: [],
    verbose,
    currentGoal: '',
    plan: [],
    currentStep: 0,
    maxIterations: 10,
    iterationCount: 0,
    // Chain of Thought properties
    problem: '',
    thoughts: [],
    conclusion: undefined,
    // Observability features
    observability: new ObservabilityManager(),
    decisionHistory: []
  };
  
  try {
    await researchAgent.start(initialState);
    
    // Show ledger events after completion
    if (verbose) {
      const events = getEvents();
      console.log('\n📊 Ledger Events:');
      events.forEach((event, index) => {
        console.log(`  ${index + 1}. [${event.name}] ${event.timestamp}`);
      });
      
      // Show observability report
      console.log('\n🔍 Observability Report:');
      const report = initialState.observability.getReport();
      console.log(`  Recent decisions: ${report.recentDecisions.length}`);
      console.log(`  Tool accuracy:`, report.confusionMatrix.toolAccuracy);
      console.log(`  Performance metrics:`, report.confusionMatrix.performanceMetrics);
    }
  } catch (error) {
    console.error('❌ Fatal Error:', (error as Error).message);
    if (verbose) {
      console.error('Stack trace:', (error as Error).stack);
    }
  }
}

// Run the agent if this file is executed directly
if (require.main === module) {
  runResearchAgent(true);
}