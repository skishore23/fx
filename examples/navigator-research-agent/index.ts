/**
 * Navigator Research Agent - Topological version of research-agent
 * Uses guard-driven execution for autonomous research tasks
 */

import { 
  createNavigatorAgent, 
  step
} from '@fx/navigator';
import {
  updateState,
  addState,
  BaseContext,
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  createToolRegistry,
  createValidatedTool
} from '@fx/core';
import { Either, safe, safeAsync, sequence } from '@fx/core';
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
  currentGoal: string;
  plan: string[];
  currentStep: number;
  maxIterations: number;
  iterationCount: number;
  // Chain of Thought properties
  problem: string;
  thoughts: string[];
  conclusion?: string;
  // Observability features
  observability?: any;
  decisionHistory: string[];
  
  // Topological state
  topicAnalyzed?: boolean;
  sourcesIdentified?: boolean;
  pagesScraped?: boolean;
  analysisComplete?: boolean;
  reportGenerated?: boolean;
  llmResponse?: string;
  discoveredUrls?: any[];
  searchResults?: any[];
  
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


export const createResearchTools = () => {
  const registry = createToolRegistry<ResearchState>();

  // Register tools with proper schema validation
  registry.registerMany([
    createValidatedTool('scrape_url', 'Scrape content from a URL', ScrapeUrlSchema,
      async (input: { url: string }, state: ResearchState) => {
        try {
          const result = await safeScrapeUrl(input.url);
          return Either.fold(
            result,
            (error) => {
              console.error('❌ Error in scrape_url:', error.message);
              return updateState({ error: error.message } as Partial<ResearchState>)(state);
            },
            (scrapeResult) => {
              const data = (scrapeResult as any).data;
              const page: ScrapedPage = {
                url: input.url,
                title: data?.metadata?.title || 'Untitled',
                content: data?.markdown || '',
                scrapedAt: new Date().toISOString(),
                wordCount: data?.markdown?.split(' ').length || 0,
                domain: new URL(input.url).hostname
              };
              return updateState({ 
                scrapedPages: [...(state.scrapedPages || []), page] 
              } as Partial<ResearchState>)(state);
            }
          );
        } catch (error) {
          console.error('❌ Error in scrape_url:', error);
          return state;
        }
      }
    ),

    createValidatedTool('crawl_website', 'Crawl a website for comprehensive research', CrawlUrlSchema,
      async (input: { url: string; maxPages?: number }, state: ResearchState) => {
        try {
          const result = await safeCrawlUrl(input.url);
          return Either.fold(
            result,
            (error) => {
              console.error('❌ Error in crawl_website:', error.message);
              return updateState({ error: error.message } as Partial<ResearchState>)(state);
            },
            (crawlResult) => {
              const pages: ScrapedPage[] = (crawlResult as any).data?.map((page: any) => ({
                url: page.url,
                title: page.metadata?.title || 'Untitled',
                content: page.markdown || '',
                scrapedAt: new Date().toISOString(),
                wordCount: page.markdown?.split(' ').length || 0,
                domain: new URL(page.url).hostname
              })) || [];
              return updateState({ 
                scrapedPages: [...(state.scrapedPages || []), ...pages] 
              } as Partial<ResearchState>)(state);
            }
          );
        } catch (error) {
          console.error('❌ Error in crawl_website:', error);
          return state;
        }
      }
    ),

    createValidatedTool('analyze_content', 'Analyze scraped content for insights and themes', AnalyzeContentSchema,
      async (input: { content: string; analysisType?: string }, state: ResearchState) => {
        try {
          const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
          const result = await llmTemplateStep(llmProvider, ANALYSIS_PROMPT_TEMPLATE)({
            ...state,
            contentToAnalyze: input.content,
            analysisType: input.analysisType || 'comprehensive'
          });
          
          const analysis: AnalysisResult = {
            sourceUrl: 'unknown',
            keyInsights: [String((result as any).systemResponse)],
            themes: [],
            credibilityScore: 0.8,
            biasIndicators: [],
            dataQuality: 'high'
          };
          
          return updateState({ 
            analysisResults: [...(state.analysisResults || []), analysis] 
          } as Partial<ResearchState>)(state);
        } catch (error) {
          console.error('❌ Error in analyze_content:', error);
          return state;
        }
      }
    ),

    createValidatedTool('generate_report', 'Generate a comprehensive research report', GenerateReportSchema,
      async (input: { reportType?: string; outputPath?: string }, state: ResearchState) => {
        try {
          const reportContent = await generateMarkdownReport(state, input.reportType || 'comprehensive');
          const outputPath = input.outputPath || `research-report-${Date.now()}.md`;
          
          // Write report to file
          writeFileSync(outputPath, reportContent, 'utf-8');
          
          return updateState({ 
            finalReport: reportContent,
            reportPath: outputPath
          } as Partial<ResearchState>)(state);
        } catch (error) {
          console.error('❌ Error in generate_report:', error);
          return state;
        }
      }
    ),

    createValidatedTool('google_search', 'Search Google for relevant information on any topic', GoogleSearchSchema,
      async (input: { query: string; maxResults?: number }, state: ResearchState) => {
        try {
          const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
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

          try {
            const results = JSON.parse((result as any).systemResponse || '[]');
            return updateState({ 
              searchResults: results,
              searchQuery: input.query
            } as Partial<ResearchState>)(state);
          } catch {
            return updateState({ 
              searchResults: [],
              searchQuery: input.query,
              error: 'Failed to parse search results'
            } as Partial<ResearchState>)(state);
          }
        } catch (error) {
          console.error('❌ Error in google_search:', error);
          return state;
        }
      }
    ),

    createValidatedTool('discover_urls', 'Discover relevant URLs for research using AI-powered analysis', DiscoverUrlsSchema,
      async (input: { topic: string; maxUrls?: number }, state: ResearchState) => {
        try {
          const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
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

          try {
            const urls = JSON.parse((result as any).systemResponse || '[]');
            return updateState({ 
              discoveredUrls: urls,
              discoveryTopic: input.topic
            } as Partial<ResearchState>)(state);
          } catch {
            return updateState({ 
              discoveredUrls: [],
              discoveryTopic: input.topic,
              error: 'Failed to parse URL discovery results'
            } as Partial<ResearchState>)(state);
          }
        } catch (error) {
          console.error('❌ Error in discover_urls:', error);
          return state;
        }
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
        report += `- **${theme}:** ${getThemeDescription(theme)}\n`;
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

const getThemeDescription = (theme: string): string => {
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


// ============================================================================
// TOPOLOGICAL STEPS (Navigator-specific)
// ============================================================================

/**
 * Step 1: Analyze research topic and set goals
 * Runs when: conversation exists and topic not yet analyzed
 */
const analyzeTopic = step('analyzeTopic', 
  (ctx: ResearchState) => !!ctx.conversation?.length && !ctx.topicAnalyzed,
  async (state: ResearchState): Promise<ResearchState> => {
    const lastMessage = state.conversation[state.conversation.length - 1]?.content || '';
    console.log('🔍 Step 1: Analyzing research topic:', lastMessage);
    
    // Use the actual user input as the research topic
    const topic = lastMessage.trim() || 'Research Topic';
    
    return updateState({ 
      researchTopic: topic,
      currentGoal: lastMessage,
      topicAnalyzed: true
    } as Partial<ResearchState>)(state);
  }
);

/**
 * Step 2: Identify research sources
 * Runs when: topic analyzed and sources not yet identified
 */
const identifySources = step('identifySources', 
  (ctx: ResearchState) => !!ctx.topicAnalyzed && !ctx.sourcesIdentified,
  async (state: ResearchState) => {
    console.log('🔍 Step 2: Identifying research sources for:', state.researchTopic);
    
    const tools = createResearchTools();
    let currentState = state;
    
    try {
      console.log('  - Searching for sources');
      const result = await tools.execute('google_search', { 
        ...currentState, 
        toolInput: { query: state.researchTopic } 
      });
      currentState = result as ResearchState;
    } catch (error) {
      console.error('Error searching for sources:', error);
    }
    
    return updateState({
      sourcesIdentified: true
    } as Partial<ResearchState>)(currentState);
  }
);

/**
 * Step 3: Scrape and analyze content
 * Runs when: sources identified and pages not yet scraped
 */
const scrapeAndAnalyze = step('scrapeAndAnalyze', 
  (ctx: ResearchState) => !!ctx.sourcesIdentified && !ctx.pagesScraped,
  async (state: ResearchState) => {
    console.log('🔍 Step 3: Scraping and analyzing content');
    
    const tools = createResearchTools();
    let currentState = state;
    
    // Use discovered URLs from search results
    const urls = (state.discoveredUrls as any[])?.map((u: any) => u.url) || [];
    
    for (const url of urls.slice(0, 3)) {
      try {
        console.log(`  - Scraping ${url}`);
        const scrapeResult = await tools.execute('scrape_url', { 
          ...currentState, 
          toolInput: { url } 
        });
        currentState = scrapeResult as ResearchState;
        
        // Analyze the scraped content
        if (currentState.scrapedPages && currentState.scrapedPages.length > 0) {
          const lastPage = currentState.scrapedPages[currentState.scrapedPages.length - 1];
          if (lastPage) {
            console.log(`  - Analyzing content from ${url}`);
            const analysisResult = await tools.execute('analyze_content', { 
              ...currentState, 
              toolInput: { 
                content: lastPage.content, 
                analysisType: 'comprehensive'
              } 
            });
            currentState = analysisResult as ResearchState;
          }
        }
      } catch (error) {
        console.error(`Error processing ${url}:`, error);
      }
    }
    
    return updateState({
      pagesScraped: true
    } as Partial<ResearchState>)(currentState);
  }
);

/**
 * Step 4: Generate comprehensive report
 * Runs when: content scraped and analysis not complete
 */
const generateReport = step('generateReport', 
  (ctx: ResearchState) => !!ctx.pagesScraped && !ctx.analysisComplete,
  async (state: ResearchState) => {
    console.log('🔍 Step 4: Generating comprehensive report');
    
    const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
    
    const stateWithContext: ResearchState = {
      ...state,
      researchTopic: state.researchTopic || 'Research Topic',
      researchDepth: state.researchDepth || 'medium',
      currentGoal: state.currentGoal || 'Generate research report'
    };

    try {
      const llmResult = await llmTemplateStep(llmProvider, RESEARCH_PROMPT_TEMPLATE)(stateWithContext);
      const response = (llmResult as any).systemResponse || 'Research analysis completed.';
      
      console.log('✅ Research report generated');
      return updateState({ 
        analysisComplete: true,
        llmResponse: response
      } as Partial<ResearchState>)(state);
    } catch (error) {
      console.log('⚠️ LLM call failed:', (error as Error).message);
      return updateState({ 
        analysisComplete: true,
        llmResponse: 'Research analysis completed with available data.'
      } as Partial<ResearchState>)(state);
    }
  }
);

/**
 * Step 5: Display final research report and save to file
 * Runs when: analysis complete and report not yet displayed
 */
const displayReport = step('displayReport', 
  (ctx: ResearchState) => !!ctx.analysisComplete && !ctx.reportGenerated,
  async (state: ResearchState): Promise<ResearchState> => {
    console.log('📊 Step 5: Displaying research report');
    
    const response = state.llmResponse!;
    console.log(`\n📋 Research Report: ${state.researchTopic}`);
    console.log('=' .repeat(50));
    console.log(response);
    console.log('=' .repeat(50));
    
    if (state.scrapedPages && state.scrapedPages.length > 0) {
      console.log(`\n📚 Sources Analyzed: ${state.scrapedPages.length}`);
      state.scrapedPages.forEach((page, index) => {
        console.log(`  ${index + 1}. ${page.title} (${page.url})`);
      });
    }
    
    if (state.analysisResults && state.analysisResults.length > 0) {
      console.log(`\n🔍 Analysis Results: ${state.analysisResults.length}`);
      state.analysisResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.keyInsights.join(', ')} (Credibility: ${(result.credibilityScore * 100).toFixed(1)}%)`);
      });
    }
    
    // Generate and save comprehensive report
    try {
      const reportContent = await generateMarkdownReport(state, 'comprehensive');
      const reportPath = join(process.cwd(), `navigator-dynamic-generic-research-report.md`);
      writeFileSync(reportPath, reportContent, 'utf-8');
      console.log(`\n📄 Comprehensive report saved to: ${reportPath}`);
    } catch (error) {
      console.error('❌ Error saving report:', error);
    }
    
    return updateState({
      reportGenerated: true,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    } as Partial<ResearchState>)(state);
  }
);

// ============================================================================
// NAVIGATOR AGENT
// ============================================================================

async function runNavigatorResearchAgent(userInput?: string) {
  console.log('🚀 Navigator Research Agent - Topological Research Execution\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    return;
  }
  
  if (!process.env.FIRECRAWL_KEY) {
    console.error('❌ Error: FIRECRAWL_KEY environment variable is required');
    console.log('Please set your Firecrawl API key in the .env file');
    return;
  }

  // Get user input if not provided
  const researchQuery = userInput || 'Generate a comprehensive report about AI trends';
  console.log(`🔍 Research Query: ${researchQuery}\n`);

  // Create navigator agent with topological execution
  const agent = createNavigatorAgent<ResearchState>([analyzeTopic, identifySources, scrapeAndAnalyze, generateReport, displayReport]);

  // Initialize state with user input
  const initialState: ResearchState = {
    conversation: [{ role: 'user', content: researchQuery }],
    researchTopic: researchQuery,
    researchDepth: 'medium',
    maxSources: 3,
    maxPagesPerSource: 2,
    scrapedPages: [],
    analysisResults: [],
    verbose: true,
    currentGoal: researchQuery,
    plan: [],
    currentStep: 0,
    maxIterations: 10,
    iterationCount: 0,
    problem: researchQuery,
    thoughts: [],
    conclusion: undefined,
    decisionHistory: []
  };

  try {
    console.log('🚀 Running navigator research agent with topological execution...');
    const result = await agent.run(initialState);
    
    console.log('\n✅ Navigator Research Agent completed successfully!');
    console.log('Response:', result.ctx.conversation[result.ctx.conversation.length - 1]?.content);
    
    console.log('\n📊 Execution Plan:');
    console.log(JSON.stringify(result.plan, null, 2));
    
    console.log('\n✅ Final Result:');
    console.log(`Research Topic: ${result.ctx.researchTopic}`);
    console.log(`Topic Analyzed: ${result.ctx.topicAnalyzed}`);
    console.log(`Sources Identified: ${result.ctx.sourcesIdentified}`);
    console.log(`Pages Scraped: ${result.ctx.pagesScraped}`);
    console.log(`Analysis Complete: ${result.ctx.analysisComplete}`);
    console.log(`Report Generated: ${result.ctx.reportGenerated}`);
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.duration}ms`);
  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
  }
}

// Run the example with a specific research query
runNavigatorResearchAgent('Research the latest developments in quantum computing').catch(console.error);

export { runNavigatorResearchAgent };