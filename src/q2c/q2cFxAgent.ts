import Fx from '../index';
import { z } from 'zod';
import { 
  Quote, 
  QuoteStatus,
  AgentActionType,
  ValidationSeverity,
  ValidationResult,
  Q2CAgentState
} from './types';
import { SalesforceAPI, createConnection, getToken, isLeft } from './salesforce';
import { validateQuote, standardRules, Combinators } from './rulesEngine';
import OpenAI from 'openai';
import * as E from 'fp-ts/Either';

// Type definitions for our agent
interface SlackContext {
  say: (args: any) => Promise<any>;
  threadTs?: string;
}

// Add these type definitions at the top with other interfaces
interface LLMResponse {
  intent: string;
  actionType: string;
  entities: Record<string, unknown>;
  infoType?: string;
  explanation: string;
}

interface PlanStep {
  id: string;
  description: string;
  tool: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  args: unknown[];
  result?: string;
  error?: string;
}

interface ExecutionPlan {
  steps: PlanStep[];
  reasoning: string;
}

// Core agent state
interface Q2CFxState {
  // User input and intent
  input: {
    raw: string;
    quoteId?: string;
    intent?: string;
    entities: Record<string, string | undefined>;
    infoType?: string;
  };
  
  // Conversation context
  conversation: {
    slack: SlackContext;
    threadTs?: string;
    messages: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
    }[];
  };
  
  // Plan and execution tracking
  execution: {
    plan?: ExecutionPlan;
    currentStepIndex?: number;
    isComplete: boolean;
    error?: string;
  };
  
  // Domain data (Salesforce)
  salesforce: {
    connection?: any;
    token?: any;
    quotes: Quote[];
    currentQuote?: Quote;
    validationResults?: ValidationResult[];
  };
}

// Initial state creator
const createInitialState = (
  message: string, 
  slack: SlackContext
): Q2CFxState => ({
  input: {
    raw: message,
    entities: {}
  },
  conversation: {
    slack,
    threadTs: slack.threadTs,
    messages: [
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      }
    ]
  },
  execution: {
    isComplete: false
  },
  salesforce: {
    quotes: []
  }
});

// Initialize OpenAI client
let openaiClient: OpenAI | null = null;
const getOpenAIClient = (): OpenAI => {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

// Tool: Send message to Slack
Fx.registerTool<Q2CFxState, z.ZodTuple<[z.ZodString]>>(
  "slack_message",
  z.tuple([z.string()]),
  (message: string) => async (state) => {
    if (!state.conversation.slack) {
      throw new Error("No Slack context available");
    }
    
    try {
      await state.conversation.slack.say({
        text: message,
        thread_ts: state.conversation.threadTs
      });
      
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages: [
            ...state.conversation.messages,
            {
              role: 'assistant',
              content: message,
              timestamp: new Date().toISOString()
            }
          ]
        }
      };
    } catch (error) {
      console.error("Error sending slack message:", error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Tool: Authenticate with Salesforce
Fx.registerTool<Q2CFxState, z.ZodTuple<[]>>(
  "authenticate_salesforce",
  z.tuple([]),
  () => async (state) => {
    try {
      const token = await getToken({
        clientId: process.env.SF_CLIENT_ID!,
        loginUrl: 'https://login.salesforce.com',
        subject: process.env.SF_USERNAME!
      });
      
      if (E.isLeft(token)) {
        throw new Error(`Authentication failed: ${token.left.message}`);
      }
      
      const connection = createConnection(token.right);
      
      return {
        ...state,
        salesforce: {
          ...state.salesforce,
          connection,
          token: token.right
        }
      };
    } catch (error) {
      console.error("Salesforce authentication error:", error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Salesforce authentication failed: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Tool: List Quotes
Fx.registerTool<Q2CFxState, z.ZodTuple<[]>>(
  "list_quotes",
  z.tuple([]),
  () => async (state) => {
    if (!state.salesforce.connection) {
      throw new Error("Not authenticated with Salesforce");
    }
    
    try {
      const quotes = await SalesforceAPI.listQuotes(state.salesforce.connection);
      
      return {
        ...state,
        salesforce: {
          ...state.salesforce,
          quotes
        }
      };
    } catch (error) {
      console.error("Error listing quotes:", error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Failed to list quotes: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Tool: Fetch Quote Details
Fx.registerTool<Q2CFxState, z.ZodTuple<[z.ZodString]>>(
  "fetch_quote",
  z.tuple([z.string()]),
  (quoteId: string) => async (state) => {
    if (!state.salesforce.connection) {
      throw new Error("Not authenticated with Salesforce");
    }
    
    try {
      const quote = await SalesforceAPI.fetchQuote(state.salesforce.connection, quoteId);
      
      // If infoType is line_items, also fetch line items
      if (state.input.infoType === 'line_items') {
        const lineItems = await SalesforceAPI.fetchQuoteLineItems(
          state.salesforce.connection, 
          quoteId
        );
        quote.lineItems = lineItems;
      }
      
      return {
        ...state,
        salesforce: {
          ...state.salesforce,
          currentQuote: quote
        }
      };
    } catch (error) {
      console.error(`Error fetching quote ${quoteId}:`, error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Failed to fetch quote: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Tool: Update Quote Status
Fx.registerTool<Q2CFxState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "update_quote_status",
  z.tuple([z.string(), z.string()]),
  (quoteId: string, status: string) => async (state) => {
    if (!state.salesforce.connection) {
      throw new Error("Not authenticated with Salesforce");
    }
    
    try {
      await SalesforceAPI.updateQuoteStatus(
        state.salesforce.connection, 
        quoteId, 
        status
      );
      
      // Verify the update was successful by fetching the quote again
      const updatedQuote = await SalesforceAPI.fetchQuote(
        state.salesforce.connection, 
        quoteId
      );
      
      return {
        ...state,
        salesforce: {
          ...state.salesforce,
          currentQuote: updatedQuote
        }
      };
    } catch (error) {
      console.error(`Error updating quote ${quoteId} status to ${status}:`, error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Failed to update quote status: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Tool: Validate Quote
Fx.registerTool<Q2CFxState, z.ZodTuple<[z.ZodString]>>(
  "validate_quote",
  z.tuple([z.string()]),
  (quoteId: string) => async (state) => {
    if (!state.salesforce.connection) {
      throw new Error("Not authenticated with Salesforce");
    }
    
    try {
      const quote = state.salesforce.currentQuote || 
                   await SalesforceAPI.fetchQuote(state.salesforce.connection, quoteId);
      
      const results = await validateQuote(standardRules)(quote);
      
      return {
        ...state,
        salesforce: {
          ...state.salesforce,
          currentQuote: quote,
          validationResults: results
        }
      };
    } catch (error) {
      console.error(`Error validating quote ${quoteId}:`, error);
      return {
        ...state,
        execution: {
          ...state.execution,
          error: `Failed to validate quote: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
);

// Step: Parse intent with LLM
const parseIntent = Fx.wrap<Q2CFxState>("parse_intent", async (state: Q2CFxState, log) => {
  const openai = getOpenAIClient();
  
  try {
    await Fx.callTool<Q2CFxState>("slack_message", 
      [`🔍 I'm analyzing your message: "${state.input.raw}"`]
    )(state, log);
    
    // Prepare prompt for intent detection
    const prompt = `
You are a Quote-to-Cash (Q2C) bot that analyzes Salesforce CPQ requests.
Based on the user message, determine the intent, action type, extract relevant entities, and identify the specific information type needed.

User message: "${state.input.raw}"

${state.salesforce.currentQuote ? `
Quote context:
- Name: ${state.salesforce.currentQuote.name}
- ID: ${state.salesforce.currentQuote.id}
- Status: ${state.salesforce.currentQuote.status}
- Amount: $${state.salesforce.currentQuote.amount}
- Created: ${state.salesforce.currentQuote.createdAt}
- Last Modified: ${state.salesforce.currentQuote.lastModifiedAt}
- Line Items: ${state.salesforce.currentQuote.lineItems.length} items
${state.salesforce.currentQuote.metadata?.endDate ? `- End Date/Expiration: ${new Date(state.salesforce.currentQuote.metadata.endDate as Date).toLocaleDateString()}` : ''}
` : ''}

IMPORTANT: Always check for Quote IDs in the user message. Quote IDs are typically 18-character alphanumeric strings like a0qbm000000hqbFAAQ.

Respond in the following JSON format:
{
  "intent": "list_quotes | get_quote_details | update_quote | approve_quote | recall_quote | docusign_quote",
  "actionType": "FETCH_QUOTE | VALIDATE_QUOTE | APPROVE_QUOTE | REJECT_QUOTE | ESCALATE_QUOTE | GENERATE_DOCUMENT | COMPLETE",
  "entities": {
    "quoteId": "Extract Quote ID if present (18-character alphanumeric)",
    "product": "Product name if present",
    "quantity": "Quantity if present",
    "removeItem": "Item to remove if present"
  },
  "infoType": "basic_details | expiration_date | pricing | line_items | status | validation",
  "explanation": "Brief explanation of the detected intent"
}

NOTES:
- If the user is asking about when a quote expires, use intent "get_quote_details" with infoType "expiration_date"
- If the user is asking about quote status, use intent "get_quote_details" with infoType "status"
- If the user is asking about validation, use intent "get_quote_details" with infoType "validation"`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a Quote-to-Cash assistant that analyzes user requests and extracts intents and entities." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(content) as LLMResponse;
    
    console.log(`📝 LLM Intent Detection: ${result.intent} (${result.explanation})`);
    
    // Extract quoteId if possible and ensure it's a string when present
    const quoteId = (result.entities.quoteId as string) || 
                   state.input.raw.match(/\b([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\b/g)?.[0] ||
                   state.salesforce.currentQuote?.id;

    // Ensure entities are all strings
    const entities: Record<string, string> = {};
    Object.entries(result.entities).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        entities[key] = String(value);
      }
    });
    
    return {
      ...state,
      input: {
        ...state.input,
        intent: result.intent,
        quoteId: quoteId,
        entities,
        infoType: result.infoType
      }
    };
  } catch (error) {
    console.error("Error during intent parsing:", error);
    
    // Attempt basic fallback parsing
    const quoteIdMatch = state.input.raw.match(/quote (\w+)/i);
    const quoteId = quoteIdMatch ? quoteIdMatch[1] : undefined;
    
    let intent = "unknown";
    if (/list|all.*quotes/i.test(state.input.raw)) intent = "list_quotes";
    else if (/details|show me/i.test(state.input.raw)) intent = "get_quote_details";
    else if (/approve/i.test(state.input.raw)) intent = "approve_quote";
    else if (/recall|reject/i.test(state.input.raw)) intent = "recall_quote";
    
    return {
      ...state,
      input: {
        ...state.input,
        intent,
        quoteId,
        entities: { quoteId }
      },
      execution: {
        ...state.execution,
        error: `Intent parsing failed: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
});

// Helper function to ensure plan step has correct status
const createPlanStep = (step: any): PlanStep => ({
  id: step.id || '',
  description: step.description || '',
  tool: step.tool || '',
  status: 'pending' as const,
  args: Array.isArray(step.args) ? step.args.map(String) : [],
  result: step.result,
  error: step.error
});

// Helper function to ensure plan has correct structure
const createPlan = (result: any): ExecutionPlan => ({
  steps: Array.isArray(result.steps) ? result.steps.map(createPlanStep) : [],
  reasoning: typeof result.reasoning === 'string' ? result.reasoning : 'No reasoning provided'
});

// Helper function to ensure state has correct structure
const createState = (state: Q2CFxState): Q2CFxState => ({
  ...state,
  execution: {
    ...state.execution,
    plan: state.execution.plan ? {
      steps: state.execution.plan.steps,
      reasoning: state.execution.plan.reasoning
    } : undefined,
    currentStepIndex: state.execution.currentStepIndex,
    isComplete: state.execution.isComplete,
    error: state.execution.error
  }
});

// Step: Generate execution plan
const generatePlan = Fx.wrap<Q2CFxState>("generate_plan", async (state: Q2CFxState, log) => {
  const openai = getOpenAIClient();
  
  // If we couldn't parse intent, exit early
  if (!state.input.intent || state.input.intent === "unknown") {
    return {
      ...state,
      execution: {
        ...state.execution,
        error: "Could not determine intent from your message. Please try again with a clearer request."
      }
    };
  }
  
  try {
    // Build prompt for plan generation
    const prompt = `
You are a Quote-to-Cash agent planning how to respond to a user request in Salesforce CPQ.
Based on the user's intent, generate a step-by-step plan to fulfill their request.

User request: "${state.input.raw}"

Parsed intent:
- Intent: ${state.input.intent}
- Info Type: ${state.input.infoType || 'basic_details'}
- Quote ID: ${state.input.quoteId || 'Not provided'}
- Other entities: ${JSON.stringify(state.input.entities)}

Available tools:
- authenticate_salesforce(): Connect to Salesforce
- list_quotes(): Get a list of all quotes
- fetch_quote(quoteId): Get details of a specific quote
- validate_quote(quoteId): Run validation rules on a quote
- update_quote_status(quoteId, status): Change a quote's status
- slack_message(message): Send a message to the user

Create a plan that:
1. Always starts with authentication
2. Fetches necessary data
3. Performs required actions
4. Provides appropriate responses

Your plan should be a JSON object with this structure:
{
  "reasoning": "Step-by-step thought process explaining your plan",
  "steps": [
    {
      "id": "1",
      "description": "Human-readable description of the step",
      "tool": "tool_name",
      "args": ["arg1", "arg2"]
    },
    ...
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a workflow planning assistant for Salesforce CPQ operations." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(content);
    
    return createState({
      ...state,
      execution: {
        ...state.execution,
        plan: createPlan(result),
        currentStepIndex: 0
      }
    });
  } catch (error) {
    console.error("Error generating plan:", error);
    
    // Create a basic fallback plan based on intent
    const fallbackPlan: ExecutionPlan = {
      steps: [
        {
          id: "1",
          description: "Connect to Salesforce",
          tool: "authenticate_salesforce",
          args: [],
          status: 'pending' as const
        } as PlanStep
      ],
      reasoning: "Basic fallback plan due to error in plan generation"
    };
    
    if (state.input.intent === "list_quotes") {
      fallbackPlan.steps.push({
        id: "2",
        description: "Fetch all quotes",
        tool: "list_quotes",
        args: [],
        status: 'pending' as const
      } as PlanStep);
    } else if (state.input.quoteId) {
      fallbackPlan.steps.push({
        id: "2",
        description: "Fetch quote details",
        tool: "fetch_quote",
        args: [state.input.quoteId],
        status: 'pending' as const
      } as PlanStep);
      
      if (state.input.intent === "approve_quote") {
        fallbackPlan.steps.push({
          id: "3",
          description: "Approve the quote",
          tool: "update_quote_status",
          args: [state.input.quoteId, "Approved"],
          status: 'pending' as const
        } as PlanStep);
      } else if (state.input.intent === "recall_quote") {
        fallbackPlan.steps.push({
          id: "3",
          description: "Recall the quote to Draft",
          tool: "update_quote_status",
          args: [state.input.quoteId, "Draft"],
          status: 'pending' as const
        } as PlanStep);
      }
    }
    
    return createState({
      ...state,
      execution: {
        ...state.execution,
        plan: fallbackPlan,
        currentStepIndex: 0,
        error: `Plan generation had issues: ${error instanceof Error ? error.message : String(error)}`
      }
    });
  }
});

// Step: Execute single step of the plan
const executeStep = Fx.wrap<Q2CFxState>("execute_step", async (state: Q2CFxState, log) => {
  // Check if plan execution is done
  if (!state.execution.plan || 
      state.execution.currentStepIndex === undefined || 
      state.execution.currentStepIndex >= state.execution.plan.steps.length) {
    return createState({
      ...state,
      execution: {
        ...state.execution,
        isComplete: true
      }
    });
  }
  
  const currentStepIndex = state.execution.currentStepIndex;
  const currentStep = state.execution.plan.steps[currentStepIndex];
  
  // Update step status to in-progress
  const updatedPlan: ExecutionPlan = {
    steps: state.execution.plan.steps.map((step: PlanStep, index) => 
      index === currentStepIndex 
        ? { ...step, status: 'in-progress' as const } 
        : step
    ),
    reasoning: state.execution.plan.reasoning
  };
  
  const stateWithUpdatedPlan = createState({
    ...state,
    execution: {
      ...state.execution,
      plan: updatedPlan
    }
  });
  
  try {
    // For user-facing steps like slack_message, show in-progress message
    if (currentStep.tool !== 'slack_message') {
      await Fx.callTool<Q2CFxState>("slack_message", 
        [`🔄 ${currentStep.description}...`]
      )(stateWithUpdatedPlan, log);
    }
    
    // Execute the tool call
    const result = await Fx.callTool<Q2CFxState>(
      currentStep.tool, 
      currentStep.args || []
    )(stateWithUpdatedPlan, log);
    
    // Update the step status to completed and store result
    const completedPlan: ExecutionPlan = {
      steps: result.execution.plan?.steps.map((step: PlanStep, index) => 
        index === currentStepIndex 
          ? { ...step, status: 'completed' as const, result: JSON.stringify(result) } 
          : step
      ) || [],
      reasoning: result.execution.plan?.reasoning || "Execution completed"
    };
    
    // Move to next step
    return createState({
      ...result,
      execution: {
        ...result.execution,
        plan: completedPlan,
        currentStepIndex: currentStepIndex + 1
      }
    });
  } catch (error) {
    console.error(`Error executing step ${currentStep.id}: ${currentStep.description}`, error);
    
    // Update the step status to failed
    const failedPlan: ExecutionPlan = {
      steps: stateWithUpdatedPlan.execution.plan!.steps.map((step: PlanStep, index) => 
        index === currentStepIndex 
          ? { 
              ...step, 
              status: 'failed' as const, 
              error: error instanceof Error ? error.message : String(error) 
            } 
          : step
      ),
      reasoning: stateWithUpdatedPlan.execution.plan!.reasoning
    };
    
    await Fx.callTool<Q2CFxState>("slack_message", 
      [`❌ Failed to ${currentStep.description.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`]
    )(stateWithUpdatedPlan, log);
    
    return createState({
      ...stateWithUpdatedPlan,
      execution: {
        ...stateWithUpdatedPlan.execution,
        plan: failedPlan,
        error: `Step ${currentStep.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        isComplete: true // Stop execution when a step fails
      }
    });
  }
});

// Step: Execute entire plan
const executePlan = Fx.wrap("execute_plan", async (state: Q2CFxState, log) => {
  let currentState = state;
  
  // Execute steps until completion or failure
  while (!currentState.execution.isComplete && !currentState.execution.error) {
    currentState = await executeStep(currentState, log);
  }
  
  return currentState;
});

// Step: Generate response based on execution results
const generateResponse = Fx.wrap("generate_response", async (state: Q2CFxState, log) => {
  const openai = getOpenAIClient();
  
  // If there was an error during execution, report it
  if (state.execution.error) {
    await Fx.callTool<Q2CFxState>("slack_message", 
      [`Sorry, I encountered an error: ${state.execution.error}`]
    )(state, log);
    return state;
  }
  
  try {
    // Get quote info for response generation
    const quote = state.salesforce.currentQuote;
    const allQuotes = state.salesforce.quotes;
    const validationResults = state.salesforce.validationResults;
    
    // Format validation results if available
    let validationText = '';
    if (validationResults && validationResults.length > 0) {
      const hasErrors = Combinators.anyErrors(validationResults);
      const onlyWarnings = Combinators.onlyWarnings(validationResults);
      
      validationText = validationResults.map(r => {
        const icon = r.valid ? '✅' : (r.severity === ValidationSeverity.Error ? '❌' : '⚠️');
        return `${icon} ${r.message}`;
      }).join('\n');
      
      validationText = `\n\n*Validation Results:*\n${validationText}\n\n${
        hasErrors ? '❌ Validation failed with errors' : 
        onlyWarnings ? '⚠️ Validation passed with warnings' : 
        '✅ Validation passed successfully'
      }`;
    }
    
    // Build prompt for response generation
    let prompt = `
Generate a friendly, helpful response about the Salesforce CPQ operation that was performed.

User's original request: "${state.input.raw}"
Intent detected: ${state.input.intent}
Info type requested: ${state.input.infoType || 'basic_details'}

${quote ? `
Quote details:
- Name: ${quote.name}
- ID: ${quote.id}
- Status: ${quote.status}
- Amount: $${quote.amount}
${quote.lineItems && quote.lineItems.length ? `- Line Items: ${quote.lineItems.length} items` : ''}
${quote.metadata?.endDate ? `- Expiration Date: ${new Date(quote.metadata.endDate as Date).toLocaleDateString()}` : ''}
` : ''}

${allQuotes && allQuotes.length > 0 ? `
Found ${allQuotes.length} quotes in total.
` : ''}

${validationText}

Format your response with:
1. A brief confirmation of what was done (use emoji)
2. The requested information in a clear format
3. A "Next steps:" section with 2-3 suggested commands the user can try

Use Slack's formatting with *bold* for headings and \`code\` for commands.
Keep the response concise and professional.
`;

    // Special handling for expiration date queries
    if (state.input.infoType === 'expiration_date' && quote?.metadata?.endDate) {
      const expirationDate = new Date(quote.metadata.endDate as Date);
      const today = new Date();
      const daysRemaining = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      prompt += `
IMPORTANT: The user specifically asked about when this quote expires.
- Expiration Date: ${expirationDate.toLocaleDateString()}
- Days Remaining: ${daysRemaining}
- Status: ${daysRemaining < 0 ? "Expired" : daysRemaining <= 7 ? "Expiring Soon" : "Valid"}

Make sure to prominently feature this expiration information in your response.
`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You create concise, helpful responses for a Salesforce Quote-to-Cash bot." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    
    const generatedResponse = response.choices[0]?.message?.content || '';
    
    // Send the response
    await Fx.callTool<Q2CFxState>("slack_message", [generatedResponse])(state, log);
    
    return {
      ...state,
      execution: {
        ...state.execution,
        isComplete: true
      }
    };
  } catch (error) {
    console.error("Error generating response:", error);
    
    // Fallback response
    let fallbackResponse = "✅ I've completed your request.";
    
    if (state.input.intent === "list_quotes" && state.salesforce.quotes) {
      const quotes = state.salesforce.quotes.map(q => 
        `• *${q.name}* (${q.id})\n  Status: ${q.status}, Amount: $${q.amount}`
      ).join('\n');
      
      fallbackResponse = `📊 I found ${state.salesforce.quotes.length} quotes in Salesforce CPQ:\n\n${quotes}\n\n*What would you like to do next?*\n• Get details on a specific quote with \`quote <id>\`\n• Validate a quote with \`validate <id>\`\n• View quote status overview with \`status\``;
    } else if (state.salesforce.currentQuote) {
      const quote = state.salesforce.currentQuote;
      fallbackResponse = `*Quote Details*\n\nQuote: *${quote.name}* (${quote.id})\n• Status: ${quote.status}\n• Amount: $${quote.amount}\n\n*What would you like to do next?*\n• Validate this quote with \`validate ${quote.id}\`\n• Approve this quote with \`approve ${quote.id}\`\n• Check when it expires with \`expiration ${quote.id}\``;
    }
    
    await Fx.callTool<Q2CFxState>("slack_message", [fallbackResponse])(state, log);
    
    return {
      ...state,
      execution: {
        ...state.execution,
        isComplete: true
      }
    };
  }
});

// Main agent workflow
const q2cWorkflow = Fx.agent<Q2CFxState>("Q2CAgent", 
  Fx.sequence(
    parseIntent,
    generatePlan,
    executePlan,
    generateResponse
  )
);

// Public API to process a message
export const processMessage = async (
  message: string, 
  slack: SlackContext
): Promise<void> => {
  try {
    const initialState = createInitialState(message, slack);
    await Fx.spawn(q2cWorkflow, initialState);
  } catch (error) {
    console.error("Critical error in Q2C agent:", error);
    try {
      await slack.say({
        text: `❌ I encountered a critical error and couldn't process your request: ${error instanceof Error ? error.message : String(error)}`,
        thread_ts: slack.threadTs
      });
    } catch (msgError) {
      console.error("Failed to send error message:", msgError);
    }
  }
};

// Export for testing
export const createTestableWorkflow = () => q2cWorkflow; 