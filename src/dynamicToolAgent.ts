// dynamicToolAgent.ts - Example of an agent that discovers and uses tools at runtime
//-----------------------------------------------------------------------
// 0. deps  ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import Fx from "./index";
import { z } from "zod";
import OpenAI from "openai";

// Define Step type
type Step<S> = (state: Readonly<S>, log: any) => Promise<S> | S;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function llm(prompt: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0].message.content ?? "";
}

//-----------------------------------------------------------------------
// 1. Domain state  ─────────────────────────────────────────────────────
interface Tool {
  name: string;
  description: string;
  parameters: string[];
}

interface ProblemSolvingState {
  problem: string;
  availableTools: Tool[];
  insights: string[];
  solution?: string;
  toolHistory: Array<{
    toolName: string;
    params: unknown[];
    result: string;
  }>;
  status: 'analyzing' | 'solving' | 'complete';
}

//-----------------------------------------------------------------------
// 2. Register available tools with Zod schemas ─────────────────────────
// Weather API tool
Fx.registerTool<ProblemSolvingState, z.ZodTuple<[z.ZodString]>>(
  "getWeather",
  z.tuple([z.string()]),
  (location: string) => async (state) => {
    console.log(`🌤️ Getting weather for ${location}`);
    // Simulate API call
    const weather = {
      "New York": "Sunny, 72°F",
      "London": "Rainy, 60°F",
      "Tokyo": "Cloudy, 65°F",
      "Sydney": "Clear, 80°F"
    }[location] || "Unknown location";
    
    return {
      ...state,
      toolHistory: [
        ...state.toolHistory,
        { toolName: "getWeather", params: [location], result: weather }
      ]
    };
  }
);

// Calculator tool
Fx.registerTool<ProblemSolvingState, z.ZodTuple<[z.ZodString]>>(
  "calculate",
  z.tuple([z.string()]),
  (expression: string) => (state) => {
    console.log(`🧮 Calculating: ${expression}`);
    // Simple and safe evaluation using Function constructor with only math operations
    // In production, use a proper math expression evaluator
    let result: string;
    try {
      // Sanitize input to only allow mathematical operations
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error("Invalid expression");
      }
      result = String(new Function(`return ${expression}`)());
    } catch (error) {
      result = `Error: Could not calculate "${expression}"`;
    }
    
    return {
      ...state,
      toolHistory: [
        ...state.toolHistory,
        { toolName: "calculate", params: [expression], result }
      ]
    };
  }
);

// Database lookup tool
Fx.registerTool<ProblemSolvingState, z.ZodTuple<[z.ZodString]>>(
  "databaseLookup",
  z.tuple([z.string()]),
  (query: string) => (state) => {
    console.log(`🔍 Database lookup: ${query}`);
    // Mock database with simple key-value pairs
    const database = {
      "product-123": "Smartphone, price: $999, stock: 30 units",
      "customer-456": "Name: Jane Doe, Tier: Premium, Since: 2020",
      "order-789": "Status: Shipped, Items: 3, Total: $1,299",
      "tax-ny": "New York sales tax: 8.875%"
    };
    
    const result = query in database 
      ? database[query as keyof typeof database] 
      : `No results found for "${query}"`;
    
    return {
      ...state,
      toolHistory: [
        ...state.toolHistory,
        { toolName: "databaseLookup", params: [query], result }
      ]
    };
  }
);

//-----------------------------------------------------------------------
// 3. Tools for updating the state  ───────────────────────────────────── 
const addInsight = (insight: string): Step<ProblemSolvingState> => 
  Fx.action<ProblemSolvingState, [string]>("addInsight", 
    (text: string) => (state) => ({
      ...state,
      insights: [...state.insights, text]
    })
  )(insight);

const setSolution = (solution: string): Step<ProblemSolvingState> => 
  Fx.action<ProblemSolvingState, [string]>("setSolution", 
    (text: string) => (state) => ({
      ...state,
      solution: text,
      status: 'complete'
    })
  )(solution);

//-----------------------------------------------------------------------
// 4. Tool discovery and execution  ─────────────────────────────────────
// Parse LLM tool call request
const parseLLMToolRequest = (response: string): { toolName: string, params: string[] } | null => {
  // Extract tool call using regex pattern
  const toolCallPattern = /USE_TOOL\[([\w]+)\]\((.*?)\)/;
  const match = response.match(toolCallPattern);
  
  if (!match) return null;
  
  const toolName = match[1];
  // Split parameters by comma, handling quoted strings properly
  const paramsText = match[2];
  const params: string[] = [];
  
  // Simple parser for comma-separated parameters
  let currentParam = '';
  let inQuotes = false;
  
  for (let i = 0; i < paramsText.length; i++) {
    const char = paramsText[i];
    
    if (char === '"' && (i === 0 || paramsText[i-1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      params.push(currentParam.trim());
      currentParam = '';
    } else {
      currentParam += char;
    }
  }
  
  if (currentParam.trim()) {
    params.push(currentParam.trim());
  }
  
  // Clean up quotes from parameters
  return {
    toolName,
    params: params.map(p => {
      if (p.startsWith('"') && p.endsWith('"')) {
        return p.slice(1, -1);
      }
      return p;
    })
  };
};

// Dynamic tool execution based on LLM request
const executeTool = (response: string): Step<ProblemSolvingState> => 
  Fx.wrap<ProblemSolvingState>("dynamicToolExecution", async (state, log) => {
    const toolRequest = parseLLMToolRequest(response);
    
    if (!toolRequest) {
      console.log("No tool call detected");
      return state;
    }
    
    const { toolName, params } = toolRequest;
    console.log(`Executing tool: ${toolName} with params:`, params);
    
    try {
      return await Fx.callTool<ProblemSolvingState>(toolName, params)(state, log);
    } catch (error) {
      console.error(`Failed to execute tool ${toolName}:`, error);
      return {
        ...state,
        toolHistory: [
          ...state.toolHistory,
          { 
            toolName, 
            params, 
            result: `Error: Tool execution failed - ${(error as Error).message}` 
          }
        ]
      };
    }
  });

//-----------------------------------------------------------------------
// 5. Agent reasoning flow  ───────────────────────────────────────────── 
const analyzeProblem: Step<ProblemSolvingState> = 
  Fx.wrap<ProblemSolvingState>("analyzeProblem", async (state, log) => {
    // Build comprehensive system message about available tools
    const toolDescriptions = state.availableTools
      .map(t => `${t.name}: ${t.description} | Parameters: ${t.parameters.join(', ')}`)
      .join('\n');
    
    const systemMessage = `You are a problem-solving agent with access to the following tools:
${toolDescriptions}

To use a tool, format your response like this: USE_TOOL[toolName](param1, param2, ...)
Example: USE_TOOL[calculate](2 * 3.14)
Example: USE_TOOL[databaseLookup](product-123)

Current problem: ${state.problem}

IMPORTANT: When using databaseLookup, you must use one of the exact keys mentioned in the parameters.

Review the problem and decide if you need any tools to gather data. Only request tools when necessary.`;

    // Use promptAndExtract to get agent's analysis
    const [updatedState, response] = await Fx.promptAndExtract<ProblemSolvingState>(
      "agentAnalysis",
      () => systemMessage,
      llm
    )(state, log);
    
    if (parseLLMToolRequest(response)) {
      // Agent wants to use a tool, execute it
      return executeTool(response)(updatedState, log);
    } else {
      // Agent provided an insight directly
      return addInsight(response)(updatedState, log);
    }
  });

const solveWithTools: Step<ProblemSolvingState> = 
  Fx.wrap<ProblemSolvingState>("solveWithTools", async (state, log) => {
    // Exit early if already complete
    if (state.status === 'complete') return state;
    
    // Build context from tool history
    const toolHistory = state.toolHistory.map(
      h => `Tool: ${h.toolName}(${h.params.join(', ')})\nResult: ${h.result}`
    ).join('\n\n');
    
    // Build insights summary
    const insights = state.insights.join('\n• ');
    
    const promptText = `Problem: ${state.problem}

Available tools:
${state.availableTools.map(t => t.name).join(', ')}

Tool usage history:
${toolHistory}

Your insights so far:
• ${insights}

Based on the above information, do you need more data from any tools? If so, use USE_TOOL[toolName](params) format.
If you have enough information, provide a final solution.`;

    // Use promptAndExtract to get the agent's next step
    const [updatedState, response] = await Fx.promptAndExtract<ProblemSolvingState>(
      "agentDecision",
      () => promptText,
      llm
    )(state, log);
    
    const toolRequest = parseLLMToolRequest(response);
    
    if (toolRequest) {
      // Agent wants more data, execute the tool
      const afterToolState = await executeTool(response)(updatedState, log);
      
      // Continue the loop - more tools might be needed
      return { ...afterToolState, status: 'solving' };
    } else {
      // Agent provided a solution
      return setSolution(response)(updatedState, log);
    }
  });

//-----------------------------------------------------------------------
// 6. Dynamic tool discovery agent  ─────────────────────────────────────
const dynamicAgent = Fx.agent<ProblemSolvingState>(
  "DynamicToolAgent",
  Fx.sequence(
    // Determine which tools are needed and gather info
    Fx.action<ProblemSolvingState, []>("beginAnalysis", 
      () => (state) => ({ ...state, status: 'analyzing' })
    )(),
    analyzeProblem,
    
    // Set status to solving
    Fx.action<ProblemSolvingState, []>("beginSolving", 
      () => (state) => ({ ...state, status: 'solving' })
    )(),
    
    // Loop until we have a solution
    Fx.loopWhile<ProblemSolvingState>(
      state => state.status !== 'complete',
      solveWithTools
    )
  )
);

//-----------------------------------------------------------------------
// 7. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Initial state with available tools
  const initialState: ProblemSolvingState = {
    problem: "Calculate the total cost of ordering 5 smartphones (product-123) for our New York office, including tax (tax-ny).",
    availableTools: [
      {
        name: "getWeather",
        description: "Get current weather for a location",
        parameters: ["location (string)"]
      },
      {
        name: "calculate",
        description: "Perform mathematical calculations",
        parameters: ["expression (string)"]
      },
      {
        name: "databaseLookup",
        description: "Look up information in the database by exact key",
        parameters: ["key (one of: product-123, customer-456, order-789, tax-ny)"]
      }
    ],
    insights: [],
    toolHistory: [],
    status: 'analyzing'
  };

  // Enable debug logging
  Fx.debug((ev, state) => {
    const timestamp = new Date(ev.ts).toLocaleTimeString();
    console.log(`[${timestamp}] Event: ${ev.name}`);
    
    if (ev.name.includes("dynamicToolExecution")) {
      const s = state as ProblemSolvingState;
      const lastTool = s.toolHistory[s.toolHistory.length - 1];
      if (lastTool) {
        console.log(`Tool result: ${lastTool.result}`);
      }
    }
  });

  console.log("\n=== Dynamic Tool Agent Demo ===");
  console.log(`Problem: ${initialState.problem}`);
  console.log("================================\n");

  // Run the agent
  Fx.spawn(dynamicAgent, initialState)
    .then(finalState => {
      console.log("\n=== Solution ===");
      console.log(finalState.solution);
      console.log("\n=== Tools Used ===");
      finalState.toolHistory.forEach((t, i) => {
        console.log(`${i+1}. ${t.toolName}(${t.params.join(', ')})`);
        console.log(`   Result: ${t.result}`);
      });
    })
    .catch(err => {
      console.error("ERROR:", err);
    });
} 