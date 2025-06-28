import Fx from '../index';
import { 
  Q2CAgentState, 
  Quote, 
  QuoteId, 
  AgentAction, 
  AgentActionType, 
  AgentActionStatus,
  ValidationResult,
  ValidationSeverity,
  OAuthToken
} from './types';
import { 
  validateQuote, 
  standardRules, 
  RuleBuilder,
  Predicates,
  Messages,
  Combinators
} from './rulesEngine';
import { 
  SalesforceAPI, 
  createConnection
} from './salesforce';
import { z } from 'zod';
import OpenAI from 'openai';

// Define Step type
type Step<S> = (state: Readonly<S>, log: any[]) => Promise<S> | S;

// Define ReAct response type
type ReActResponse = {
  observation: string;
  reasoning: string;
  action: {
    type: AgentActionType;
    quoteId: string;
    reason: string;
  };
};

// Update state type to include ReAct thought process
interface ExtendedQ2CAgentState extends Q2CAgentState {
  lastThought?: ReActResponse;
}

// Initialize OpenAI client lazily
let openaiClient: OpenAI | null = null;
const getOpenAIClient = () => {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

// ReAct agent prompt template
const REACT_PROMPT = `You are a Quote-to-Cash (Q2C) agent that processes quotes through validation and approval.
Given the current state, decide what action to take next.

Current State:
- Quotes: {{quotes}}
- Pending Actions: {{pendingActions}}
- Validation Results: {{validationResults}}

Think through what needs to be done next and respond in this format:
Observation: <what you observe about the current state>
Reasoning: <your reasoning about what needs to be done>
Action: <one of: FETCH_QUOTE, VALIDATE_QUOTE, APPROVE_QUOTE, REJECT_QUOTE, ESCALATE_QUOTE, COMPLETE>
QuoteId: <the quote ID to act on>
Reason: <reason for the action>`;

// Define ReAct response schema with Zod and stricter validation
const ReActResponseSchema = z.object({
  observation: z.string().min(1),
  reasoning: z.string().min(1),
  action: z.object({
    type: z.nativeEnum(AgentActionType),
    quoteId: z.string().optional().default(''),
    reason: z.string().min(1)
  })
}).strict();

// Format state for LLM prompt with clearer instructions
const formatStateForPrompt = (state: ExtendedQ2CAgentState): string => {
  const quoteInfo = state.quotes.map(quote => `
Quote ${quote.id}:
- Name: ${quote.name}
- Amount: $${quote.amount}
- Status: ${quote.status}
- Created: ${quote.createdAt}
- Last Modified: ${quote.lastModifiedAt}
- Line Items: ${quote.lineItems.length} items`).join('\n');

  const validationInfo = Array.from(state.validationResults.entries())
    .map(([quoteId, results]) => `
Validation Results for Quote ${quoteId}:
${results.map(r => `- ${r.valid ? '✅' : '❌'} ${r.message} (${r.severity})`).join('\n')}`).join('\n');

  const pendingActions = state.pendingActions
    .map(a => `- ${a.type} for Quote ${a.quoteId} (${a.status})`).join('\n');

  return `You are a Quote-to-Cash agent. Analyze this state and decide the next action:

CURRENT STATE:
${quoteInfo ? `QUOTES:\n${quoteInfo}` : 'NO QUOTES LOADED'}

${validationInfo ? `VALIDATION RESULTS:\n${validationInfo}` : 'NO VALIDATION RESULTS'}

${pendingActions ? `PENDING ACTIONS:\n${pendingActions}` : 'NO PENDING ACTIONS'}

INSTRUCTIONS:
1. If there are no quotes loaded, use FETCH_QUOTE
2. If a quote needs validation, use VALIDATE_QUOTE
3. After validation:
   - If passed, use APPROVE_QUOTE
   - If failed with errors, use REJECT_QUOTE
   - If needs review, use ESCALATE_QUOTE
4. Use COMPLETE only when all quotes are processed

RESPOND EXACTLY IN THIS FORMAT:
{
  "observation": "Describe what you see in the current state",
  "reasoning": "Explain your decision process",
  "action": {
    "type": "FETCH_QUOTE | VALIDATE_QUOTE | APPROVE_QUOTE | REJECT_QUOTE | ESCALATE_QUOTE | COMPLETE",
    "quoteId": "Quote ID to act on (empty for COMPLETE)",
    "reason": "Detailed reason for this action"
  }
}`;
}

// Helper function to create a step that calls a tool
const createToolStep = <T extends any[]>(
  toolName: string,
  ...args: T
): Step<ExtendedQ2CAgentState> => 
  async (state, log) => Fx.callTool<ExtendedQ2CAgentState>(toolName, args)(state, log);

// Helper to prioritize quotes
const prioritizeQuotes = (state: ExtendedQ2CAgentState): Quote[] => {
  return state.quotes.sort((a, b) => {
    // First handle quotes without validation results
    const aValidated = state.validationResults.has(a.id);
    const bValidated = state.validationResults.has(b.id);
    if (!aValidated && bValidated) return -1;
    if (aValidated && !bValidated) return 1;
    
    // Then handle quotes with errors
    const aResults = state.validationResults.get(a.id) || [];
    const bResults = state.validationResults.get(b.id) || [];
    const aHasErrors = Combinators.anyErrors(aResults);
    const bHasErrors = Combinators.anyErrors(bResults);
    if (aHasErrors && !bHasErrors) return -1;
    if (!aHasErrors && bHasErrors) return 1;
    
    // Finally sort by creation date
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
};

// ReAct think step with improved extraction and error handling
const think = Fx.wrap<ExtendedQ2CAgentState>(
  "think",
  async (state, log) => {
    if (state.isComplete) {
      console.log('🏁 Workflow is complete');
      return state;
    }
    
    console.log('\n🤔 Thinking about current state...');
    console.log('📊 Current State:');
    console.log(`- Quotes: ${state.quotes.length}`);
    console.log(`- Pending Actions: ${state.pendingActions.length}`);
    console.log(`- Validation Results: ${state.validationResults.size}`);
    
    try {
      // Handle initial FETCH_QUOTE action
      const pendingFetch = state.pendingActions.find(
        a => a.type === AgentActionType.FetchQuote && 
             a.status === AgentActionStatus.Pending
      );
      
      if (pendingFetch) {
        return {
          ...state,
          lastThought: {
            observation: "Need to fetch quote details",
            reasoning: "Quote needs to be loaded before processing",
            action: {
              type: AgentActionType.FetchQuote,
              quoteId: pendingFetch.quoteId,
              reason: "Initial quote fetch"
            }
          }
        };
      }

      // If we have quotes but no validation results, validate
      if (state.quotes.length > 0 && state.validationResults.size === 0) {
        const quoteToValidate = state.quotes[0];
        return {
          ...state,
          lastThought: {
            observation: "Quote loaded but not validated",
            reasoning: "Need to validate quote before further processing",
            action: {
              type: AgentActionType.ValidateQuote,
              quoteId: quoteToValidate.id,
              reason: "Quote validation required"
            }
          }
        };
      }

      // If we have validation results, decide on next action
      if (state.validationResults.size > 0) {
        const [quoteId, results] = Array.from(state.validationResults.entries())[0];
        const hasErrors = Combinators.anyErrors(results);
        const onlyWarnings = Combinators.onlyWarnings(results);

        if (hasErrors) {
          return {
            ...state,
            lastThought: {
              observation: "Quote validation failed",
              reasoning: "Quote has validation errors",
              action: {
                type: AgentActionType.RejectQuote,
                quoteId,
                reason: "Failed validation checks"
              }
            }
          };
        }

        if (onlyWarnings) {
          return {
            ...state,
            lastThought: {
              observation: "Quote has warnings",
              reasoning: "Quote needs review due to warnings",
              action: {
                type: AgentActionType.EscalateQuote,
                quoteId,
                reason: "Validation warnings present"
              }
            }
          };
        }

        return {
          ...state,
          lastThought: {
            observation: "Quote passed validation",
            reasoning: "Quote is ready for approval",
            action: {
              type: AgentActionType.ApproveQuote,
              quoteId,
              reason: "All validation checks passed"
            }
          }
        };
      }

      // If all actions are completed, finish
      const allActionsCompleted = state.pendingActions.every(
        a => a.status === AgentActionStatus.Completed
      );

      if (allActionsCompleted) {
        return {
          ...state,
          lastThought: {
            observation: "All actions completed",
            reasoning: "Nothing more to process",
            action: {
              type: AgentActionType.Complete,
              quoteId: "",
              reason: "Workflow complete"
            }
          },
          isComplete: true
        };
      }

      // Default thought for unexpected state
      return {
        ...state,
        lastThought: {
          observation: "Unexpected state encountered",
          reasoning: "Cannot determine next action",
          action: {
            type: AgentActionType.Complete,
            quoteId: "",
            reason: "Unable to proceed"
          }
        },
        isComplete: true
      };
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Thinking failed: ${errorMessage}`);
      
      return {
        ...state,
        lastThought: {
          observation: "Error occurred during analysis",
          reasoning: "System encountered an error",
          action: {
            type: AgentActionType.Complete,
            quoteId: "",
            reason: "Error recovery initiated"
          }
        },
        isComplete: true
      };
    }
  }
);

// Helper function to log tool results
const logToolResult = (toolName: string, result: any) => {
  console.log(`\n📦 Tool Output (${toolName}):`);
  if (result === null || result === undefined) {
    console.log('No output from tool');
    return;
  }
  
  try {
    if (typeof result === 'object') {
      Object.entries(result).forEach(([key, value]) => {
        console.log(`${key}: ${JSON.stringify(value, null, 2)}`);
      });
    } else {
      console.log(result);
    }
  } catch (error) {
    console.log('Failed to format tool output:', result);
  }
};

// Enhanced validation step using functional composition
const validateQuoteStep = Fx.wrap<ExtendedQ2CAgentState>(
  "validateQuote",
  async (state, log) => {
    const quote = state.quotes.find(q => q.id === state.lastThought?.action.quoteId);
    if (!quote) {
      throw new Error(`Quote ${state.lastThought?.action.quoteId} not found`);
    }

    // Get validation results using functional composition
    const results = await validateQuote(standardRules)(quote);
    
    // Log validation results with severity-based formatting
    console.log('\n📋 Validation Results:');
    results.forEach(result => {
      const icon = result.valid ? '✅' : result.severity === ValidationSeverity.Error ? '❌' : '⚠️';
      console.log(`${icon} ${result.message} (${result.severity})`);
    });

    // Update state with validation results
    const validationResults = new Map(state.validationResults);
    validationResults.set(quote.id, results);
    
    const newState = {
      ...state,
      validationResults
    };

    // Add next action based on validation results
    const hasErrors = Combinators.anyErrors(results);
    const onlyWarnings = Combinators.onlyWarnings(results);
    
    const nextAction = hasErrors 
      ? createAction(quote.id, AgentActionType.RejectQuote)
      : onlyWarnings
        ? createAction(quote.id, AgentActionType.EscalateQuote)
        : createAction(quote.id, AgentActionType.ApproveQuote);

    return {
      ...newState,
      pendingActions: [...newState.pendingActions, nextAction]
    };
  }
);

// Register validation tools
Fx.registerTool<ValidationResult[], z.ZodTuple<[z.ZodString]>>(
  'validateQuote',
  z.tuple([z.string()]),
  (quoteId: string) => async (state: readonly ValidationResult[]): Promise<ValidationResult[]> => {
    const results = await validateQuote(standardRules)({ id: quoteId } as Quote);
    return Array.isArray(results) ? results : [];
  }
);

// Enhanced quote approval step with validation checks
const approveQuoteStep = Fx.wrap<ExtendedQ2CAgentState>(
  "approveQuote",
  async (state, log) => {
    const quoteId = state.lastThought?.action.quoteId;
    if (!quoteId) throw new Error('No quote ID provided');

    // Get validation results
    const results = state.validationResults.get(quoteId);
    if (!results) {
      throw new Error(`No validation results found for quote ${quoteId}`);
    }

    // Use combinators to check if quote can be approved
    const hasErrors = results.some(r => !r.valid && r.severity === ValidationSeverity.Error);
    if (hasErrors) {
      throw new Error('Cannot approve quote with validation errors');
    }

    // Get warnings if any
    const warnings = results.filter(r => !r.valid && r.severity === ValidationSeverity.Warning);
    if (warnings.length > 0) {
      console.log('\n⚠️ Approving quote with warnings:');
      warnings.forEach(w => console.log(`- ${w.message}`));
    }

    // Proceed with approval
    const token = state.metadata.token as OAuthToken;
    if (!token?.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'APPROVE');
    
    return {
      ...state,
      pendingActions: state.pendingActions.map(action =>
        action.quoteId === quoteId && action.type === AgentActionType.ApproveQuote
          ? { ...action, status: AgentActionStatus.Completed, completedAt: new Date() }
          : action
      )
    };
  }
);

// Enhanced quote rejection step with validation error reporting
const rejectQuoteStep = Fx.wrap<ExtendedQ2CAgentState>(
  "rejectQuote",
  async (state, log) => {
    const quoteId = state.lastThought?.action.quoteId;
    if (!quoteId) throw new Error('No quote ID provided');

    // Get validation results
    const results = state.validationResults.get(quoteId);
    if (!results) {
      throw new Error(`No validation results found for quote ${quoteId}`);
    }

    // Get errors using combinators
    const errors = Combinators.filterBySeverity(ValidationSeverity.Error)(results);
    
    // Format rejection reason
    const rejectionReason = errors
      .map(e => e.message)
      .join('; ');

    // Update quote status
    const token = state.metadata.token as OAuthToken;
    if (!token?.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'REJECTED');
    
    return {
      ...state,
      pendingActions: state.pendingActions.map(action =>
        action.quoteId === quoteId && action.type === AgentActionType.RejectQuote
          ? { 
              ...action, 
              status: AgentActionStatus.Completed, 
              completedAt: new Date(),
              error: rejectionReason ? { 
                id: Fx.newId(),
                message: rejectionReason,
                code: 'QUOTE_REJECTED',
                timestamp: new Date(),
                context: { quoteId }
              } : undefined
            }
          : action
      )
    };
  }
);

// Act step with improved error handling and logging
const act = Fx.wrap<ExtendedQ2CAgentState>(
  "act",
  async (state, log) => {
    if (!state.lastThought?.action) {
      console.error('❌ No action defined in thought process');
      return { ...state, isComplete: true };
    }
    
    const { action } = state.lastThought;
    console.log(`\n🎯 Executing action: ${action.type}`);
    
    try {
      let result: ExtendedQ2CAgentState = state;
      
      // Check if action was already completed
      const existingAction = state.pendingActions.find(
        pa => pa.quoteId === action.quoteId && 
             pa.type === action.type &&
             pa.status === AgentActionStatus.Completed
      );

      if (existingAction) {
        console.log(`⏭️ Action ${action.type} already completed for quote ${action.quoteId}`);
        return { ...state, isComplete: true };
      }
      
      switch (action.type) {
        case AgentActionType.FetchQuote:
          console.log(`📥 Fetching quote: ${action.quoteId}`);
          const token = state.metadata.token as OAuthToken;
          if (!token?.access_token) {
            throw new Error('No valid authentication token available');
          }
          const conn = createConnection(token);
          const quote = await SalesforceAPI.fetchQuote(conn, action.quoteId);
          result = {
            ...state,
            quotes: [...state.quotes, quote]
          };
          break;
          
        case AgentActionType.ValidateQuote:
          console.log(`✅ Validating quote: ${action.quoteId}`);
          result = await validateQuoteStep(state, log);
          break;
          
        case AgentActionType.ApproveQuote:
          console.log(`👍 Approving quote: ${action.quoteId}`);
          result = await approveQuoteStep(state, log);
          result = { ...result, isComplete: true };
          break;
          
        case AgentActionType.RejectQuote:
          console.log(`👎 Rejecting quote: ${action.quoteId}`);
          result = await rejectQuoteStep(state, log);
          result = { ...result, isComplete: true };
          break;
          
        case AgentActionType.EscalateQuote:
          console.log(`⚠️ Escalating quote: ${action.quoteId}`);
          result = await createToolStep("escalateQuote", action.quoteId, action.reason)(state, log);
          result = { ...result, isComplete: true };
          break;
          
        case AgentActionType.Complete:
          console.log('✨ Completing workflow');
          result = { ...state, isComplete: true };
          break;
          
        default:
          console.error(`❌ Unknown action type: ${action.type}`);
          return { ...state, isComplete: true };
      }
      
      // Mark the current action as completed
      result = {
        ...result,
        pendingActions: result.pendingActions.map(pa =>
          pa.quoteId === action.quoteId && pa.type === action.type
            ? { ...pa, status: AgentActionStatus.Completed, completedAt: new Date() }
            : pa
        )
      };
      
      console.log(`✅ Action completed successfully\n`);
      return result;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Action failed: ${errorMessage}`);
      
      // Mark action as failed and complete the workflow
      return {
        ...state,
        isComplete: true,
        pendingActions: state.pendingActions.map(pa =>
          pa.quoteId === action.quoteId && pa.type === action.type
            ? { 
                ...pa, 
                status: AgentActionStatus.Failed, 
                completedAt: new Date(),
                error: {
                  id: Fx.newId(),
                  message: errorMessage,
                  code: 'ACTION_FAILED',
                  timestamp: new Date(),
                  context: { quoteId: action.quoteId, actionType: action.type }
                }
              }
            : pa
        )
      };
    }
  }
);

// Main agent workflow using functional composition with updated types
export const q2cAgent = Fx.agent<ExtendedQ2CAgentState>(
  "Q2CAgent",
  Fx.wrap("q2cWorkflow", async (state, log) => {
    // Log start of processing
    console.log('\n=== Starting Q2C Agent Processing ===');
    console.log(`Pending actions: ${state.pendingActions.length}`);
    
    // Create the workflow step that combines think and act
    const workflowStep = Fx.sequence(
      think,  // Analyze state and decide next action
      act     // Execute the decided action
    );
    
    // Main agent loop using functional composition
    return await Fx.loopWhile<ExtendedQ2CAgentState>(
      s => !s.isComplete,
      workflowStep
    )(state, log);
  })
);

// Pure action creators
export const createAction = (quoteId: QuoteId, type: AgentActionType): AgentAction => ({
  id: Fx.newId(),
  quoteId,
  type,
  status: AgentActionStatus.Pending,
  createdAt: new Date()
});

// Pure state update functions
const addQuote = (quote: Quote) => (state: Q2CAgentState): Q2CAgentState => ({
  ...state,
  quotes: [...state.quotes, quote]
});

const addValidationResults = (quoteId: QuoteId, results: ValidationResult[]) => 
  (state: Q2CAgentState): Q2CAgentState => ({
    ...state,
    validationResults: new Map(state.validationResults).set(quoteId, results)
  });

const updateActionStatus = (actionId: string, status: AgentActionStatus) => 
  (state: Q2CAgentState): Q2CAgentState => ({
    ...state,
    pendingActions: state.pendingActions.map(action =>
      action.id === actionId 
        ? { ...action, status, completedAt: status === AgentActionStatus.Completed ? new Date() : undefined }
        : action
    )
  });

// Initial state factory
export const createInitialState = (): Q2CAgentState => ({
  quotes: [],
  validationResults: new Map(),
  pendingActions: [],
  errors: [],
  metadata: {
    token: null
  },
  isComplete: false,
  // New state properties
  lineItems: new Map(),
  opportunities: new Map(),
  accounts: new Map(),
  products: [],
  pricebookEntries: new Map(),
  contracts: [],
  approvalProcesses: new Map(),
  documents: new Map()
});

// Register tools
Fx.registerTool<ExtendedQ2CAgentState, z.ZodTuple<[z.ZodString]>>(
  "fetchQuote",
  z.tuple([z.string()]),
  (quoteId: string) => async (state) => {
    const token = state.metadata.token as OAuthToken;
    if (!token || !token.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    const quote = await SalesforceAPI.fetchQuote(conn, quoteId);
    
    return {
      ...state,
      quotes: [...state.quotes, quote]
    };
  }
);

Fx.registerTool<ExtendedQ2CAgentState, z.ZodTuple<[z.ZodString]>>(
  "validateQuote",
  z.tuple([z.string()]),
  (quoteId: string) => async (state) => {
  const quote = state.quotes.find(q => q.id === quoteId);
  if (!quote) {
      throw new Error(`Quote ${quoteId} not found`);
    }

    const results = await validateQuote(standardRules)(quote);
    return {
      ...state,
      validationResults: new Map(state.validationResults).set(quoteId, results)
    };
  }
);

Fx.registerTool<ExtendedQ2CAgentState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "approveQuote",
  z.tuple([z.string(), z.string()]),
  (quoteId: string, reason: string) => async (state) => {
    const token = state.metadata.token as OAuthToken;
    if (!token || !token.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'APPROVE');
    
    return state;
  }
);

Fx.registerTool<ExtendedQ2CAgentState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "rejectQuote",
  z.tuple([z.string(), z.string()]),
  (quoteId: string, reason: string) => async (state) => {
    const token = state.metadata.token as OAuthToken;
    if (!token || !token.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'REJECTED');
    
    return state;
  }
);

Fx.registerTool<ExtendedQ2CAgentState, z.ZodTuple<[z.ZodString, z.ZodString]>>(
  "escalateQuote",
  z.tuple([z.string(), z.string()]),
  (quoteId: string, reason: string) => async (state) => {
    const token = state.metadata.token as OAuthToken;
    if (!token || !token.access_token) {
      throw new Error('No valid authentication token available');
    }

    const conn = createConnection(token);
    await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'Escalated');
    
    return state;
  }
);
