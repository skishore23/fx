import { App } from '@slack/bolt';
import { run } from './run';
import dotenv from 'dotenv';
import { 
  Quote, 
  OAuthToken,
  AgentActionType,
  ValidationSeverity,
  Address // Added Address here
} from './types';
import { SalesforceAPI, createOAuthConfig, getToken, createConnection, isLeft } from './salesforce';
import { 
  seedData, 
  demoScenarios, 
  createAccountIfNeeded, 
  createOpportunityIfNeeded, 
  createQuote 
} from './seedData';
import { 
  validateQuote, 
  standardRules, 
  Combinators
} from './rulesEngine';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

// Initialize OpenAI client 
let openaiClient: OpenAI | null = null;
const getOpenAIClient = () => {
  if (!openaiClient) {
    console.log(`🧠 TOOL CALL: Initializing OpenAI client with API key`);
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log(`🧠 TOOL RESPONSE: OpenAI client initialized successfully`);
  }
  return openaiClient;
};

// Command types
type Command = {
  name: string;
  description: string;
  handler: (args: string, event: any, context: any) => Promise<void>;
};

// Type for environment validation
type RequiredEnv = {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_APP_TOKEN: string;
};

// Function to extract Salesforce ID from URL
const extractSalesforceId = (text: string): string | null => {
  // Match IDs like: a088x000000Wsv0AAC or 0068x000003Lbc1AAC
  const idRegex = /(?:\/r\/(?:SBQQ__Quote__c|Opportunity)\/([a-zA-Z0-9]{18}))/;
  const match = text.match(idRegex);
  return match ? match[1] : null;
};

// Helper function to format address for prompts
const formatAddressForPrompt = (address: Address | undefined): string => {
  if (!address) return "Not available";
  const parts = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
    address.country
  ].filter(Boolean); // Filter out null or empty strings
  return parts.length > 0 ? parts.join(', ') : "Not available";
};

// Parse message to extract command and arguments
const parseMessage = (text: string): [string, string] => {
  const parts = text.split(' ');
  // Remove the bot mention
  parts.shift();
  
  // Get the command (first word) and the rest as args
  const command = parts[0]?.toLowerCase() || 'help';
  const args = parts.slice(1).join(' ');
  
  return [command, args];
};

// Get authentication token
const getAuthToken = async (): Promise<OAuthToken> => {
  console.log(`🔑 TOOL CALL: Getting Salesforce authentication token`);
  const tokenResult = await getToken({
    clientId: process.env.SF_CLIENT_ID!,
    loginUrl: 'https://login.salesforce.com',
    subject: process.env.SF_USERNAME!
  });

  if (isLeft(tokenResult)) {
    console.log(`❌ TOOL RESPONSE: Authentication failed`);
    throw new Error(`Authentication failed: ${tokenResult.left.message}`);
  }
  console.log(`✅ TOOL RESPONSE: Successfully obtained Salesforce token`);
  return tokenResult.right;
};

// Enhanced natural language intent detection with LLM
const detectIntentWithLLM = async (request: string, quoteData?: Quote): Promise<{ 
  intent: string, 
  actionType: AgentActionType, 
  entities: Record<string, string>,
  infoType?: string,
  context: {
    needs_quote_context: boolean;
    is_followup: boolean;
    scope: string;
  }
}> => {
  console.log(`🧠 TOOL CALL: Detecting intent with LLM for request: "${request.substring(0, 50)}${request.length > 50 ? '...' : ''}"`);
  if (quoteData) {
    console.log(`🧠 CONTEXT: Using quote context: ${quoteData.name} (${quoteData.id}), Status: ${quoteData.status}`);
  }
  
  const openai = getOpenAIClient();
  
  // Prepare detailed prompt with context
  const billingAddressString = formatAddressForPrompt(quoteData?.billingAddress);
  const shippingAddressString = formatAddressForPrompt(quoteData?.shippingAddress);

  const prompt = `
You are a friendly and helpful AI assistant specializing in Quote-to-Cash (Q2C) processes. Analyze the user's request and determine the appropriate intent, action, and any relevant information.

User message: "${request}"

${quoteData ? `
Current Quote Context:
- Name: ${quoteData.name}
- ID: ${quoteData.id}
- Status: ${quoteData.status}
- Amount: $${quoteData.amount}
- Created: ${quoteData.createdAt}
- Last Modified: ${quoteData.lastModifiedAt}
- Line Items: ${quoteData.lineItems.length} items
- Billing Address: ${billingAddressString}
- Shipping Address: ${shippingAddressString}
${quoteData.metadata?.endDate ? `- End Date/Expiration: ${new Date(quoteData.metadata.endDate as Date).toLocaleDateString()}` : ''}
` : ''}

TASK:
Analyze the user's message and categorize it appropriately. Consider the following:

1. Message Type:
- Is it a general query (introductions, greetings, help requests)?
- Is it a quote-specific query?
- Is it a system-wide query (like status overview)?

2. Information Needs:
- Are they asking about quote status?
- Do they need validation information?
- Are they asking about pricing?
- Are they asking about addresses (billing or shipping)? // Added this line for clarity to the LLM
- Do they need expiration details?
- Are they requesting an action (approve, recall, deny, reject, etc)?

3. Action Requirements:
- Does this request require immediate action? (e.g., updates, approvals, denials)
- Are there specific changes requested? (e.g., quantity updates)
- Is this a time-sensitive request?

4. Context Required:
- Do they reference a specific quote?
- Are they asking about all quotes?
- Is this a follow-up to previous context?

Respond in the following JSON format:
{
  "intent": {
    "primary": "general_query | list_quotes | get_quote_details | update_quote | approve_quote | recall_quote | reject_quote | docusign_quote",
    "secondary": "status_check | validation | pricing | expiration | action | overview | address_info | remove_item", // Added remove_item
    "requires_quote_id": boolean
  },
  "actionType": "NONE | FETCH_QUOTE | VALIDATE_QUOTE | APPROVE_QUOTE | REJECT_QUOTE | ESCALATE_QUOTE | GENERATE_DOCUMENT | COMPLETE | UPDATE_QUOTE", // Added UPDATE_QUOTE
  "entities": {
    "quoteId": "Extract Quote ID if present (18-character alphanumeric)",
    "product": "Product name if present",
    "quantity": {
      "from": "Current quantity if specified",
      "to": "New quantity if specified"
    },
    "removeItem": "Item to remove if present"
  },
  "infoType": "general | basic_details | expiration_date | pricing | line_items | status | validation | address_info | item_removal", // Added item_removal
  "context": {
    "needs_quote_context": boolean,
    "is_followup": boolean,
    "scope": "single_quote | all_quotes | system_wide",
    "requires_immediate_action": boolean,
    "action_details": "Specific details about what action needs to be taken"
  },
  "explanation": "Brief explanation of the intent, required actions, and any important context"
}

IMPORTANT: 
- For update requests (quantity changes, approvals, denials, etc), ALWAYS set requires_immediate_action to true
- For requests to remove a line item: 
  - Set intent.primary to "update_quote".
  - Set intent.secondary to "remove_item".
  - Set actionType to "UPDATE_QUOTE".
  - Extract the item name into entities.removeItem.
  - Set infoType to "item_removal".
  - Set context.requires_immediate_action to true.
- Include specific numbers and changes in action_details
- Clearly indicate when a request requires changes or actions vs just information retrieval
- When the user mentions "deny" or "reject", classify this as "reject_quote" intent with "REJECT_QUOTE" actionType
- For requests about addresses (billing or shipping), set infoType to "address_info".
`;

  try {
    const createParams = {
      model: "gpt-3.5-turbo" as const,
      messages: [
        { 
          role: "system" as const, 
          content: "You are a friendly and empathetic AI assistant who helps users with Salesforce quotes and CPQ processes. You excel at understanding user intent and context from natural language." 
        },
        { role: "user" as const, content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" as const}
    };
    console.log(`🧠 TOOL CALL: OpenAI chat.completions.create for intent detection with params: ${JSON.stringify(createParams)}`);
    const response = await openai.chat.completions.create(createParams);
    console.log(`🧠 TOOL RESPONSE: Received response from OpenAI, ${response.usage?.total_tokens || 'unknown'} tokens used`);

    const content = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(content);
    
    console.log(`📝 LLM Raw JSON Response (Intent): ${content}`);
    console.log(`📝 LLM Intent Detection Result: ${result.intent.primary} (${result.explanation})`);
    console.log(`📝 LLM Action Type: ${result.actionType}`);
    console.log(`📝 LLM Entities: ${JSON.stringify(result.entities)}`);
    
    if (result.context.requires_immediate_action) {
      console.log(`⚡ Immediate action required: ${result.context.action_details}`);
    }
    
    // If a quoteId was found in the request but not in the entities, try to extract it with a regex
    if (result.context.needs_quote_context && !result.entities.quoteId) {
      const idRegex = /\b([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\b/g;
      const matches = [...request.matchAll(idRegex)];
      
      if (matches.length > 0) {
        console.log(`📝 Found potential Quote ID via regex: ${matches[0][1]}`);
        result.entities.quoteId = matches[0][1];
      }
      
      // If we have quote context and no other ID was found, use that
      if (!result.entities.quoteId && quoteData) {
        result.entities.quoteId = quoteData.id;
      }
    }

    // For quantity updates, ensure we have both from and to values
    if (result.intent.primary === 'update_quote' && result.entities.quantity) {
      console.log('Processing quantity update request...');
      
      // Try to extract product name and quantities more thoroughly
      // First look for "X to Y" or "X → Y" patterns
      const quantityMatch = request.match(/(\d+)\s*(?:→|to|->)\s*(\d+)/);
      if (quantityMatch) {
        console.log(`Found quantity change pattern: ${quantityMatch[1]} to ${quantityMatch[2]}`);
        result.entities.quantity = {
          from: quantityMatch[1],
          to: quantityMatch[2]
        };
      }
      
      // Extract product name more intelligently
      if (!result.entities.product || result.entities.product === '') {
        // Look for common product name patterns
        const productPatterns = [
          // Pattern: "product X from Y to Z"
          /(?:product|item)\s+([A-Za-z0-9\s]+?)\s+(?:from|quantity)/i,
          // Pattern: "X from Y to Z"
          /([A-Za-z0-9\s]+?)\s+from\s+\d+/i,
          // Pattern: "bump X from Y to Z"
          /bump\s+([A-Za-z0-9\s]+?)\s+from/i,
          // Pattern: "update X to Y"
          /update\s+([A-Za-z0-9\s]+?)\s+to/i,
          // Pattern: "change X to Y"
          /change\s+([A-Za-z0-9\s]+?)\s+to/i
        ];
        
        // Try each pattern
        for (const pattern of productPatterns) {
          const match = request.match(pattern);
          if (match && match[1]) {
            const extractedProduct = match[1].trim();
            console.log(`Extracted product name using pattern: "${extractedProduct}"`);
            result.entities.product = extractedProduct;
            break;
          }
        }
        
        // If still no product and we're looking at a quote, try simple extraction from the request
        if (!result.entities.product && quoteData) {
          // Just look for the longest word sequence that might be a product name
          const words = request.split(/\s+/);
          let longestPhraseLength = 0;
          let longestPhrase = '';
          
          for (let i = 0; i < words.length; i++) {
            for (let j = i + 1; j <= Math.min(i + 6, words.length); j++) {
              const phrase = words.slice(i, j).join(' ');
              // Only consider phrases that look like product names (not commands, numbers, etc)
              if (
                phrase.length > longestPhraseLength &&
                /^[A-Z]/.test(phrase) && // Starts with capital letter
                !/^\d+$/.test(phrase) && // Not just a number
                !['from', 'to', 'update', 'change', 'bump', 'quantity'].includes(phrase.toLowerCase()) // Not a command word
              ) {
                longestPhraseLength = phrase.length;
                longestPhrase = phrase;
              }
            }
          }
          
          if (longestPhrase) {
            console.log(`Extracted potential product name by simple analysis: "${longestPhrase}"`);
            result.entities.product = longestPhrase;
          }
        }
      }
      
      console.log('Final extracted entities:', result.entities);
    }
    
    return {
      intent: result.intent.primary,
      actionType: result.actionType,
      entities: result.entities,
      infoType: result.infoType,
      context: result.context
    };
  } catch (error) {
    console.error("LLM intent detection failed:", error);
    
    // Only fall back to rule-based as absolute last resort
    return detectIntentWithRules(request);
  }
};

// Update the rule-based fallback to be more focused
const detectIntentWithRules = (request: string) => {
  // This is now just a basic fallback for when LLM fails completely
  return {
    intent: "unknown",
    actionType: AgentActionType.FetchQuote,
    entities: {},
    infoType: "basic_details",
    context: {
      needs_quote_context: false,
      is_followup: false,
      scope: "single_quote"
    }
  };
};

// Generate dynamic response using LLM
const generateResponseWithLLM = async (
  intent: string, // This is intent.primary
  actionTypeFromDetection: AgentActionType, // Added: Pass the actual actionType here
  targetQuote: Quote,
  entities: Record<string, string>,
  updatedStatus: string,
  actionResult: string | null = null,
  infoType?: string
): Promise<string> => {
  console.log(`🧠 TOOL CALL: Generating response with LLM for intent: ${intent}, infoType: ${infoType || 'none'}`);
  
  const openai = getOpenAIClient();
  
  // Get expiration date information if available
  const expirationDate = targetQuote.metadata.endDate 
    ? new Date(targetQuote.metadata.endDate as Date)
    : null;
  
  let expirationInfo = "";
  if (expirationDate) {
    const today = new Date();
    const daysRemaining = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    expirationInfo = `
- Expiration Date: ${expirationDate.toLocaleDateString()}
- Days Until Expiration: ${daysRemaining}
- Expiration Status: ${daysRemaining < 0 ? "Expired" : daysRemaining <= 7 ? "Expiring Soon" : "Valid"}`;
  } else {
    expirationInfo = "- Expiration Date: Not set";
  }
  
  // Format addresses for the prompt
  const billingAddressString = formatAddressForPrompt(targetQuote.billingAddress);
  const shippingAddressString = formatAddressForPrompt(targetQuote.shippingAddress);
  
  let userActionDescription = "about a Salesforce quote action that the bot just performed";
  // Check if actionTypeFromDetection is the string "NONE" or the enum member FetchQuote
  if ((actionTypeFromDetection as any) === "NONE" || actionTypeFromDetection === AgentActionType.FetchQuote) {
    if (infoType === "pricing" || infoType === "address_info" || infoType === "status" || infoType === "basic_details" || infoType === "expiration_date" || infoType === "line_items") {
      userActionDescription = "in response to a request for quote information";
    }
  }

  const prompt = `
Generate a friendly, helpful response ${userActionDescription}.

Quote Details:
- Name: ${targetQuote.name}
- ID: ${targetQuote.id}
- Original Status: ${targetQuote.status}
- Current Status: ${updatedStatus}
- Amount: $${targetQuote.amount}
${targetQuote.lineItems ? `- Line Items: ${targetQuote.lineItems.length} items` : ''}
- Billing Address: ${billingAddressString}
- Shipping Address: ${shippingAddressString}
${expirationInfo}

Action Details:
- Action Type: ${actionTypeFromDetection.replace(/_/g, ' ').toLowerCase()} // Used actionTypeFromDetection
${entities.product ? `- Product: ${entities.product}` : ''}
${typeof entities.quantity === 'object' && entities.quantity !== null 
  ? `- Quantity Change: ${(entities.quantity as any).from || '?'} → ${(entities.quantity as any).to || '?'}`
  : entities.quantity ? `- New Quantity: ${entities.quantity}` : ''}
${entities.removeItem ? `- Item Removed: ${entities.removeItem}` : ''}
${actionResult ? `- Action Result: ${actionResult}` : ''}

${intent === 'expiration_date' ? 'IMPORTANT: The user is specifically asking about the expiration date of this quote. Make sure to prominently feature this information in your response.' : ''}
${infoType === 'address_info' ? 'IMPORTANT: The user is specifically asking about the billing and/or shipping address for this quote. Make sure to clearly present the address information you have.' : ''}
${infoType === 'pricing' ? 'IMPORTANT: The user is asking for pricing information. Your response MUST clearly state the quote\'s total amount (e.g., \"The total amount for this quote is $AMOUNT.\"). Confirm you are presenting this information. Do NOT imply an update was made unless an actual update action was performed.' : ''}
${infoType === 'item_removal' && actionTypeFromDetection === AgentActionType.UpdateQuote ? 'IMPORTANT: The user requested to remove an item. Confirm whether the item was successfully removed or if there was an issue. Clearly state the name of the item and the result of the removal attempt.' : ''}

Write as if you (the bot) have processed the request. 
${((actionTypeFromDetection as any) === "NONE" || actionTypeFromDetection === AgentActionType.FetchQuote) && (infoType === "pricing" || infoType === "address_info" || infoType === "status" || infoType === "basic_details" || infoType === "expiration_date" || infoType === "line_items") 
  ? "Start your response by confirming you have retrieved the requested information (e.g., \"🔍 Here is the quote information you requested:\")." 
  : "Start your response with a brief confirmation of what you\'ve done (e.g., \"✅ Item removal processed:\")."} // Modified for item removal lead-in
DO NOT thank the user for updating the quote if no update occurred, unless it was an item removal or quantity change.

Format your response with:
1. A brief confirmation (as described above, use emoji)
2. A "What I did:" or "Key Information:" or "Removal Result:" section with 2-4 bullet points of specific actions you took or information retrieved (prefixed with •)
3. A "Next steps:" section with 2-3 suggested commands or actions the user can try next

Use Slack's formatting with *bold* for headings and \`code\` for commands.
Keep the response concise, direct and helpful.
Always include the current status of the quote at the end.
`;

  console.log(`🧠 TOOL CALL: OpenAI chat.completions.create for response generation`);
  
  try {
    const createParams = {
      model: "gpt-3.5-turbo" as const,
      messages: [
        { 
          role: "system" as const, 
          content: "You are a friendly and empathetic AI assistant who helps users with Salesforce quotes and CPQ processes. Your responses should be:\n1. Warm and conversational while maintaining professionalism\n2. Clear and structured with emoji to improve readability\n3. Proactive in suggesting next steps\n4. Empathetic to user needs and potential frustrations\n5. Focused on making complex processes feel simple\n\nAlways acknowledge the user\'s request first, then provide the information or action taken, and finish with clear next steps." 
        },
        { role: "user" as const, content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    };
    console.log(`🧠 TOOL CALL: OpenAI chat.completions.create for response generation with params: ${JSON.stringify(createParams)}`);
    const response = await openai.chat.completions.create(createParams);
    
    console.log(`🧠 TOOL RESPONSE: Response generation complete, ${response.usage?.total_tokens || 'unknown'} tokens used`);
    
    const generatedResponse = response.choices[0]?.message?.content || '';
    console.log(`🧠 Response length: ${generatedResponse.length} characters`);
    
    console.log(`🧠 LLM Raw JSON Response (Generated): ${generatedResponse}`);
    // Ensure the response includes current status - add it if missing
    if (!generatedResponse.toLowerCase().includes('current status') && 
        !generatedResponse.toLowerCase().includes('status:')) {
      console.log(`🧠 Adding status to response as it was missing`);
      return generatedResponse + `\n\n*Current status:* ${updatedStatus}`;
    }
    
    return generatedResponse;
  } catch (error) {
    console.error("❌ Error generating response with LLM:", error);
    console.log(`🧠 Falling back to default response template for intent: ${intent}`);
    return getDefaultResponse(intent, targetQuote, entities, updatedStatus, infoType);
  }
};

// Fall back to default responses if LLM fails
const getDefaultResponse = (
  intent: string,
  targetQuote: Quote,
  entities: Record<string, string>,
  updatedStatus: string,
  infoType?: string
): string => {
  // Default response structure
  let responseText = `✅ I've successfully processed quote *${targetQuote.name}*!\n\n`;
  
  // Specialized response based on information type
  const generateInfoTypeResponse = (infoType: string): string => {
    const billingAddressString = formatAddressForPrompt(targetQuote.billingAddress);
    const shippingAddressString = formatAddressForPrompt(targetQuote.shippingAddress);

    switch(infoType) {
      case "expiration_date":
        // Get expiration date information
        const expirationDate = targetQuote.metadata.endDate 
          ? new Date(targetQuote.metadata.endDate as Date) 
          : null;
        
        if (expirationDate) {
          // Format date nicely
          const formattedDate = expirationDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          
          // Calculate days remaining
          const today = new Date();
          const daysRemaining = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          let expirationStatus = "";
          if (daysRemaining < 0) {
            expirationStatus = "⚠️ This quote has *expired*.";
          } else if (daysRemaining <= 7) {
            expirationStatus = `⚠️ This quote will expire *soon* (${daysRemaining} days remaining).`;
          } else {
            expirationStatus = `✅ This quote is valid for *${daysRemaining} more days*.`;
          }
          
          return `*Quote Expiration Information*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\n*Expiration Date:* ${formattedDate}\n\n${expirationStatus}\n\n*What would you like to do next?*\n• View full quote details with \`quote ${targetQuote.id}\`\n• ${daysRemaining < 0 ? 'Create a new quote based on this one' : daysRemaining <= 7 ? 'Extend the expiration date' : 'Approve this quote'} with \`approve ${targetQuote.id}\``;
        } else {
          return `Quote *${targetQuote.name}* (${targetQuote.id}) does not have an expiration date set. This quote will remain valid until explicitly rejected or replaced.\n\n*Current Status:* ${updatedStatus}\n*Amount:* $${targetQuote.amount}\n\n*What would you like to do next?*\n• View full quote details with \`quote ${targetQuote.id}\`\n• Set an expiration date by updating the quote in Salesforce`;
        }
        
      case "status":
        return `*Quote Status Information*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\n*Current Status:* ${updatedStatus}\n*Last Modified:* ${targetQuote.lastModifiedAt.toLocaleDateString()}\n\n*What would you like to do next?*\n• ${updatedStatus === 'Draft' ? 'Validate this quote with \`validate ' + targetQuote.id + '\`' : updatedStatus === 'Approved' ? 'Generate document with \`docusign ' + targetQuote.id + '\`' : 'Approve this quote with \`approve ' + targetQuote.id + '\`'}`;
        
      case "address_info": // Added this case
        return `*Quote Address Information*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\n*Billing Address:* ${billingAddressString}\n*Shipping Address:* ${shippingAddressString}\n\n*Current Status:* ${updatedStatus}\n*Amount:* $${targetQuote.amount}\n\n*What would you like to do next?*\n• View full quote details with \`quote ${targetQuote.id}\`\n• Update addresses in Salesforce if needed`;
        
      case "pricing":
        return `*Quote Pricing Information*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\n*Total Amount:* $${targetQuote.amount}\n*Status:* ${updatedStatus}\n\n*What would you like to do next?*\n• View line items with \`quote ${targetQuote.id}\`\n• Approve this quote with \`approve ${targetQuote.id}\``;
        
      case "line_items":
        const lineItemsText = targetQuote.lineItems.length > 0 
          ? targetQuote.lineItems.map((li, index) => 
              `${index+1}. ${li.productId} - Qty: ${li.quantity}, Unit Price: $${li.unitPrice}, Total: $${li.quantity * li.unitPrice}`
            ).join('\n')
          : "No line items found";
          
        return `*Quote Line Items*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\n${lineItemsText}\n\n*Total Amount:* $${targetQuote.amount}\n*Status:* ${updatedStatus}\n\n*What would you like to do next?*\n• Edit quantities with \`update ${targetQuote.id}\`\n• Validate the quote with \`validate ${targetQuote.id}\``;
        
      case "validation":
        return `*Quote Validation*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n\nRan validation rules on this quote. See validation results above.\n\n*What would you like to do next?*\n• Edit the quote if there are issues\n• Approve the quote with \`approve ${targetQuote.id}\` if validation passed`;
        
      case "basic_details":
      default:
        // Standard response with quote details
        const created = targetQuote.createdAt.toLocaleDateString();
        const modified = targetQuote.lastModifiedAt.toLocaleDateString();
        const expirationInfo = targetQuote.metadata.endDate 
          ? `\n• Expiration: ${new Date(targetQuote.metadata.endDate as Date).toLocaleDateString()}`
          : '';
        const billingAddr = targetQuote.billingAddress ? `\n• Billing Address: ${formatAddressForPrompt(targetQuote.billingAddress)}` : ''; // Added
        const shippingAddr = targetQuote.shippingAddress ? `\n• Shipping Address: ${formatAddressForPrompt(targetQuote.shippingAddress)}` : ''; // Added
          
        return `*Quote Details*\n\nQuote: *${targetQuote.name}* (${targetQuote.id})\n• Status: ${updatedStatus}\n• Amount: $${targetQuote.amount}\n• Created: ${created}\n• Last Modified: ${modified}${expirationInfo}${billingAddr}${shippingAddr}\n• Line Items: ${targetQuote.lineItems.length} items\n\n*What would you like to do next?*\n• Validate this quote with \`validate ${targetQuote.id}\`\n• Approve this quote with \`approve ${targetQuote.id}\`\n• Check when it expires with \`expiration ${targetQuote.id}\`\n• View addresses with \`address ${targetQuote.id}\``; // Suggest new command for address
    }
  };
  
  // Generate action-specific response for updates and approvals
  if (intent === "update_quote") {
    responseText += `*What I did:*\n`;
    if (typeof entities.quantity === 'object' && entities.quantity !== null) {
      const fromQty = (entities.quantity as any).from || '?';
      const toQty = (entities.quantity as any).to || '?';
      
      responseText += `• Updated quantity of ${entities.product} from ${fromQty} to ${toQty}\n`;
      responseText += `• Recalculated quote totals based on new quantities\n`;
      responseText += `• Updated the quote record in Salesforce\n\n`;
      responseText += `*Next steps:*\n• You can validate the updated quote with \`validate ${targetQuote.id}\`\n• Or approve it with \`approve ${targetQuote.id}\``;
    } else if (entities.product && entities.quantity) {
      responseText += `• Updated quantity of ${entities.product} from ${targetQuote.lineItems.find(li => li.productId.includes(entities.product || ''))?.quantity || '?'} to ${entities.quantity}\n`;
      responseText += `• Recalculated quote totals based on new quantities\n`;
      responseText += `• Updated the quote record in Salesforce\n\n`;
      responseText += `*Next steps:*\n• You can validate the updated quote with \`validate ${targetQuote.id}\`\n• Or approve it with \`approve ${targetQuote.id}\``;
    } else if (entities.removeItem) {
      responseText += `• Removed ${entities.removeItem} from the quote\n`;
      responseText += `• Recalculated quote totals\n`;
      responseText += `• Updated the quote record in Salesforce\n\n`;
      responseText += `*Next steps:*\n• Review the updated quote to confirm the changes\n• Validate the quote with \`validate ${targetQuote.id}\``;
    }
  } else if (intent === "approve_quote") {
    responseText += `*What I did:*\n`;
    responseText += `• Verified quote meets approval criteria\n`;
    responseText += `• Updated quote status to Approved\n`;
    responseText += `• Sent approval notification to the account team\n\n`;
    responseText += `*Next steps:*\n• Generate quote document with \`docusign ${targetQuote.id}\`\n• Or view quote details in Salesforce`;
  } else if (intent === "reject_quote") {
    responseText += `*What I did:*\n`;
    responseText += `• Rejected quote\n`;
    responseText += `• Updated quote status to Rejected\n`;
    responseText += `• Saved change history in Salesforce\n\n`;
    responseText += `*Next steps:*\n• Make changes to the quote in Salesforce\n• Use \`validate ${targetQuote.id}\` when ready to check it again`;
  } else if (intent === "recall_quote") {
    responseText += `*What I did:*\n`;
    responseText += `• Changed quote status back to Draft\n`;
    responseText += `• Removed from approval queue\n`;
    responseText += `• Saved change history in Salesforce\n\n`;
    responseText += `*Next steps:*\n• Make your needed changes to the quote\n• Use \`validate ${targetQuote.id}\` when ready to check it again`;
  } else if (intent === "docusign_quote") {
    responseText += `*What I did:*\n`;
    responseText += `• Generated DocuSign envelope\n`;
    responseText += `• Added quote PDF as attachment\n`;
    responseText += `• Sent to customer for signature\n\n`;
    responseText += `*Next steps:*\n• Monitor signature status in Salesforce\n• You'll receive a notification when signed`;
  } else if (intent === "get_quote_details" && infoType) {
    // For information queries, use the specialized infoType response generator
    return generateInfoTypeResponse(infoType);
  } else {
    // Default case for any other intents
    responseText += `*What I did:*\n`;
    responseText += `• Retrieved and analyzed quote details\n`;
    responseText += `• Executed requested action (${intent})\n`;
    responseText += `• Updated record in Salesforce\n\n`;
    responseText += `*Next steps:*\n• You can ask me about specific details of this quote\n• Or use \`help\` to see all available commands`;
  }
  
  // Only add status if not already included (as in infoType responses)
  if (!responseText.includes('*Current status:*') && !responseText.includes('*Status:*')) {
    responseText += `\n\n*Current status:* ${updatedStatus}`;
  }
  
  return responseText;
};

// Original processQuoteRequest function with API calls - let's add logging
const processQuoteRequest = async (request: string, quoteId: string, token: OAuthToken, say: any, threadTs: string): Promise<void> => {
  try {
    const conn = createConnection(token);
    
    // First, acknowledge that we received the request
    await say({
      text: `👋 Hi there! I'll help you with quote ${quoteId}. Let me take a look...`,
      thread_ts: threadTs
    });

    // Fetch quote details
    console.log(`🔧 TOOL CALL: Fetching quotes with SalesforceAPI.listQuotes`);
    const quotes = await SalesforceAPI.listQuotes(conn);
    console.log(`🔧 TOOL RESPONSE: Found ${quotes.length} quotes`);
    
    const targetQuote = quotes.find(q => q.id === quoteId);
    
    if (!targetQuote) {
      await say({
        text: `I couldn't find that quote in our system. Could you double-check the ID or URL for me? You can also type \`list\` to see all available quotes. 🔍`,
        thread_ts: threadTs
      });
      return;
    }

    // Log the request and quote details
    await say({
      text: `I found the quote you're looking for! 📋\n\n*${targetQuote.name}* (${targetQuote.id})\n• Status: ${targetQuote.status}\n• Amount: $${targetQuote.amount}\n\nI'm analyzing your request: "${request}"`,
      thread_ts: threadTs
    });

    // Use enhanced LLM-based intent detection with quote context
    const { intent, actionType, entities, infoType, context } = await detectIntentWithLLM(request, targetQuote);

    let actionResult = null;
    let updatedStatus = targetQuote.status;
    let errorMessage = null;
    
    // Perform the actual action in Salesforce based on intent
    try {
      // Fetch any additional data needed based on infoType
      let lineItems = [];
      if (infoType === "line_items" || intent === "update_quote" || infoType === "item_removal") { // Added item_removal here
        console.log(`🔧 TOOL CALL: SalesforceAPI.fetchQuoteLineItems, Params: ${JSON.stringify({ quoteId: quoteId, context: "Update/Removal or Line Item Info"})}`);
        lineItems = await SalesforceAPI.fetchQuoteLineItems(conn, quoteId);
        console.log(`🔧 TOOL RESPONSE: Found ${lineItems.length} line items for quote ${quoteId}`);
        targetQuote.lineItems = lineItems; // Update targetQuote for accurate context in response generation
      }
      
      // Action specific operations
      if (intent === "update_quote") {
        if (entities.removeItem) {
          await say({
            text: `🔄 Attempting to remove item: *${entities.removeItem}* from quote *${targetQuote.name}*...`,
            thread_ts: threadTs
          });
          const removalResult = await SalesforceAPI.removeQuoteLineItem(conn, quoteId, entities.removeItem);
          if (removalResult.success) {
            actionResult = `Successfully removed item: ${entities.removeItem}.`;
            // Refresh line items for the quote context after removal
            targetQuote.lineItems = await SalesforceAPI.fetchQuoteLineItems(conn, quoteId);
            // Potentially refresh quote total amount if not handled by recalculation signal
            // const refreshedQuote = await SalesforceAPI.fetchQuote(conn, quoteId);
            // targetQuote.amount = refreshedQuote.amount;
            // updatedStatus = refreshedQuote.status; // Status might change if it becomes invalid
             await say({ text: `✅ ${removalResult.message}`, thread_ts: threadTs });
          } else {
            actionResult = `Failed to remove item ${entities.removeItem}: ${removalResult.message}`;
            errorMessage = removalResult.message; // So it stops before generating a success-toned LLM response
            await say({ text: `⚠️ ${actionResult}`, thread_ts: threadTs });
          }
        } else if (typeof entities.quantity === 'object' && entities.quantity !== null) {
          const fromQty = (entities.quantity as any).from || '?';
          const toQty = (entities.quantity as any).to || '?';
          
          // Update quantity operation with proper object handling
          await say({
            text: `🔄 I'm updating the quantity of ${entities.product} from ${fromQty} to ${toQty}...`,
            thread_ts: threadTs
          });
          
          // Actually perform the update in Salesforce
          try {
            console.log(`🔧 TOOL CALL: Updating quote line item with SalesforceAPI.updateQuoteLineItem`);
            console.log(`🔧 TOOL PARAMS: Product=${entities.product}, Qty=${toQty}`);
            
            const updateSuccess = await SalesforceAPI.updateQuoteLineItem(
              conn, 
              quoteId, 
              entities.product, 
              parseInt(toQty)
            );
            
            console.log(`🔧 TOOL RESPONSE: Update successful: ${updateSuccess}`);
            
            if (updateSuccess) {
              console.log(`✅ Successfully updated line item quantity in Salesforce!`);
              actionResult = `Successfully updated quantity from ${fromQty} to ${toQty}`;
              
              // Inform the user about the success
              await say({
                text: `✅ Successfully updated the quantity in Salesforce! Recalculating quote totals...`,
                thread_ts: threadTs
              });
            } else {
              console.log(`❌ Failed to update quantity in Salesforce`);
              actionResult = `Attempted to update quantity but there was an issue with the Salesforce API`;
              // Inform the user about the failure
              await say({
                text: `⚠️ I tried to update the quantity in Salesforce but encountered an issue. The request was understood, but the update may not have been applied.`,
                thread_ts: threadTs
              });
            }
          } catch (error) {
            console.error(`❌ Error in updateQuoteLineItem:`, error);
            actionResult = `Error updating quantity: ${error instanceof Error ? error.message : String(error)}`;
            // Inform the user about the error
            await say({
              text: `❌ Error updating quantity in Salesforce: ${error instanceof Error ? error.message : String(error)}`,
              thread_ts: threadTs
            });
          }
        } else if (entities.product && entities.quantity) {
          // Legacy handling for string quantity
          await say({
            text: `🔄 I'm updating the quantity of ${entities.product} to ${entities.quantity}...`,
            thread_ts: threadTs
          });
          
          // Try to parse quantity as a number
          try {
            const numQuantity = parseInt(entities.quantity.toString());
            if (!isNaN(numQuantity)) {
              console.log(`Attempting to update line item with string quantity: ${entities.quantity}`);
              const updateSuccess = await SalesforceAPI.updateQuoteLineItem(
                conn, 
                quoteId, 
                entities.product, 
                numQuantity
              );
              
              if (updateSuccess) {
                console.log(`✅ Successfully updated line item quantity in Salesforce!`);
                actionResult = `Successfully updated quantity to ${entities.quantity}`;
                
                // Inform the user about the success
                await say({
                  text: `✅ Successfully updated the quantity in Salesforce! Recalculating quote totals...`,
                  thread_ts: threadTs
                });
              } else {
                console.log(`❌ Failed to update quantity in Salesforce`);
                actionResult = `Attempted to update quantity but there was an issue`;
                await say({
                  text: `⚠️ I tried to update the quantity but encountered an issue. The request was understood, but the update may not have been applied.`,
                  thread_ts: threadTs
                });
              }
            } else {
              console.error(`❌ Could not parse quantity as a number: ${entities.quantity}`);
              actionResult = `Error: Could not parse quantity as a number`;
              await say({
                text: `❌ I couldn't process the quantity value "${entities.quantity}" as a number.`,
                thread_ts: threadTs
              });
            }
          } catch (error) {
            console.error(`❌ Error in updateQuoteLineItem (legacy):`, error);
            actionResult = `Error updating quantity: ${error instanceof Error ? error.message : String(error)}`;
            await say({
              text: `❌ Error updating quantity: ${error instanceof Error ? error.message : String(error)}`,
              thread_ts: threadTs
            });
          }
        } else if (entities.removeItem) {
          // Remove item operation (placeholder)
          await say({
            text: `🔄 I'm removing ${entities.removeItem} from the quote...`,
            thread_ts: threadTs
          });
          actionResult = `Removed item ${entities.removeItem}`;
        }
      } 
      else if (intent === "approve_quote") {
        // Actually approve the quote in Salesforce
        console.log(`🔧 TOOL CALL: Updating quote status to Approved with SalesforceAPI.updateQuoteStatus for quote ${quoteId}`);
        await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'Approved');
        console.log(`🔧 TOOL RESPONSE: Quote status updated to Approved`);
        updatedStatus = 'Approved';
        
        await say({
          text: `✅ Successfully updated quote status to Approved in Salesforce`,
          thread_ts: threadTs
        });
        actionResult = "Quote approved successfully";
      } 
      else if (intent === "reject_quote") {
        // Reject the quote in Salesforce
        console.log(`🔧 TOOL CALL: Updating quote status to Rejected with SalesforceAPI.updateQuoteStatus for quote ${quoteId}`);
        await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'Rejected');
        console.log(`🔧 TOOL RESPONSE: Quote status updated to Rejected`);
        updatedStatus = 'Rejected';
        
        await say({
          text: `✅ Successfully rejected quote in Salesforce`,
          thread_ts: threadTs
        });
        actionResult = "Quote rejected successfully";
      }
      else if (intent === "recall_quote") {
        // Actually change status back to Draft
        console.log(`🔧 TOOL CALL: Updating quote status to Draft with SalesforceAPI.updateQuoteStatus for quote ${quoteId}`);
        await SalesforceAPI.updateQuoteStatus(conn, quoteId, 'Draft');
        console.log(`🔧 TOOL RESPONSE: Quote status updated to Draft`);
        updatedStatus = 'Draft';
        
        await say({
          text: `✅ Successfully updated quote status to Draft in Salesforce`,
          thread_ts: threadTs
        });
        actionResult = "Quote recalled to Draft status";
      } 
      else if (intent === "docusign_quote") {
        // Initiate document generation if implemented
        console.log(`🔧 TOOL CALL: Initiating DocuSign process for quote ${quoteId} (feature in development)`);
        // This would need to be connected to real DocuSign integration
        await say({
          text: `🔄 Initiating DocuSign process. This feature is still in development.`,
          thread_ts: threadTs
        });
        actionResult = "DocuSign process initiated";
      }
      
      // Validation handling (when needed)
      if (infoType === "validation" || actionType === AgentActionType.ValidateQuote) {
        // Run validation rules
        console.log(`🔧 TOOL CALL: Running validation with validateQuote function for quote ${quoteId}`);
        const results = await validateQuote(standardRules)(targetQuote);
        console.log(`🔧 TOOL RESPONSE: Validation complete with ${results.length} rule results`);
        
        const hasErrors = Combinators.anyErrors(results);
        const onlyWarnings = Combinators.onlyWarnings(results);
        
        // Format validation results for display
        const formattedResults = results.map(r => {
          const icon = r.valid ? '✅' : (r.severity === ValidationSeverity.Error ? '❌' : '⚠️');
          return `${icon} ${r.message}`;
        }).join('\n');
        
        await say({
          text: `📋 *Validation Results:*\n${formattedResults}\n\n${hasErrors ? '❌ Validation failed with errors' : onlyWarnings ? '⚠️ Validation passed with warnings' : '✅ Validation passed successfully'}`,
          thread_ts: threadTs
        });
        
        actionResult = hasErrors ? "Validation failed with errors" : 
                      onlyWarnings ? "Validation passed with warnings" : 
                      "Validation passed successfully";
      }
      
      // Fetch the updated quote to get current status after any changes
      if (intent === "approve_quote" || intent === "recall_quote") {
        // Fetch the quote again to get the updated status
        console.log(`🔧 TOOL CALL: Fetching updated quote with SalesforceAPI.fetchQuote for quote ${quoteId}`);
        const updatedQuote = await SalesforceAPI.fetchQuote(conn, quoteId);
        console.log(`🔧 TOOL RESPONSE: Updated quote retrieved with status ${updatedQuote.status}`);
        updatedStatus = updatedQuote.status;
      }
      
    } catch (actionError) {
      errorMessage = actionError instanceof Error ? actionError.message : String(actionError);
      await say({
        text: `❌ Error performing the action: ${errorMessage}`,
        thread_ts: threadTs
      });
    }
    
    // If there was an error during action, stop here
    if (errorMessage) {
      return;
    }
    
    // Generate response - try LLM first, fall back to template
    const useLLM = process.env.USE_LLM_FOR_RESPONSES !== 'false'; // Default to true
    
    let responseText;
    if (useLLM) {
      // Try to generate response with LLM
      console.log(`🔧 TOOL CALL: Generating response with LLM for intent ${intent}`);
      try {
        responseText = await generateResponseWithLLM(intent, actionType, targetQuote, entities, updatedStatus, actionResult, infoType);
        console.log(`🔧 TOOL RESPONSE: LLM response generated successfully`);
      } catch (llmError) {
        console.error("Error using LLM for response, falling back to template:", llmError);
        responseText = getDefaultResponse(intent, targetQuote, entities, updatedStatus, infoType);
      }
    } else {
      // Use template response
      console.log(`🔧 Using template response for intent ${intent}`);
      responseText = getDefaultResponse(intent, targetQuote, entities, updatedStatus, infoType);
    }
    
    // Report back results
    await say({
      text: responseText,
      thread_ts: threadTs
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await say({
      text: `I apologize, but I ran into a small hiccup while processing your request. 😅

The specific error was: ${errorMessage}

Would you mind:
• Double-checking any quote IDs or URLs?
• Making sure you have the right permissions in Salesforce?
• Trying again in a moment?

You can also type \`help\` to see all available commands, or just ask me your question in a different way. I'm here to help! 🤝`,
      thread_ts: threadTs
    });
  }
};

// Process natural language query without a specific quote ID
const processNaturalLanguageQuery = async (query: string, say: any, event: any): Promise<void> => {
  try {
    // Acknowledge receipt of the query
    await say({
      text: `👋 Hi! I'll help you with that. Let me analyze your question: "${query}"...`,
      thread_ts: event.ts
    });
    
    // Use LLM to understand the intent
    console.log(`🧠 TOOL CALL: Detecting intent with LLM for query: ${query}`);
    const { intent, entities, infoType, context } = await detectIntentWithLLM(query);
    console.log(`🧠 TOOL RESPONSE: Detected intent: ${intent}, infoType: ${infoType || 'none'}`);
    
    // Get authentication token
    console.log(`🔑 TOOL CALL: Getting authentication token for Salesforce`);
    const token = await getAuthToken();
    console.log(`🔑 TOOL RESPONSE: Token obtained successfully`);
    const conn = createConnection(token);
    
    // Process based on intent
    if (query.toLowerCase().match(/who are you|what are you|introduce|hello|hi|hey/i)) {
      console.log(`💬 INTENT: Greeting/Introduction`);
      await say({
        text: `👋 Hi! I'm your friendly Quote-to-Cash (Q2C) Assistant! I help manage and process quotes in Salesforce CPQ.

I can help you with things like:
• Checking quote details and status
• Validating quotes before approval
• Approving or recalling quotes
• Generating documents
• And much more!

Want to get started? Try:
• Ask me to "show all quotes"
• Share a Salesforce quote URL with me
• Type \`help\` to see all available commands

How can I assist you today? 😊`,
        thread_ts: event.ts
      });
      return;
    }
    
    if (intent === "list_quotes" || query.toLowerCase().includes('status') && query.toLowerCase().includes('all')) {
      // Fetch all quotes
      console.log(`🔧 TOOL CALL: Listing all quotes with SalesforceAPI.listQuotes`);
      const quotes = await SalesforceAPI.listQuotes(conn);
      console.log(`🔧 TOOL RESPONSE: Found ${quotes.length} quotes`);
      
      if (quotes.length === 0) {
        await say({
          text: "I don't see any quotes in the system yet. Would you like to create some demo quotes using the \`seed\` command? 🌱",
          thread_ts: event.ts
        });
        return;
      }

      // Group quotes by status
      const statusGroups = quotes.reduce((acc: Record<string, typeof quotes>, quote) => {
        if (!acc[quote.status]) {
          acc[quote.status] = [];
        }
        acc[quote.status].push(quote);
        return acc;
      }, {});

      // Create a summary for each status
      const statusSummaries = Object.entries(statusGroups).map(([status, quotesInStatus]) => {
        const totalAmount = quotesInStatus.reduce((sum, q) => sum + q.amount, 0);
        return `*${status}* (${quotesInStatus.length} quotes, $${totalAmount.toLocaleString()})\n${
          quotesInStatus.map(q => `• ${q.name} - $${q.amount.toLocaleString()}`).join('\n')
        }`;
      }).join('\n\n');

      const pendingStatuses = ['Draft', 'In Review', 'Pending'];
      const pendingQuotes = quotes.filter(q => pendingStatuses.includes(q.status));
      const pendingAmount = pendingQuotes.reduce((sum, q) => sum + q.amount, 0);
      
      await say({
        text: `📊 Here's your quote status overview:\n\n${statusSummaries}\n\n${
          pendingQuotes.length > 0 
            ? `💡 You have *${pendingQuotes.length} pending quotes* worth $${pendingAmount.toLocaleString()} that might need attention!\n\n*Need to take action?*\n• Use \`validate <id>\` to check if a quote is ready for approval\n• Use \`approve <id>\` to approve a quote\n• Or just ask me "is quote <id> ready for approval?"`
            : "✨ Looking good! No pending quotes need attention right now."
        }`,
        thread_ts: event.ts
      });
    } else if (intent === "get_quote_details" && entities.quoteId) {
      // First fetch the basic quote data
      try {
        console.log(`🔧 TOOL CALL: Fetching quote with SalesforceAPI.fetchQuote for ID ${entities.quoteId}`);
        const quote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        console.log(`🔧 TOOL RESPONSE: Quote found with status ${quote.status}`);
        
        // Based on infoType, fetch additional data if needed
        if (infoType === "line_items") {
          console.log(`🔧 TOOL CALL: Fetching quote line items with SalesforceAPI.fetchQuoteLineItems for ID ${entities.quoteId}`);
          const lineItems = await SalesforceAPI.fetchQuoteLineItems(conn, entities.quoteId);
          console.log(`🔧 TOOL RESPONSE: Found ${lineItems.length} line items`);
          quote.lineItems = lineItems;
        }
        
        // Generate a response based on the infoType
        console.log(`💬 Generating response based on infoType: ${infoType || 'basic_details'}`);
        let responseText;
        
        // Use our default response generator for consistent formatting
        responseText = getDefaultResponse("get_quote_details", quote, entities, quote.status, infoType);
        
        await say({
          text: responseText,
          thread_ts: event.ts
        });
      } catch (error) {
        console.log(`❌ TOOL ERROR: Failed to find quote with ID ${entities.quoteId}`);
        await say({
          text: `I couldn't find quote with ID ${entities.quoteId}. Could you verify the ID is correct?\n\nYou can see all available quotes with the \`list\` command.`,
          thread_ts: event.ts
        });
      }
    }
    else if (intent === "approve_quote" && entities.quoteId) {
      // Handle quote approval directly
      try {
        // Verify quote exists
        const quote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        // Check if quote is already approved
        if (quote.status === 'Approved') {
          await say({
            text: `Quote ${quote.name} (${quote.id}) is already approved.`,
            thread_ts: event.ts
          });
          return;
        }
        
        // Process with explicit approval action
        await say({
          text: `🔄 Processing approval for quote ${quote.name} (${quote.id})...`,
          thread_ts: event.ts
        });
        
        // Update status in Salesforce
        await SalesforceAPI.updateQuoteStatus(conn, entities.quoteId, 'Approved');
        
        // Verify the change
        const updatedQuote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        if (updatedQuote.status === 'Approved') {
          await say({
            text: `✅ Quote ${quote.name} has been successfully approved!\n\n*Current status:* ${updatedQuote.status}\n\n*What would you like to do next?*\n• Generate document with \`docusign ${quote.id}\`\n• List all quotes with \`list\``,
            thread_ts: event.ts
          });
        } else {
          await say({
            text: `⚠️ I attempted to approve quote ${quote.name}, but the status is still: ${updatedQuote.status}\nThis might indicate a permissions issue or approval process requirement in Salesforce.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        await say({
          text: `I couldn't approve the quote: ${error instanceof Error ? error.message : String(error)}\n\nPlease check your Salesforce permissions and try again.`,
          thread_ts: event.ts
        });
      }
    }
    else if (intent === "recall_quote" && entities.quoteId) {
      // Handle quote recall directly
      try {
        // Verify quote exists
        const quote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        // Check if quote is already a draft
        if (quote.status === 'Draft') {
          await say({
            text: `Quote ${quote.name} (${quote.id}) is already in Draft status.`,
            thread_ts: event.ts
          });
          return;
        }
        
        // Process with explicit recall action
        await say({
          text: `🔄 Processing recall for quote ${quote.name} (${quote.id})...`,
          thread_ts: event.ts
        });
        
        // Update status in Salesforce
        await SalesforceAPI.updateQuoteStatus(conn, entities.quoteId, 'Draft');
        
        // Verify the change
        const updatedQuote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        if (updatedQuote.status === 'Draft') {
          await say({
            text: `✅ Quote ${quote.name} has been successfully recalled to Draft status!\n\n*Current status:* ${updatedQuote.status}\n\n*What would you like to do next?*\n• Make changes to the quote in Salesforce\n• Validate after changes with \`validate ${quote.id}\``,
            thread_ts: event.ts
          });
        } else {
          await say({
            text: `⚠️ I attempted to recall quote ${quote.name}, but the status is still: ${updatedQuote.status}\nThis might indicate a permissions issue in Salesforce.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        await say({
          text: `I couldn't recall the quote: ${error instanceof Error ? error.message : String(error)}\n\nPlease check your Salesforce permissions and try again.`,
          thread_ts: event.ts
        });
      }
    }
    else if (intent === "reject_quote" && entities.quoteId) {
      // Handle quote rejection directly
      try {
        // Verify quote exists
        const quote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        // Check if quote is already rejected
        if (quote.status === 'Rejected') {
          await say({
            text: `Quote ${quote.name} (${quote.id}) is already rejected.`,
            thread_ts: event.ts
          });
          return;
        }
        
        // Process with explicit rejection action
        await say({
          text: `🔄 Processing rejection for quote ${quote.name} (${quote.id})...`,
          thread_ts: event.ts
        });
        
        // Update status in Salesforce
        await SalesforceAPI.updateQuoteStatus(conn, entities.quoteId, 'Rejected');
        
        // Verify the change
        const updatedQuote = await SalesforceAPI.fetchQuote(conn, entities.quoteId);
        
        if (updatedQuote.status === 'Rejected') {
          await say({
            text: `✅ Quote ${quote.name} has been successfully rejected!\n\n*Current status:* ${updatedQuote.status}\n\n*What would you like to do next?*\n• Create a new version of this quote\n• List all quotes with \`list\``,
            thread_ts: event.ts
          });
        } else {
          await say({
            text: `⚠️ I attempted to reject quote ${quote.name}, but the status is still: ${updatedQuote.status}\nThis might indicate a permissions issue or approval process requirement in Salesforce.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        await say({
          text: `I couldn't reject the quote: ${error instanceof Error ? error.message : String(error)}\n\nPlease check your Salesforce permissions and try again.`,
          thread_ts: event.ts
        });
      }
    }
    else {
      // For unrecognized intents or those requiring a specific quote
      await say({
        text: `I need a specific quote to perform this action. Could you provide:\n• A quote ID (like \`a0qbm000000hporAAA\`)\n• A Salesforce URL to the quote\n• Or use the \`list\` command to see all available quotes`,
        thread_ts: event.ts
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ ERROR in processNaturalLanguageQuery: ${errorMessage}`);
    await say({
      text: `I hit a snag while trying to help you with that quote. 😅

The issue seems to be: ${errorMessage}

Let's try to fix this:
• Is the quote ID correct? You can use \`list\` to see all quotes
• Do you have the right Salesforce permissions?
• Sometimes just trying again works too!

Feel free to rephrase your request or ask for help - I'm here to assist! 🤝`,
      thread_ts: event.ts
    });
  }
};

// Command handlers
const commands: Record<string, Command> = {
  help: {
    name: 'help',
    description: 'Show available commands',
    handler: async (_, event, { say }) => {
      const helpText = Object.values(commands)
        .map(cmd => `• *${cmd.name}*: ${cmd.description}`)
        .join('\n');
      
      await say({
        text: `👋 Hi! I'm your friendly Quote-to-Cash Assistant. I'm here to help you manage your Salesforce quotes with ease!

You can talk to me naturally about quotes - just mention me in a message or share a Salesforce quote URL. I can help with things like:
• Checking quote details and status
• Validating quotes before approval
• Approving or recalling quotes
• Generating documents
• And more!

If you prefer using commands, here are the ones available:
${helpText}

💡 *Pro tip:* You can ask me questions in natural language, like:
• "What quotes do we have in CPQ?"
• "Can you check the status of quote a0qbm000000hporAAA?"
• "Is this quote ready for approval?"
• "When does this quote expire?"

Need anything else? Just ask! 😊`,
        thread_ts: event.ts
      });
    }
  },
  
  list: {
    name: 'list',
    description: 'List all quotes',
    handler: async (_, event, { say }) => {
      try {
        await say({
          text: `🔍 I'm fetching all quotes from Salesforce...`,
          thread_ts: event.ts
        });
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        const quotes = await SalesforceAPI.listQuotes(conn);
        
        if (quotes.length === 0) {
          await say({
            text: `I couldn't find any quotes in Salesforce. Would you like to create some demo data with the \`seed\` command?`,
            thread_ts: event.ts
          });
          return;
        }
        
        const quotesText = quotes.map(q => 
          `• *${q.name}* (${q.id})\n  Status: ${q.status}, Amount: $${q.amount}`
        ).join('\n');
        
        await say({
          text: `📊 I found ${quotes.length} quotes in Salesforce:\n\n${quotesText}\n\n*What would you like to do next?*\n• Get details on a specific quote with \`quote <id>\`\n• Validate a quote with \`validate <id>\`\n• Process all quotes with \`process\``,
          thread_ts: event.ts
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say({
          text: `I ran into an error listing quotes: ${errorMessage}\n\nPlease check your Salesforce connection and try again.`,
          thread_ts: event.ts
        });
      }
    }
  },
  
  quote: {
    name: 'quote',
    description: 'Process a specific quote by ID',
    handler: async (args, event, { say }) => {
      try {
        if (!args.trim()) {
          await say(`❌ Please provide a quote ID. Example: \`quote a088x000000Wsv0AAC\``);
          return;
        }
        
        await say(`🔍 Processing quote ${args}...`);
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        
        // Process the quote
        await processQuoteRequest(args, args.trim(), token, say, event.ts);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say(`❌ Error processing quote: ${errorMessage}`);
      }
    }
  },
  
  process: {
    name: 'process',
    description: 'Process all quotes',
    handler: async (_, event, { say }) => {
      await say(`👋 Starting to process quotes...`);
      try {
        await run();
        await say(`✅ Quote processing completed!`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say(`❌ Error occurred: ${errorMessage}`);
      }
    }
  },
  
  status: {
    name: 'status',
    description: 'Check current processing status',
    handler: async (_, event, { say }) => {
      try {
        const token = await getAuthToken();
        const conn = createConnection(token);
        const quotes = await SalesforceAPI.listQuotes(conn);
        
        // Group quotes by status
        const statusCount: Record<string, number> = {};
        quotes.forEach(quote => {
          statusCount[quote.status] = (statusCount[quote.status] || 0) + 1;
        });
        
        const statusText = Object.entries(statusCount)
          .map(([status, count]) => `• *${status}*: ${count} quotes`)
          .join('\n');
        
        await say(`🔍 The Q2C agent is ready to process quotes.\n\n*Current Quote Status:*\n${statusText}\n\nTotal: ${quotes.length} quotes`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say(`❌ Error checking status: ${errorMessage}`);
      }
    }
  },
  
  about: {
    name: 'about',
    description: 'Learn about this bot',
    handler: async (_, event, { say }) => {
      await say(`I'm your Q2C Assistant! I help process and manage quotes in Salesforce CPQ. You can mention me with a link to a quote, and I'll analyze and take appropriate action based on your request. Use \`help\` to see commands, or simply share your quote issue with a Salesforce link.`);
    }
  },
  
  seed: {
    name: 'seed',
    description: 'Create demo data in Salesforce',
    handler: async (args, event, { say }) => {
      try {
        await say(`🌱 Starting to create demo data in Salesforce...`);
        
        // If specific scenario is mentioned, create just that one
        if (args.trim()) {
          // Check for "all" option
          if (args.trim().toLowerCase() === 'all') {
            await say(`Creating all ${demoScenarios.length} demo scenarios. This may take a few minutes...`);
            
            const token = await getAuthToken();
            const conn = createConnection(token);
            
            for (const scenario of demoScenarios) {
              await say(`Creating scenario: ${scenario.name}`);
              
              try {
                const accountId = await createAccountIfNeeded(conn, scenario.account);
                const opportunityId = await createOpportunityIfNeeded(conn, scenario.opportunity, accountId);
                const quoteId = await createQuote(conn, scenario, opportunityId);
                
                await say({
                  text: `✅ Created: "${scenario.name}"\nSalesforce URL: ${token.instance_url}/lightning/r/SBQQ__Quote__c/${quoteId}/view`,
                  thread_ts: event.ts
                });
              } catch (error) {
                await say({
                  text: `❌ Failed to create scenario "${scenario.name}": ${error instanceof Error ? error.message : String(error)}`,
                  thread_ts: event.ts
                });
              }
            }
            
            await say(`🎉 Finished creating demo scenarios!`);
            return;
          }
          
          const scenarioIndex = parseInt(args.trim());
          if (!isNaN(scenarioIndex) && scenarioIndex >= 0 && scenarioIndex < demoScenarios.length) {
            const scenario = demoScenarios[scenarioIndex];
            await say(`Creating scenario: ${scenario.name} - ${scenario.description}`);
            
            // Create just one scenario
            const token = await getAuthToken();
            const conn = createConnection(token);
            
            // Create the data
            await say(`Creating account: ${scenario.account}`);
            const accountId = await createAccountIfNeeded(conn, scenario.account);
            
            await say(`Creating opportunity: ${scenario.opportunity}`);
            const opportunityId = await createOpportunityIfNeeded(conn, scenario.opportunity, accountId);
            
            await say(`Creating quote: ${scenario.name}`);
            const quoteId = await createQuote(conn, scenario, opportunityId);
            
            await say(`✅ Successfully created scenario "${scenario.name}"\nQuote ID: ${quoteId}\nSalesforce URL: ${token.instance_url}/lightning/r/SBQQ__Quote__c/${quoteId}/view`);
            return;
          }
          
          // List available scenarios if invalid index
          const scenarioList = demoScenarios.map((s, i) => `${i}: ${s.name} - ${s.description}`).join('\n');
          await say(`Invalid scenario index. Available scenarios:\n${scenarioList}\n\nUse \`seed [index]\` to create a specific scenario or \`seed all\` to create all scenarios.`);
          return;
        }
        
        // Otherwise, list the available scenarios
        const scenarioList = demoScenarios.map((s, i) => `${i}: ${s.name} - ${s.description}`).join('\n');
        await say(`Available scenarios:\n${scenarioList}\n\nUse \`seed [index]\` to create a specific scenario or \`seed all\` to create all scenarios.`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say(`❌ Error creating demo data: ${errorMessage}`);
      }
    }
  },
  
  approve: {
    name: 'approve',
    description: 'Approve a specific quote by ID',
    handler: async (args, event, { say }) => {
      try {
        if (!args.trim()) {
          await say({
            text: `I need a quote ID to approve. Example: \`approve a088x000000Wsv0AAC\``,
            thread_ts: event.ts
          });
          return;
        }
        
        await say({
          text: `🔍 I'm approving quote ${args.trim()}...`,
          thread_ts: event.ts
        });
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        
        // Fetch quote to verify it exists
        try {
          const quote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          // Check if quote is already approved
          if (quote.status === 'Approved') {
            await say({
              text: `This quote is already approved. Current status: ${quote.status}`,
              thread_ts: event.ts
            });
            return;
          }
          
          // Process the quote with an explicit approval request
          await processQuoteRequest(`approve ${args.trim()}`, args.trim(), token, say, event.ts);
          
          // Fetch the quote again to verify status changed
          const updatedQuote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          if (updatedQuote.status === 'Approved') {
            await say({
              text: `✅ Quote approval was successful! Current status: ${updatedQuote.status}`,
              thread_ts: event.ts
            });
          } else {
            await say({
              text: `⚠️ Quote was processed but status is still: ${updatedQuote.status}\nThis might indicate a permissions issue or approval process requirement in Salesforce.`,
              thread_ts: event.ts
            });
          }
        } catch (error) {
          await say({
            text: `I couldn't find quote with ID ${args.trim()}: ${error instanceof Error ? error.message : String(error)}\n\nTry the \`list\` command to see available quotes.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say({
          text: `I encountered an error approving the quote: ${errorMessage}\n\nPlease check your Salesforce connection and try again.`,
          thread_ts: event.ts
        });
      }
    }
  },
  
  reject: {
    name: 'reject',
    description: 'Reject a specific quote by ID',
    handler: async (args, event, { say }) => {
      try {
        if (!args.trim()) {
          await say({
            text: `I need a quote ID to reject. Example: \`reject a088x000000Wsv0AAC\``,
            thread_ts: event.ts
          });
          return;
        }
        
        await say({
          text: `🔍 I'm rejecting quote ${args.trim()}...`,
          thread_ts: event.ts
        });
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        
        // Fetch quote to verify it exists
        try {
          const quote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          // Check if quote is already rejected
          if (quote.status === 'Rejected') {
            await say({
              text: `This quote is already rejected. Current status: ${quote.status}`,
              thread_ts: event.ts
            });
            return;
          }
          
          // Process the quote with an explicit reject request
          await processQuoteRequest(`reject ${args.trim()}`, args.trim(), token, say, event.ts);
          
          // Fetch the quote again to verify status changed
          const updatedQuote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          if (updatedQuote.status === 'Rejected') {
            await say({
              text: `✅ Quote rejection was successful! Current status: ${updatedQuote.status}`,
              thread_ts: event.ts
            });
          } else {
            await say({
              text: `⚠️ Quote was processed but status is still: ${updatedQuote.status}\nThis might indicate a permissions issue or approval process requirement in Salesforce.`,
              thread_ts: event.ts
            });
          }
        } catch (error) {
          await say({
            text: `I couldn't find quote with ID ${args.trim()}: ${error instanceof Error ? error.message : String(error)}\n\nTry the \`list\` command to see available quotes.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say({
          text: `I encountered an error rejecting the quote: ${errorMessage}\n\nPlease check your Salesforce connection and try again.`,
          thread_ts: event.ts
        });
      }
    }
  },
  
  recall: {
    name: 'recall',
    description: 'Recall a quote (set back to Draft) by ID',
    handler: async (args, event, { say }) => {
      try {
        if (!args.trim()) {
          await say({
            text: `I need a quote ID to recall. Example: \`recall a088x000000Wsv0AAC\``,
            thread_ts: event.ts
          });
          return;
        }
        
        await say({
          text: `🔍 I'm recalling quote ${args.trim()}...`,
          thread_ts: event.ts
        });
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        
        // Fetch quote to verify it exists
        try {
          const quote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          // Check if quote is already a draft
          if (quote.status === 'Draft') {
            await say({
              text: `This quote is already in Draft status. Current status: ${quote.status}`,
              thread_ts: event.ts
            });
            return;
          }
          
          // Process the quote with an explicit recall request
          await processQuoteRequest(`recall ${args.trim()}`, args.trim(), token, say, event.ts);
          
          // Fetch the quote again to verify status changed
          const updatedQuote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          if (updatedQuote.status === 'Draft') {
            await say({
              text: `✅ Quote recall was successful! Current status: ${updatedQuote.status}`,
              thread_ts: event.ts
            });
          } else {
            await say({
              text: `⚠️ Quote was processed but status is still: ${updatedQuote.status}\nThis might indicate a permissions issue in Salesforce.`,
              thread_ts: event.ts
            });
          }
        } catch (error) {
          await say({
            text: `I couldn't find quote with ID ${args.trim()}: ${error instanceof Error ? error.message : String(error)}\n\nTry the \`list\` command to see available quotes.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say({
          text: `I encountered an error recalling the quote: ${errorMessage}\n\nPlease check your Salesforce connection and try again.`,
          thread_ts: event.ts
        });
      }
    }
  },
  
  validate: {
    name: 'validate',
    description: 'Validate a quote using the rules engine',
    handler: async (args, event, { say }) => {
      try {
        if (!args.trim()) {
          await say({
            text: `I need a quote ID to validate. Example: \`validate a088x000000Wsv0AAC\``,
            thread_ts: event.ts
          });
          return;
        }
        
        await say({
          text: `🔍 I'm validating quote ${args.trim()}...`,
          thread_ts: event.ts
        });
        
        const token = await getAuthToken();
        const conn = createConnection(token);
        
        // Fetch quote
        try {
          const quote = await SalesforceAPI.fetchQuote(conn, args.trim());
          
          // Validate quote
          await say({
            text: `📋 Running validation rules on quote: ${quote.name}...`,
            thread_ts: event.ts
          });
          
          const results = await validateQuote(standardRules)(quote);
          
          // Format results
          const hasErrors = Combinators.anyErrors(results);
          const onlyWarnings = Combinators.onlyWarnings(results);
          
          const formattedResults = results.map(r => {
            const icon = r.valid ? '✅' : (r.severity === ValidationSeverity.Error ? '❌' : '⚠️');
            return `${icon} ${r.message} (${r.severity})`;
          }).join('\n');
          
          let status = '✅ Quote validated successfully';
          let nextSteps = `*Next steps:*\n• Approve the quote with \`approve ${quote.id}\`\n• Generate document with \`docusign ${quote.id}\``;
          
          if (hasErrors) {
            status = '❌ Quote failed validation with errors';
            nextSteps = `*Next steps:*\n• Fix the errors in Salesforce\n• Run validation again after fixing issues`;
          } else if (onlyWarnings) {
            status = '⚠️ Quote passed with warnings';
            nextSteps = `*Next steps:*\n• Review warnings to determine if action is needed\n• Approve with caution using \`approve ${quote.id}\``;
          }
          
          await say({
            text: `*${status}*\n\n*Validation Results for ${quote.name}:*\n${formattedResults}\n\n${nextSteps}`,
            thread_ts: event.ts
          });
          
        } catch (error) {
          await say({
            text: `I couldn't find quote with ID ${args.trim()}: ${error instanceof Error ? error.message : String(error)}\n\nTry the \`list\` command to see available quotes.`,
            thread_ts: event.ts
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await say({
          text: `I encountered an error validating the quote: ${errorMessage}\n\nPlease check your Salesforce connection and try again.`,
          thread_ts: event.ts
        });
      }
    }
  },
};

// Validate environment variables
const validateEnv = (): RequiredEnv => {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'SF_CLIENT_ID',
    'SF_USERNAME',
    'SF_LOGIN_URL',
    'SF_PRIVATE_KEY_PATH',
    'OPENAI_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN!
  };
};

// Initialize Slack app
const initializeSlackApp = (env: RequiredEnv) => {
  return new App({
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: env.SLACK_APP_TOKEN,
  });
};

// Handle mentions with command parsing
const handleMention = async ({ event, say, client }: any) => {
  try {
    console.log(`📝 Processing mention: "${event.text}"`);
    
    // Extract possible Salesforce ID from the message
    const quoteId = extractSalesforceId(event.text);
    
    // If a Salesforce ID is found in the URL, process as a quote request
    if (quoteId) {
      console.log(`📝 Found Salesforce ID in URL: ${quoteId}`);
      const token = await getAuthToken();
      await processQuoteRequest(event.text, quoteId, token, say, event.ts);
      return;
    }
    
    // Check if this is a known command
    const [commandName, args] = parseMessage(event.text);
    const command = commands[commandName];
    
    if (command) {
      console.log(`🔧 COMMAND: Executing "${commandName}" with args: "${args}"`);
      await command.handler(args, event, { say, client });
      console.log(`✅ COMMAND: "${commandName}" execution completed`);
      return;
    }
    
    // Special handling for approval-related requests
    if (event.text.toLowerCase().includes('approve') && 
        event.text.toLowerCase().includes('quote')) {
      
      // Try to find a quote ID in the message using regex
      const idRegex = /\b([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\b/g;
      const matches = [...event.text.matchAll(idRegex)];
      
      if (matches.length > 0) {
        const potentialQuoteId = matches[0][1];
        console.log(`📝 Found potential Quote ID for approval: ${potentialQuoteId}`);
        
        // Verify if this is a valid quote ID
        try {
          const token = await getAuthToken();
          const conn = createConnection(token);
          
          console.log(`🔧 TOOL CALL: Verifying quote ID ${potentialQuoteId} with SalesforceAPI.fetchQuote`);
          const quote = await SalesforceAPI.fetchQuote(conn, potentialQuoteId);
          console.log(`🔧 TOOL RESPONSE: Quote found with name ${quote.name}`);
          
          // If we get here, the ID is valid
          await say({
            text: `I found a quote ID in your message. Would you like me to approve quote *${quote.name}* (${potentialQuoteId})?\n\nReply with "yes" to approve, or "no" to cancel.`,
            thread_ts: event.ts
          });
          
          // Here we'd need a proper way to handle the follow-up response
          // For now we'll just proceed with the natural language processing
          return;
        } catch (error) {
          // Not a valid quote ID - continue with natural language processing
          console.log(`📝 ID ${potentialQuoteId} not found in Salesforce - continuing with NLP`);
        }
      }
    }
    
    // Special handling for rejection/denial requests
    if ((event.text.toLowerCase().includes('deny') || event.text.toLowerCase().includes('reject')) && 
        event.text.toLowerCase().includes('quote')) {
      
      // Try to find a quote ID in the message using regex
      const idRegex = /\b([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)\b/g;
      const matches = [...event.text.matchAll(idRegex)];
      
      if (matches.length > 0) {
        const potentialQuoteId = matches[0][1];
        console.log(`📝 Found potential Quote ID for rejection: ${potentialQuoteId}`);
        
        // Verify if this is a valid quote ID
        try {
          const token = await getAuthToken();
          const conn = createConnection(token);
          const quote = await SalesforceAPI.fetchQuote(conn, potentialQuoteId);
          
          // If we get here, the ID is valid
          await say({
            text: `I found a quote ID in your message. Would you like me to reject quote *${quote.name}* (${potentialQuoteId})?\n\nReply with "yes" to reject, or "no" to cancel.`,
            thread_ts: event.ts
          });
          
          // Here we'd need a proper way to handle the follow-up response
          // For now we'll just proceed with the natural language processing
          return;
        } catch (error) {
          // Not a valid quote ID - continue with natural language processing
          console.log(`📝 ID ${potentialQuoteId} not found in Salesforce - continuing with NLP`);
        }
      }
    }
    
    // If not a command or URL, try to process as natural language query
    console.log(`📝 Processing as natural language query: "${event.text}"`);
    await processNaturalLanguageQuery(event.text, say, event);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error in handleMention: ${errorMessage}`);
    await say(`❌ Error occurred: ${errorMessage}\nTry \`help\` to see available commands.`);
  }
};

// Main function to start the bot
export const startBot = async () => {
  try {
    const env = validateEnv();
    const app = initializeSlackApp(env);

    // Listen for mentions
    app.event('app_mention', handleMention);

    // Listen for messages in channels where the app is present
    app.message(async ({ message, say, client }: any) => {
      // Only respond to messages that aren't from bots and contain Salesforce URLs
      if (!message.bot_id && message.text) {
        try {
          const quoteId = extractSalesforceId(message.text);
          
          if (quoteId) {
            // Process message with Salesforce URL
            const token = await getAuthToken();
            await processQuoteRequest(message.text, quoteId, token, say, message.ts);
          } else if (message.text.toLowerCase().includes('quote') || 
                     message.text.toLowerCase().includes('cpq') ||
                     message.text.endsWith('?')) {
            // Process as a natural language query about quotes
            await processNaturalLanguageQuery(message.text, say, message);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await say({
            text: `❌ Error processing message: ${errorMessage}`,
            thread_ts: message.ts
          });
        }
      }
    });

    await app.start();
    console.log('⚡️ Slack Q2C Bot is running!');
    console.log('Available commands:', Object.keys(commands).join(', '));
    
    return app;
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
};

// Start the bot
startBot(); 