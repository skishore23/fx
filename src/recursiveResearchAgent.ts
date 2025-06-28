/**
 * Recursive Research Agent
 * 
 * A functional agent architecture for performing multi-step research on any topic.
 * This agent follows these core functional programming principles:
 * 
 * 1. Immutability - State is never modified in-place
 * 2. Pure functions - Operations don't cause side effects beyond their return values
 * 3. Function composition - Complex operations are composed from simpler ones
 * 4. Explicit error propagation - No silent failures or fallbacks that hide errors
 * 5. Lens-based state updates - State transitions are traceable and reproducible
 * 
 * The agent's workflow:
 * 1. Generate initial search queries based on the user's question
 * 2. Perform web searches to gather information
 * 3. Extract key learnings from search results
 * 4. Generate new research directions based on insights
 * 5. Select the most promising directions and pursue them
 * 6. Repeat until depth limit reached, then generate report
 * 
 * @module recursiveResearchAgent
 */

//-----------------------------------------------------------------------
// 1. Dependencies ───────────────────────────────────────────────────────
import 'dotenv/config';
import Fx from "./index";
import { z } from "zod";
import OpenAI from "openai";
import FirecrawlApp from '@mendable/firecrawl-js';
import { compact } from 'lodash';
import fs from 'fs/promises';
import path from 'path';

//-----------------------------------------------------------------------
// 2. Configuration ────────────────────────────────────────────────────
// Define Step type
type Step<S> = (state: Readonly<S>, log: any) => Promise<S> | S;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Firecrawl for web search
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// Concurrency limit for API requests
const ConcurrencyLimit = Number(process.env.FIRECRAWL_CONCURRENCY) || 2;

// LLM helper function - update to support structured output
async function llm(prompt: string, schema?: any): Promise<any> {
  if (schema) {
    // Use with schema for structured output
    const response = await openai.chat.completions.create({
      model: "o3-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that returns structured JSON based on the user's request." 
        },
        { role: "user", content: prompt }
      ],
    });
    const content = response.choices[0].message.content ?? "{}";
    try {
      return JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse JSON response:", e);
      return {};
    }
  } else {
    // Regular text completion
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0].message.content ?? "";
  }
}

//-----------------------------------------------------------------------
// 3. Domain State and Types ─────────────────────────────────────────────
interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  markdown?: string;  // Full content in markdown format
}

interface Direction {
  question: string;
  reasoning: string;
  priority: number; // 1-10
  researchGoal?: string; // Added for Firecrawl compatibility
}

interface Learning {
  insight: string;
  source: string;
  confidence: number; // 1-10
  category?: string;  // Category of the insight
  entities?: string[]; // Important entities mentioned
}

interface ResearchIteration {
  query: string;
  searchResults: SearchResult[];
  learnings: Learning[];
  nextDirections: Direction[];
}

interface ResearchState {
  userQuery: string;
  breadthParameter: number; // How many parallel directions to explore
  depthParameter: number; // How many recursive iterations to perform
  iterations: ResearchIteration[];
  currentDepth: number;
  currentBreadth: number;
  isComplete: boolean;
  visitedUrls: string[]; // Track visited URLs to avoid duplicates
  finalReport?: string;
}

// Research progress tracking for UI feedback
interface ResearchProgress {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
}


//-----------------------------------------------------------------------
// 4. Tool Registration and Implementation ──────────────────────────────────────
// Define schemas for validation
const SearchResultSchema = z.object({
  title: z.string(),
  link: z.string().refine(val => {
    // Accept empty strings or valid URLs
    if (val === '') return true;
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, { message: "If provided, must be a valid URL" }).default(""),
  snippet: z.string().optional().default(""),
  markdown: z.string().optional()
});

// Web search using Firecrawl
Fx.registerTool<ResearchState, z.ZodTuple<[z.ZodString]>>(
  "web_search",
  z.tuple([z.string()]),
  (query: string) => async (state) => {
    // Clean up the query - remove unnecessary quotation marks
    const cleanQuery = query.replace(/^["']|["']$/g, '').trim();
    console.log(`🔍 Searching with Firecrawl: "${cleanQuery}"`);
    
    try {
      // Perform Firecrawl search with proper parameters
      const result = await firecrawl.search(cleanQuery, {
        timeout: 20000, // Increased timeout for more thorough scraping
        limit: 10,      // Increased from 5 to 10 results
        scrapeOptions: { 
          formats: ['markdown']
        }
      });
      
      // Process search results
      const searchResults = result.data.map((item: any) => SearchResultSchema.parse({
        title: item.title || "Untitled Result",
        link: item.url || "",
        snippet: item.snippet || "",
        markdown: item.markdown || ""
      }));
      
      if (searchResults.length === 0) {
        console.warn(`No search results found for query: "${cleanQuery}"`);
        return state;
      }
      
      // Collect new URLs
      const newUrls = compact(result.data.map((item: any) => item.url));
      
      // Update state immutably
      const safeIterations = Array.isArray(state.iterations) ? state.iterations : [];
      const existingIndex = safeIterations.findIndex(it => it.query === query);
      const safeVisitedUrls = Array.isArray(state.visitedUrls) ? state.visitedUrls : [];
      const allVisitedUrls = [...new Set([...safeVisitedUrls, ...newUrls])];
      
      if (existingIndex >= 0) {
        return {
          ...state,
          iterations: safeIterations.map((it, idx) => 
            idx === existingIndex ? { ...it, searchResults } : it
          ),
          visitedUrls: allVisitedUrls
        };
      } else {
        return {
          ...state,
          iterations: [...safeIterations, {
            query,
            searchResults,
            learnings: [],
            nextDirections: []
          }],
          visitedUrls: allVisitedUrls
        };
      }
    } catch (error) {
      console.error(`Error in Firecrawl search for query "${cleanQuery}":`, error);
      
      // Return state unchanged on error
      return state;
    }
  }
);

//-----------------------------------------------------------------------
// 5. Research Steps Implementation ────────────────────────────────────
// Generate initial search queries
const generateSearchQueries: Step<ResearchState> = 
  Fx.wrap("generateQueries", async (state, log) => {
    console.log(`\n=== Generating initial search queries for: "${state.userQuery}" ===`);
    
    try {
      // Define a more comprehensive schema for structured query generation
      
      // Create a detailed prompt for query generation with explicit JSON requirement
      const queryPrompt = `As a research strategist, design an optimal set of search queries to thoroughly investigate: "${state.userQuery}"

TASK:
Develop ${state.breadthParameter} diverse, specific search queries that will uncover different dimensions of the topic. For each query:

1. Create a specific, focused search query (avoid general terms)
2. Specify a clear research goal explaining what information you aim to find
3. Categorize the query (Technical, Implementation, Comparison, Trend, etc.)
4. Describe the expected findings

Follow these query design principles:
- Include a mix of query types (technical details, comparisons, implementations, case studies, trends)
- Ensure coverage of different aspects (architecture, capabilities, limitations, use cases)
- Prefer specific technical terms over general descriptions
- Include queries that target both established and emerging approaches
- Create queries that will yield actionable insights rather than general overviews

IMPORTANT: Design each query to uncover SPECIFIC information that will ultimately contribute to a comprehensive understanding.

RESPONSE FORMAT: Provide your response as a JSON object with a "queries" array containing the query objects.`;
      
      // Generate queries using gpt-4o for higher quality
      const queryResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { 
            role: "system", 
            content: "You are a research strategist who designs optimal search queries to thoroughly investigate topics. You specialize in crafting diverse, specific queries that uncover different dimensions of a subject and return results in JSON format." 
          },
          { role: "user", content: queryPrompt }
        ],
      });
      
      const content = queryResponse.choices[0].message.content ?? "{}";
      let queryResult;
      
      try {
        queryResult = JSON.parse(content);
      } catch (e) {
        console.error("Failed to parse JSON response for queries:", e);
        // Fall back to default queries if parsing fails
        return generateFallbackQueries(state);
      }
      
      // Limit to breadth parameter
      const queries = queryResult.queries.slice(0, state.breadthParameter);
      
      console.log("Generated search queries:");
      queries.forEach((q: any, i: number) => {
        console.log(`${i+1}. [${q.queryCategory}] "${q.query}"`);
        console.log(`   Goal: ${q.researchGoal.substring(0, 100)}...`);
      });
      
      // Create initial iterations
      const iterations = queries.map(({ query, researchGoal, queryCategory, expectedFindings }: any) => ({
        query,
        searchResults: [],
        learnings: [],
        nextDirections: [{
          question: query,
          reasoning: `${researchGoal} - Category: ${queryCategory}`,
          priority: 10,
          researchGoal: `${researchGoal}\n\nExpected findings: ${expectedFindings}`
        }]
      }));
      
      // Update state immutably
      return {
        ...state,
        iterations
      };
    } catch (error) {
      console.error("Error generating search queries:", error);
      return generateFallbackQueries(state);
    }
  });

// Helper function for fallback query generation
const generateFallbackQueries = async (state: ResearchState): Promise<ResearchState> => {
  console.log("Using fallback query generation strategy");
  
  // Create more specific, focused fallback queries
  const fallbackQueries = [
    `top AI agent frameworks 2025`,
    `AI agent framework architecture comparison`,
    `enterprise AI agent framework implementation examples`,
    `open source AI agent frameworks technical features`,
    `future trends in AI agent frameworks`
  ].slice(0, state.breadthParameter);
  
  console.log("Using fallback queries:", fallbackQueries);
  
  const iterations = fallbackQueries.map(query => ({
    query,
    searchResults: [],
    learnings: [],
    nextDirections: [{
      question: query,
      reasoning: `Research on ${query} to gather specific information related to ${state.userQuery}`,
      priority: 8,
      researchGoal: `Find detailed information about ${query} to create a comprehensive understanding of the AI agent framework landscape`
    }]
  }));
  
  return {
    ...state,
    iterations
  };
};

// Search web for information
const searchWeb: Step<ResearchState> = 
  Fx.wrap("searchWeb", async (state, log) => {
    console.log("\n=== Executing web searches ===");
    
    // Ensure iterations is an array
    if (!state.iterations || !Array.isArray(state.iterations)) {
      throw new Error("Invalid state: iterations must be an array");
    }
    
    // Find iterations that need search results
    const iterationsToSearch = state.iterations
      .filter(iteration => 
        !Array.isArray(iteration.searchResults) || 
        iteration.searchResults.length === 0
      );
    
    console.log(`Found ${iterationsToSearch.length} iterations that need search results`);
    
    if (iterationsToSearch.length === 0) {
      console.log("All iterations already have search results. Skipping search step.");
      return state;
    }
    
    // Maximum of 3 iterations to prevent infinite loops
    const limitedIterations = iterationsToSearch.slice(0, 3);
    console.log(`Processing ${limitedIterations.length} search requests in this batch`);
    
    // Create separate search steps for each iteration
    const searchSteps = limitedIterations.map((iteration, idx) =>
      Fx.wrap(`searchIteration_${idx}`, async (currentState: ResearchState) => {
        console.log(`Searching for: "${iteration.query}"`);
        
        // Call web_search tool for this query
        const updatedState = await Fx.callTool<ResearchState>(
          "web_search", 
          [iteration.query]
        )(currentState, log);
        
        // Add delay for rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return updatedState;
      })
    );
    
    // Execute all search steps in sequence using the framework's composition
    const updatedState = await Fx.sequence(...searchSteps)(state, log);
    
    // Log the iteration status after searches
    console.log("\n=== After search operations ===");
    updatedState.iterations.forEach((iter, idx) => {
      const searchCount = Array.isArray(iter.searchResults) ? iter.searchResults.length : 0;
      console.log(`Iteration ${idx}: Query "${iter.query}" has ${searchCount} search results`);
    });
    
    return updatedState;
  });

// Extract learnings from search results
const extractLearnings: Step<ResearchState> = 
  Fx.wrap("extractLearnings", async (state, log) => {
    console.log("\n=== Extracting learnings from search results ===");
    
    // Log the current state
    console.log(`Current state has ${state.iterations.length} total iterations`);
    
    // Process each iteration that has search results but no learnings
    const iterationsToProcess = state.iterations
      .map((iteration, index) => ({ iteration, index }))
      .filter(({ iteration }) => 
        iteration.searchResults?.length > 0 && 
        (!iteration.learnings || iteration.learnings.length === 0));
    
    console.log(`Found ${iterationsToProcess.length} iterations to extract learnings from`);
    
    if (iterationsToProcess.length === 0) {
      return state;
    }
    
    // Helper function to trim content to a certain length
    const trimContent = (content: string, maxLength: number): string => {
      if (!content) return '';
      return content.length <= maxLength ? content : content.substring(0, maxLength);
    };
    
    // Create steps for each iteration to process
    const processSteps = iterationsToProcess.map(({ iteration, index }) => 
      Fx.wrap(`extractLearningsForIteration${index}`, async (currentState: ResearchState) => {
        try {
          console.log(`Analyzing results for: "${iteration.query}"`);
          
          // Prepare content from search results
          const contents = compact(
            iteration.searchResults.map(r => r.markdown || r.snippet)
          ).map((content: string) => trimContent(content, 50000));
          
          if (contents.length === 0) {
            console.log(`No content to analyze for iteration ${index}`);
            return currentState;
          }
          
          // Define learning schema with z.object for proper type validation
          const LearningSchema = z.object({
            insight: z.string().min(10, "Insight must be informative"),
            source: z.string(),
            confidence: z.number().min(1).max(10),
            category: z.string(),
            entities: z.array(z.string())
          });
          
          const LearningsResponseSchema = z.object({
            learnings: z.array(LearningSchema),
            followUpQuestions: z.array(z.string())
          });
          
          // Build the extraction prompt
          const prompt = `You are a research analyst extracting key insights from search results about "${iteration.query}" related to "${state.userQuery}".

SEARCH CONTENT:
${contents.map((content: string, i: number) => `[Source ${i+1}] ${content.substring(0, 3000)}...`).join('\n\n')}

TASK:
Extract 5-8 detailed, high-quality insights from these search results. For each insight:
1. Provide a detailed explanation (2-3 sentences minimum)
2. Note which source it came from
3. Rate your confidence in the insight (1-10)
4. Categorize it (Technical, Business, Trend, Comparison, etc.)
5. List key entities mentioned (companies, products, technologies, people)

Focus on extracting SPECIFIC details rather than general statements:
- Include specific technologies, methodologies, architectures
- Extract numerical data, statistics, and metrics when available
- Note specific use cases, implementation details, and technical characteristics
- Identify comparative information between different options
- Extract insights about trends, challenges, and future directions

RESPONSE FORMAT: Provide your response as a JSON object with a "learnings" array and a "followUpQuestions" array.

For example:
{
  "learnings": [
    {
      "insight": "Detailed insight description...",
      "source": "Source 1",
      "confidence": 8,
      "category": "Technical",
      "entities": ["OpenAI", "GPT-4", "Microsoft"]
    }
  ],
  "followUpQuestions": [
    "What are the limitations of framework X?",
    "How does framework Y handle multi-agent coordination?"
  ]
}`;

          // Define LLM call as a step that can be wrapped with concurrency
          const getLLMResponse = Fx.wrap("getLLMResponse", async () => {
            const response = await openai.chat.completions.create({
              model: "gpt-4o",
              response_format: { type: "json_object" },
              temperature: 0.2,
              messages: [
                { 
                  role: "system", 
                  content: "You are a research analyst who extracts detailed, information-rich insights from content. You excel at identifying specific technical details, comparative information, and trend analysis rather than general observations. You only respond with valid JSON." 
                },
                { role: "user", content: prompt }
              ],
            });
            
            return response.choices[0].message.content ?? "{}";
          });
          
          // Apply concurrency to the LLM call
          const concurrentGetLLMResponse = Fx.concurrency(getLLMResponse, ConcurrencyLimit);
          
          // Get the LLM response with concurrency control
          const content = await concurrentGetLLMResponse("", log);
          
          // Log the LLM response
          Fx.prompt(
            `extractLearningsForIteration${index}`, 
            () => prompt,
            async () => content
          )(currentState, log);
          
          // Parse and validate the response
          let extractionResult;
          try {
            const parsedData = JSON.parse(content);
            extractionResult = LearningsResponseSchema.parse(parsedData);
          } catch (error) {
            console.error(`Failed to parse or validate response: ${error}`);
            return currentState;
          }
          
          if (!extractionResult.learnings || extractionResult.learnings.length === 0) {
            console.warn(`No learnings extracted for iteration ${index}`);
            return currentState;
          }
          
          console.log(`Successfully extracted ${extractionResult.learnings.length} learnings for iteration ${index}`);
          
          // Also store follow-up questions as directions if we don't already have directions
          let directions: Direction[] = [];
          if ((!iteration.nextDirections || iteration.nextDirections.length === 0) && extractionResult.followUpQuestions.length > 0) {
            directions = extractionResult.followUpQuestions.map((question: string, i: number) => ({
              question,
              reasoning: `Follow-up question from research on "${iteration.query}"`,
              priority: 8 - i, // Decreasing priority
              researchGoal: `Explore this question to deepen understanding of ${state.userQuery}`
            }));
          }
          
          // Create a new state with the updated iteration
          return await Fx.update<ResearchState, ResearchIteration[]>(
            'iterations',
            (iterations) => iterations.map((iter, idx) => 
              idx === index 
                ? {
                    ...iter,
                    learnings: extractionResult.learnings,
                    ...(directions.length > 0 ? { nextDirections: directions } : {})
                  }
                : iter
            )
          )(currentState, log);
          
        } catch (error) {
          console.error(`Error extracting learnings for iteration ${index}:`, error);
          // Skip this iteration but continue with others
          return currentState;
        }
      })
    );
    
    // Process all steps in sequence using the library's functional composition
    const updatedState = await Fx.sequence(...processSteps)(state, log);
    
    // Debug output to show updated state
    console.log("\n=== After extracting learnings ===");
    let totalLearnings = 0;
    updatedState.iterations.forEach((iter, idx) => {
      const learningCount = Array.isArray(iter.learnings) ? iter.learnings.length : 0;
      totalLearnings += learningCount;
      console.log(`Iteration ${idx}: Query "${iter.query}" has ${learningCount} learnings`);
    });
    console.log(`Total learnings across all iterations: ${totalLearnings}`);
    
    return updatedState;
  });

// Generate next research directions
const generateNextDirections: Step<ResearchState> = 
  Fx.wrap("generateNextDirections", async (state, log) => {
    console.log("\n=== Generating next research directions ===");
    
    // Process all iterations that have learnings
    let iterationsToProcess = state.iterations
      .map((iteration, index) => ({ iteration, index }))
      .filter(({ iteration }) => 
        Array.isArray(iteration.learnings) && 
        iteration.learnings.length > 0 &&
        (!iteration.nextDirections || iteration.nextDirections.length === 0));
    
    console.log(`Found ${iterationsToProcess.length} iterations with learnings to generate directions for`);
    
    // If no iterations with learnings, fall back to using search results directly
    if (iterationsToProcess.length === 0) {
      console.log("No iterations without directions found. Skipping direction generation.");
      return state;
    }
    
    // Create steps for each iteration to process
    const processSteps = iterationsToProcess.map(({ iteration, index }) => 
      Fx.wrap(`generateDirectionsForIteration${index}`, async (currentState: ResearchState) => {
        try {
          console.log(`Generating directions based on: "${iteration.query}"`);
          
          // Define schema for directions
          const directionsSchemaObj = {
            type: "object",
            properties: {
              directions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "A specific follow-up question to research" },
                    reasoning: { type: "string", description: "Why this question is valuable for the research" },
                    priority: { type: "number", description: "Priority score (1-10)" },
                    researchGoal: { type: "string", description: "Detailed research goal explaining what to look for when pursuing this question" }
                  }
                }
              }
            }
          };
          
          // Format learnings for the prompt
          const learningsText = iteration.learnings
            .map((l, idx) => `[${idx+1}] ${l.insight} (Confidence: ${l.confidence}/10)`)
            .join('\n');
          
          // Generate directions using o3-mini
          const prompt = `Based on these learnings about "${state.userQuery}" from researching "${iteration.query}":
          
          ${learningsText}
          
          Suggest ${state.breadthParameter} new research directions that would deepen our understanding.
          For each direction:
          1. A specific question to research
          2. Your reasoning for why this is valuable
          3. A priority score (1-10)
          4. A detailed research goal that explains what to look for when pursuing this question
          
          Focus on questions that would yield the most valuable new information.`;
          
          // Define LLM call as a step that can be wrapped with concurrency
          const getLLMResponse = Fx.wrap("getLLMDirectionsResponse", async (_: any) => {
            return await llm(prompt, directionsSchemaObj);
          });
          
          // Apply concurrency to the LLM call
          const concurrentGetLLMResponse = Fx.concurrency(getLLMResponse, ConcurrencyLimit);
          
          // Get the LLM response with concurrency control
          const result = await concurrentGetLLMResponse({}, log);
          
          // Limit to breadth parameter
          const directions = result.directions
            .slice(0, state.breadthParameter)
            .map((d: any) => ({
              question: d.question,
              reasoning: d.reasoning,
              priority: d.priority,
              researchGoal: d.researchGoal
            }));
          
          console.log(`Generated ${directions.length} directions for iteration ${index}`);
          
          // Update state immutably using Fx.update
          return await Fx.update<ResearchState, ResearchIteration[]>(
            'iterations',
            (iterations) => iterations.map((iter, idx) => 
              idx === index 
                ? { ...iter, nextDirections: directions }
                : iter
            )
          )(currentState, log);
          
        } catch (error) {
          console.error(`Error generating directions for iteration ${index}:`, error);
          // Skip this iteration but continue with others
          return currentState;
        }
      })
    );
    
    // Process all steps in sequence using the library's functional composition
    const updatedState = await Fx.sequence(...processSteps)(state, log);
    
    // Debug output to show updated state
    console.log("\n=== After generating directions ===");
    let totalDirections = 0;
    updatedState.iterations.forEach((iter, idx) => {
      const directionsCount = Array.isArray(iter.nextDirections) ? iter.nextDirections.length : 0;
      totalDirections += directionsCount;
      console.log(`Iteration ${idx}: Query "${iter.query}" has ${directionsCount} directions`);
    });
    console.log(`Total directions across all iterations: ${totalDirections}`);
    
    return updatedState;
  });

// Helper function to generate default directions when no valid iterations exist
const generateDefaultDirections = async (state: ResearchState, log: any): Promise<ResearchState> => {
  console.log("Generating default directions based on the original user query");
  
  // Find an iteration to add directions to - preferably one without directions already
  const targetIndex = state.iterations.findIndex(it => 
    !Array.isArray(it.nextDirections) || it.nextDirections.length === 0
  );
  
  // Use first iteration if none found without directions
  const index = targetIndex >= 0 ? targetIndex : 0;
  
  // Generate some default directions based on the user query
  const defaultDirections: Direction[] = [
    {
      question: `What are the most important aspects of ${state.userQuery}?`,
      reasoning: "We need to identify the key components of the topic",
      priority: 8
    },
    {
      question: `What are the latest developments in ${state.userQuery}?`,
      reasoning: "Recent information is valuable for understanding current state",
      priority: 7
    },
    {
      question: `What problems or challenges exist with ${state.userQuery}?`,
      reasoning: "Understanding limitations helps form a balanced view",
      priority: 6
    }
  ];
  
  // Update state with default directions
  return await Fx.set<ResearchState, Direction[]>(
    ['iterations', index, 'nextDirections'],
    defaultDirections
  )(state, log);
};

// Prioritize and select the next batch of queries
const selectNextQueries: Step<ResearchState> = 
  Fx.wrap("selectNextQueries", async (state, log) => {
    // Check depth limit
    const isMaxDepthReached = (s: ResearchState): boolean => 
      s.currentDepth >= s.depthParameter - 1;
    
    // Check if we have directions
    const hasNoDirections = (s: ResearchState): boolean => 
      !s.iterations.some(it => Array.isArray(it.nextDirections) && it.nextDirections.length > 0);
    
    // Handle max depth case
    if (isMaxDepthReached(state)) {
      console.log(`Reached maximum depth (${state.currentDepth + 1}/${state.depthParameter}). Research complete.`);
      return await Fx.set<ResearchState, boolean>('isComplete', true)(state, log);
    }
    
    console.log(`\n=== Selecting next research queries (Depth ${state.currentDepth + 1}/${state.depthParameter}) ===`);
    
    // Handle no directions case
    if (hasNoDirections(state)) {
      throw new Error("No iterations with directions found. Cannot select next queries.");
    }
    
    // Get all directions from iterations
    const getAllDirections = (s: ResearchState): { direction: Direction; sourceQuery: string }[] => {
      // Get all iterations with nextDirections
      const iterationsWithDirections = s.iterations.filter(
        it => it && Array.isArray(it.nextDirections) && it.nextDirections.length > 0
      );
      
      // Collect and flatten all directions
      return iterationsWithDirections.flatMap(iteration => 
        iteration.nextDirections.map(dir => ({
          direction: dir,
          sourceQuery: iteration.query
        }))
      );
    };
    
    // Sort and select top directions
    const selectTopDirections = (
      directions: { direction: Direction; sourceQuery: string }[],
      breadthParam: number
    ): { direction: Direction; sourceQuery: string }[] => {
      // Sort by priority (descending)
      const sorted = [...directions].sort((a, b) => 
        b.direction.priority - a.direction.priority
      );
      
      // Take top N based on breadth parameter
      const breadth = Math.max(1, Math.min(breadthParam, 3)); // Ensure breadth is between 1-3
      return sorted.slice(0, breadth);
    };
    
    // Get all directions and select top ones
    const allDirections = getAllDirections(state);
    console.log(`Collected ${allDirections.length} total directions`);
    
    if (allDirections.length === 0) {
      throw new Error("No valid directions found after filtering. Cannot proceed with research.");
    }
    
    const selectedDirections = selectTopDirections(allDirections, state.breadthParameter);
    
    // Print selection summary
    console.log(`Selected ${selectedDirections.length} next queries:`);
    selectedDirections.forEach((d, i) => {
      console.log(`${i+1}. "${d.direction.question}" (Priority: ${d.direction.priority})`);
      console.log(`   Based on: "${d.sourceQuery}"`);
    });
    
    // Create new iterations for the next depth
    const newIterations = selectedDirections.map(d => ({
      query: d.direction.question,
      searchResults: [],
      learnings: [],
      nextDirections: []
    }));
    
    console.log(`Created ${newIterations.length} new iterations for depth ${state.currentDepth + 1}`);
    
    // Multiple state updates in sequence
    return await Fx.sequence(
      // Add new iterations
      Fx.update<ResearchState, ResearchIteration[]>(
        'iterations', 
        (currentIterations) => [...currentIterations, ...newIterations]
      ),
      // Increment depth counter
      Fx.update<ResearchState, number>(
        'currentDepth',
        (depth) => depth + 1
      ),
      // Reset breadth counter
      Fx.set<ResearchState, number>('currentBreadth', 0)
    )(state, log);
  });

// Generate final research report
const generateReport: Step<ResearchState> = 
  Fx.wrap("generateReport", async (state, log) => {
    console.log("\n=== Generating final research report ===");
    
    // Check if we have any findings
    const hasFindings = state.iterations.some(it => 
      Array.isArray(it.learnings) && it.learnings.length > 0
    );
    
    // Check if we have any search results at all
    const hasSearchResults = state.iterations.some(it => 
      Array.isArray(it.searchResults) && it.searchResults.length > 0
    );
    
    // Skip if no data
    if (!hasFindings && !hasSearchResults) {
      console.log("No research findings or search results to report.");
      return await Fx.set<ResearchState, string>(
        'finalReport',
        "No research was conducted."
      )(state, log);
    }
    
    // Collect all learnings from all iterations
    const allLearnings = state.iterations
      .filter(it => Array.isArray(it.learnings) && it.learnings.length > 0)
      .flatMap(it => it.learnings.map(l => ({
        insight: l.insight,
        source: l.source,
        confidence: l.confidence,
        category: l.category || "Uncategorized",
        entities: l.entities || [],
        query: it.query
      })));
    
    // Group learnings by category for better organization
    const learningsByCategory = allLearnings.reduce((acc, learning) => {
      const category = learning.category || "Uncategorized";
      if (!acc[category]) acc[category] = [];
      acc[category].push(learning);
      return acc;
    }, {} as Record<string, typeof allLearnings>);
    
    // Format learnings for the report in a structured way by category
    const formattedLearningsByCategory = Object.entries(learningsByCategory)
      .map(([category, learnings]) => 
        `## ${category} Findings\n\n${
          learnings.map(l => 
            `- **Insight**: ${l.insight}\n  - **Source**: ${l.source}\n  - **Query**: ${l.query}\n  - **Confidence**: ${l.confidence}/10\n  - **Key Entities**: ${l.entities?.join(', ') || 'None'}\n`
          ).join('\n')
        }`
      ).join('\n\n');
    
    try {
      // Define the schema for a comprehensive report structure using Zod
      const ReportSectionsSchema = z.object({
        introduction: z.string().min(100),
        coreAnalysis: z.string().min(100),
        technicalDetails: z.string().min(100),
        comparisons: z.string().min(100),
        trendAnalysis: z.string().min(100),
        conclusionAndRecommendations: z.string().min(100)
      });
      
      // Create detailed prompt for the report
      const reportPrompt = `
You're tasked with creating a detailed, comprehensive research report on "${state.userQuery}" that synthesizes all the findings from extensive research.

## Original Research Query
${state.userQuery}

## Research Methodology
- This report is based on ${state.iterations.length} research iterations
- Covering ${state.currentDepth} levels of recursive exploration
- Examining ${state.visitedUrls.length} distinct sources
- Extracting ${allLearnings.length} key insights

## Raw Research Findings (Grouped by Category)
${formattedLearningsByCategory}

## Report Instructions
1. Create a professional, in-depth report that synthesizes ALL research findings
2. Structure your report with these specific sections:
   - introduction: Executive summary and introduction to the topic
   - coreAnalysis: In-depth analysis of the main topic and key concepts
   - technicalDetails: Technical aspects with specifics on implementation and architecture
   - comparisons: Comparative analysis of different approaches/products
   - trendAnalysis: Analysis of emerging trends and future directions
   - conclusionAndRecommendations: Synthesis with actionable insights and recommendations

3. Important requirements:
   - Maintain academic/professional tone
   - Include ALL insights from the research findings
   - Synthesize information across sources (don't just list findings)
   - Add specific technical details where available
   - Provide comparative analysis when multiple options exist
   - Include examples and use cases where appropriate
   - Structure with meaningful section headings and subheadings
   - Minimum 100 words per section

## Response Format
Return a JSON object with the six sections specified above. For example:
{
  "introduction": "Text here...",
  "coreAnalysis": "Text here...",
  "technicalDetails": "Text here...",
  "comparisons": "Text here...",
  "trendAnalysis": "Text here...",
  "conclusionAndRecommendations": "Text here..."
}`;

      // Use GPT-4o for high-quality report generation
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { 
            role: "system", 
            content: "You are a professional research analyst who creates comprehensive, structured reports from research findings. Your reports are thorough, analytical, and insightful, going beyond merely summarizing to provide deep synthesis and valuable conclusions. You output only valid JSON." 
          },
          { role: "user", content: reportPrompt }
        ],
      });
      
      const content = response.choices[0].message.content ?? "{}";
      
      // Log the event using framework pattern
      const stateAfterPrompt = await Fx.prompt<ResearchState>(
        "generateFinalReport",
        () => reportPrompt,
        async () => content
      )(state, log);
      
      // Parse and validate the response against the schema
      let reportData;
      try {
        const parsedData = JSON.parse(content);
        reportData = ReportSectionsSchema.parse(parsedData);
      } catch (error) {
        console.error("Failed to parse or validate report structure:", error);
        throw new Error("Failed to generate valid report structure");
      }
      
      // Compose the final report by combining all sections
      const reportMarkdown = `
# Comprehensive Research Report: ${state.userQuery}

## Executive Summary

${reportData.introduction}

---

## Core Analysis

${reportData.coreAnalysis}

---

## Technical Details

${reportData.technicalDetails}

---

## Comparative Analysis

${reportData.comparisons}

---

## Trends and Future Directions

${reportData.trendAnalysis}

---

## Conclusions and Recommendations

${reportData.conclusionAndRecommendations}

---

## Research Methodology

This report was generated through a recursive research process with:
- ${state.iterations.length} total research iterations
- ${state.currentDepth} levels of recursive depth
- ${allLearnings.length} insights extracted
- ${state.visitedUrls.length} unique sources analyzed

---

## Sources

${state.visitedUrls?.map(url => `- ${url}`).join('\n') || 'No source URLs available'}
`;
      
      console.log(`Report generated (${reportMarkdown.length} characters)`);
      
      // Final state updates using framework's set pattern
      return await Fx.set<ResearchState, string>(
        'finalReport',
        reportMarkdown
      )({
        ...stateAfterPrompt,
        isComplete: true
      }, log);
      
    } catch (error) {
      console.error("Critical error generating structured report:", error);
      
      // Instead of falling back, propagate the error so we can fix the issue
      throw new Error(`Failed to generate report: ${(error as Error).message}`);
    }
  });

//-----------------------------------------------------------------------
// 6. Core research workflow  ───────────────────────────────────────────
// One iteration of the research cycle using function composition
const researchIteration: Step<ResearchState> = Fx.wrap(
  "researchIteration", 
  async (state, log) => {
    console.log(`\n=== RESEARCH ITERATION: Depth ${state.currentDepth + 1}/${state.depthParameter} ===`);
    
    // Mark research as complete - direct Fx.set reference for clean functional composition
    const markComplete = Fx.set<ResearchState, boolean>('isComplete', true);
    
    // Step 1: Web Search - Using function composition with focus
    const performWebSearch = Fx.wrap<ResearchState>("performWebSearch", async (s: ResearchState, l) => {
      try {
        console.log("\n=== Step 1: Web Search ===");
        // Execute the web search directly
        const afterSearchState = await searchWeb(s, l);
        console.log(`\nAfter searchWeb: State has ${afterSearchState.iterations.length} iterations`);
        
        // Check if we have any search results
        const hasSearchResults = afterSearchState.iterations.some(it => 
          Array.isArray(it.searchResults) && it.searchResults.length > 0
        );
        
        if (!hasSearchResults) {
          console.warn("No search results found in any iteration. Cannot continue research cycle.");
          return markComplete(afterSearchState, l);
        }
        
        return afterSearchState;
      } catch (error) {
        console.error(`Error in web search: ${(error as Error).message}`);
        return markComplete(s, l);
      }
    });
    
    // Step 2: Extract Learnings - pure function using lenses
    const performLearningExtraction = Fx.wrap<ResearchState>("performLearningExtraction", async (s: ResearchState, l) => {
      try {
        console.log("\n=== Step 2: Extract Learnings ===");
        return await extractLearnings(s, l);
      } catch (error) {
        console.error(`Error in extractLearnings: ${(error as Error).message}`);
        console.log("Continuing with current state without extracting learnings");
        return s;
      }
    });
    
    // Step 3: Generate Next Directions - with functional recovery
    const performDirectionGeneration = Fx.wrap<ResearchState>("performDirectionGeneration", async (s: ResearchState, l) => {
      try {
        console.log("\n=== Step 3: Generate Next Directions ===");
        const stateWithDirections = await generateNextDirections(s, l);
        
        // Check if we have any directions using a pure function
        const hasDirections = stateWithDirections.iterations.some(it => 
          Array.isArray(it.nextDirections) && it.nextDirections.length > 0
        );
        
        if (!hasDirections) {
          console.warn("No directions generated. Attempting to generate default directions.");
          return await generateDefaultDirections(s, l);
        }
        
        return stateWithDirections;
      } catch (error) {
        console.error(`Error in generateNextDirections: ${(error as Error).message}`);
        console.log("Generating default directions instead");
        return await generateDefaultDirections(s, l);
      }
    });
    
    // Step 4: Select Next Queries
    const performQuerySelection = Fx.wrap<ResearchState>("performQuerySelection", async (s: ResearchState, l) => {
      // Final check for directions before selection - pure function
      const hasDirections = s.iterations.some((it: ResearchIteration) => 
        Array.isArray(it.nextDirections) && it.nextDirections.length > 0
      );
      
      if (!hasDirections) {
        console.warn("No directions available after recovery attempts. Ending research cycle.");
        return markComplete(s, l);
      }
      
      try {
        console.log("\n=== Step 4: Select Next Queries ===");
        return await selectNextQueries(s, l);
      } catch (error) {
        console.error(`Error in selectNextQueries: ${(error as Error).message}`);
        console.log("Cannot select next queries. Ending research cycle.");
        return markComplete(s, l);
      }
    });
    
    // Compose the research steps using Fx.sequence for functional composition
    try {
      // This uses function composition to build a pipeline that processes state
      // Each step receives the output of the previous step
      return await Fx.sequence(
        performWebSearch,
        performLearningExtraction,
        performDirectionGeneration,
        performQuerySelection
      )(state, log);
    } catch (error) {
      // Catastrophic error in the workflow
      console.error(`Critical error in research workflow: ${(error as Error).message}`);
      console.error(`Stack trace: ${(error as Error).stack}`);
      
      // Mark research as complete to avoid infinite loops on persistent errors
      return markComplete(state, log);
    }
  }
);

// Main workflow
export const recursiveResearchAgent = Fx.agent<ResearchState>(
  "RecursiveResearchAgent",
  Fx.wrap("researchWorkflow", async (state, log) => {
    console.log(`\n=== Starting Research Process on: "${state.userQuery}" ===`);
    console.log(`Parameters: Breadth=${state.breadthParameter}, Depth=${state.depthParameter}`);
    
    // Validate initial state
    if (!state.userQuery) {
      throw new Error("Invalid state: userQuery is required");
    }
    
    if (!Array.isArray(state.iterations)) {
      throw new Error("Invalid state: iterations must be an array");
    }
    
    // Initial query generation function
    const generateInitialQueriesIfNeeded = async (s: ResearchState): Promise<ResearchState> => {
      // Check if we need initial queries
      if (s.iterations.length === 0) {
        return await generateSearchQueries(s, log);
      }
      return s;
    };
    
    // Research workflow steps in sequence:
    // 1. Generate initial queries if needed
    const initializedState = await generateInitialQueriesIfNeeded(state);
    
    // 2. Execute research iterations until complete
    const researchedState = await Fx.loopWhile<ResearchState>(
      s => !s.isComplete,
      researchIteration
    )(initializedState, log);
    
    // 3. Generate final report
    return await generateReport(researchedState, log);
  })
);

//-----------------------------------------------------------------------
// 7. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Initial state - immutable object
  const seed: Readonly<ResearchState> = {
    userQuery: "What are the latest AI agent frameworks? And what are the latest trends in AI agent frameworks?",
    breadthParameter: 5,  // Increase from 3 to 5 for wider exploration
    depthParameter: 4,    // Increase from 3 to 4 for deeper research
    iterations: [],       // Will be initialized properly by the agent
    currentDepth: 0,
    currentBreadth: 0,
    isComplete: false,
    visitedUrls: []       // Track visited URLs for the report
  };
  
  // Set up progress tracking
  
  // Set up debug logging
  Fx.debug((ev) => {
    const timestamp = new Date(ev.ts).toLocaleTimeString();
    
    if (ev.name.includes('extract') || ev.name.includes('generate') || ev.name.includes('propose')) {
      if (ev.meta?.rep) {
        const preview = (ev.meta.rep as string).substring(0, 50);
        console.log(`[${timestamp}] LLM: ${ev.name} response: ${preview}...`);
      }
    } else if (ev.name === 'web_search') {
      console.log(`[${timestamp}] SEARCH: Web search for "${ev.args?.[0] || 'unknown query'}"`);
    }
  });
  
  console.log("=== Recursive Research Agent with Firecrawl ===");
  console.log(`Topic: "${seed.userQuery}"`);
  console.log(`Parameters: Breadth=${seed.breadthParameter}, Depth=${seed.depthParameter}`);
  console.log("=================================");
  
  // Run the agent
  Fx.spawn(recursiveResearchAgent, seed)
    .then(async final => {
      console.log("\n=== FINAL RESEARCH REPORT ===");
      console.log(final.finalReport || "No research report was generated.");
      
      // Save report to a Markdown file
      if (final.finalReport) {
        try {
          const filePath = await saveReportToFile(final.finalReport, final.userQuery);
          console.log(`\n✅ Report saved to: ${filePath}`);
        } catch (error) {
          console.error("Error saving report to file:", error);
        }
      }
      
      // Statistics
      const countIterations = final.iterations.length;
      const countLearnings = final.iterations.reduce((sum, it) => {
        const learningCount = Array.isArray(it?.learnings) ? it.learnings.length : 0;
        return sum + learningCount;
      }, 0);
      const countUrls = final.visitedUrls?.length || 0;
      
      console.log(`\n=== Research Statistics ===`);
      console.log(`- Total queries explored: ${countIterations}`);
      console.log(`- Total insights gathered: ${countLearnings}`);
      console.log(`- Total sources referenced: ${countUrls}`);
      console.log(`- Research depth achieved: ${final.currentDepth}`);
    })
    .catch(err => {
      console.error("\nERROR in recursive research agent:", err);
      process.exitCode = 1;
    });
}

// Save research report to file function
async function saveReportToFile(report: string, query: string): Promise<string> {
  // Create a filename from the query
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedQuery = query.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  const filename = `research_report_${sanitizedQuery}_${timestamp}.md`;
  
  // Ensure reports directory exists
  const reportsDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  
  // Save the report
  const filePath = path.join(reportsDir, filename);
  await fs.writeFile(filePath, report);
  
  return filePath;
}