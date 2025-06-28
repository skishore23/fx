// tinyAgent.ts - A minimal MCP-inspired agent in under 100 lines
//-----------------------------------------------------------------------
// 0. deps  ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import Fx from "./index";
import { z } from "zod";
import OpenAI from "openai";
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources";

// Define Step type
type Step<S> = (state: Readonly<S>, log: any) => Promise<S> | S;

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

//-----------------------------------------------------------------------
// 1. Domain state and types  ───────────────────────────────────────────
interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    result: string;
  }>;
}

interface AgentState {
  messages: AgentMessage[];
  maxTurns: number;
  currentTurn: number;
  complete: boolean;
}

//-----------------------------------------------------------------------
// 2. Register tools with Zod schemas  ───────────────────────────────────
// Weather API tool
Fx.registerTool<AgentState, z.ZodTuple<[z.ZodString]>>(
  "get_weather",
  z.tuple([z.string()]),
  (location: string) => (state) => {
    console.log(`🌤️ Getting weather for ${location}`);
    // Simulate API call
    const weather = {
      "New York": "Sunny, 72°F",
      "London": "Rainy, 60°F",
      "Tokyo": "Cloudy, 65°F",
      "Sydney": "Clear, 80°F"
    }[location] || "Weather not available for this location";
    
    // Return the result immediately 
    return state;
  }
);

// Calculator tool
Fx.registerTool<AgentState, z.ZodTuple<[z.ZodString]>>(
  "calculate",
  z.tuple([z.string()]),
  (expression: string) => (state) => {
    console.log(`🧮 Calculating: ${expression}`);
    // Simple and safe evaluation
    try {
      // Sanitize input to only allow mathematical operations
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error("Invalid expression");
      }
      return state;
    } catch (error) {
      return state;
    }
  }
);

// Task completion tool
Fx.registerTool<AgentState, z.ZodTuple<[]>>(
  "task_complete",
  z.tuple([]),
  () => (state) => ({
    ...state,
    complete: true
  })
);

//-----------------------------------------------------------------------
// 3. Helper functions for LLM and conversation  ─────────────────────────
// Add a helper function to get registered tools from the MCP registry
// This should be placed before the callLLM function
const getRegisteredTools = (): ChatCompletionTool[] => {
  // In a production implementation, we would dynamically introspect the MCP registry
  // For now, we'll return the tools we know are registered
  return [
    {
      type: "function" as const,
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "City name, e.g. 'New York', 'London'"
            }
          },
          required: ["location"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "calculate",
        description: "Perform a calculation",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "A mathematical expression to evaluate, e.g. '2 + 2'"
            }
          },
          required: ["expression"]
        }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "task_complete",
        description: "Call this tool when the task given by the user is complete",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    }
  ];
};

// Update the callLLM function to use the getRegisteredTools helper
const callLLM = async (state: AgentState): Promise<{
  content?: string;
  toolCalls?: Array<{id: string; name: string; args: Record<string, any>}>;
}> => {
  // Convert our agent messages to OpenAI message format
  const messages: ChatCompletionMessageParam[] = [];
  
  for (const msg of state.messages) {
    if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
      const baseMsg = {
        role: msg.role,
        content: msg.content
      };
      
      // Add tool calls if present
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // For assistant messages with tool calls, we need to handle them specially
        if (msg.role === 'assistant') {
          const openAIMsg = {
            ...baseMsg,
            tool_calls: msg.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.args)
              }
            }))
          };
          messages.push(openAIMsg);
          
          // Add tool results as separate messages
          if (msg.toolResults) {
            for (const result of msg.toolResults) {
              messages.push({
                role: 'tool' as const,
                content: result.result,
                tool_call_id: result.toolCallId
              });
            }
          }
        } else {
          // For non-assistant messages, just use the content
          messages.push(baseMsg);
        }
      } else {
        messages.push(baseMsg);
      }
    }
  }
  
  // Get available tools from registry with proper types
  const tools = getRegisteredTools();

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      messages: messages,
      tools: tools,
      tool_choice: "auto"
    });

    const message = res.choices[0].message;
    return {
      content: message.content || undefined,
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments)
      }))
    };
  } catch (error) {
    console.error("LLM error:", error);
    return { content: "Error calling LLM. Please try again." };
  }
};

// Execute a tool and get the result
const executeTool = async (toolName: string, args: any): Promise<string> => {
  try {
    // Convert args object to array of values for our MCP registry
    const argsArray = Object.values(args);
    
    // Create a simple state to store the result
    let result = "";
    
    // Define handlers for different tools
    const handlers: Record<string, (args: any[]) => Promise<string>> = {
      "get_weather": async ([location]: string[]) => {
        console.log(`🌤️ Getting weather for ${location}`);
        const weather = {
          "New York": "Sunny, 72°F",
          "London": "Rainy, 60°F",
          "Tokyo": "Cloudy, 65°F",
          "Sydney": "Clear, 80°F"
        }[location] || "Weather not available for this location";
        return weather;
      },
      "calculate": async ([expression]: string[]) => {
        console.log(`🧮 Calculating: ${expression}`);
        try {
          if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
            throw new Error("Invalid expression");
          }
          return String(new Function(`return ${expression}`)());
        } catch (error) {
          return `Error: Could not calculate "${expression}"`;
        }
      },
      "task_complete": async () => "Task completed"
    };
    
    if (handlers[toolName]) {
      return await handlers[toolName](argsArray);
    }
    
    return `Error: Unknown tool '${toolName}'`;
  } catch (error) {
    return `Error executing tool: ${(error as Error).message}`;
  }
};

//-----------------------------------------------------------------------
// 4. Core agent step  ─────────────────────────────────────────────────── 
const agentStep: Step<AgentState> = 
  Fx.wrap<AgentState>("agentStep", async (state, log) => {
    // Return if we've reached max turns or task is complete
    if (state.complete || state.currentTurn >= state.maxTurns) {
      console.log("Task complete or max turns reached");
      return { ...state, complete: true };
    }

    console.log(`Processing agent step (turn ${state.currentTurn + 1}/${state.maxTurns})`);
    
    // Call LLM with conversation history
    const llmResponse = await callLLM(state);
    
    // No tool calls, just a regular message
    if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: 'assistant', content: llmResponse.content || "" }
        ],
        currentTurn: state.currentTurn + 1,
        complete: true // Assume task is complete if no tool calls
      };
    }

    // Process tool calls
    const assistantMessage: AgentMessage = { 
      role: 'assistant', 
      content: llmResponse.content || "",
      toolCalls: llmResponse.toolCalls,
      toolResults: []
    };

    // Execute each tool call and collect results
    for (const toolCall of llmResponse.toolCalls) {
      if (toolCall.name === 'task_complete') {
        // Just mark as complete, no need to execute
        return {
          ...state,
          messages: [
            ...state.messages,
            { ...assistantMessage, content: assistantMessage.content || "Task complete." }
          ],
          currentTurn: state.currentTurn + 1,
          complete: true
        };
      }

      // Execute the tool
      const result = await executeTool(toolCall.name, toolCall.args);
      
      // Add the result
      assistantMessage.toolResults = [
        ...(assistantMessage.toolResults || []),
        { toolCallId: toolCall.id, result }
      ];
    }

    // Update state with new message containing tool calls and results
    return {
      ...state,
      messages: [...state.messages, assistantMessage],
      currentTurn: state.currentTurn + 1
    };
  });

//-----------------------------------------------------------------------
// 5. Main agent loop ─────────────────────────────────────────────────── 
export const tinyAgent = Fx.agent<AgentState>(
  "TinyAgent",
  Fx.loopWhile<AgentState>(
    state => !state.complete,
    agentStep
  )
);

//-----------------------------------------------------------------------
// 6. Run demo if executed directly  ────────────────────────────────────
if (require.main === module) {
  // Initial state
  const initialState: AgentState = {
    messages: [
      { 
        role: 'system', 
        content: "You are a helpful assistant with access to tools. Use tools when appropriate. Always call task_complete when you're done."
      },
      { 
        role: 'user', 
        content: "What's the weather in New York? And also calculate 50 * 7." 
      }
    ],
    maxTurns: 10,
    currentTurn: 0,
    complete: false
  };

  // Enable debug logging
  Fx.debug((ev, state) => {
    const timestamp = new Date(ev.ts).toLocaleTimeString();
    console.log(`[${timestamp}] Event: ${ev.name}`);
    
    if (ev.name === 'agentStep') {
      const s = state as AgentState;
      const lastMessage = s.messages[s.messages.length - 1];
      if (lastMessage.role === 'assistant' && lastMessage.toolCalls) {
        console.log(`Using tools: ${lastMessage.toolCalls.map(tc => tc.name).join(', ')}`);
      }
    }
  });

  console.log("\n=== Tiny Agent Demo ===");
  console.log("User: What's the weather in New York? And also calculate 50 * 7.");
  console.log("======================\n");

  // Run the agent
  Fx.spawn(tinyAgent, initialState)
    .then(finalState => {
      console.log("\n=== Conversation ===");
      for (const msg of finalState.messages) {
        if (msg.role === 'user') {
          console.log(`User: ${msg.content}`);
        } else if (msg.role === 'assistant') {
          console.log(`Assistant: ${msg.content}`);
          
          // Show tool calls and results
          if (msg.toolCalls) {
            msg.toolCalls.forEach((tc, i) => {
              console.log(`  Tool Call: ${tc.name}(${JSON.stringify(tc.args)})`);
              if (msg.toolResults && msg.toolResults[i]) {
                console.log(`  Result: ${msg.toolResults[i].result}`);
              }
            });
          }
        }
      }
    })
    .catch(err => {
      console.error("ERROR:", err);
    });
} 