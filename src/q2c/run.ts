import Fx from '../index';
import { q2cAgent, createInitialState, createAction } from './q2cAgent';
import { 
  AgentActionType, 
  AgentActionStatus, 
  AgentAction, 
  Quote, 
  OAuthToken,
  Q2CAgentState
} from './types';
import { SalesforceAPI, createOAuthConfig, getToken, createConnection, isLeft } from './salesforce';
import dotenv from 'dotenv';
import inquirer from 'inquirer';

// Use require for chalk to avoid ESM issues
const chalk = require('chalk');

// Load environment variables
dotenv.config();

// Define ExtendedQ2CAgentState type
interface ExtendedQ2CAgentState extends Q2CAgentState {
  lastThought?: {
    observation: string;
    reasoning: string;
    action: {
      type: AgentActionType;
      quoteId: string;
      reason: string;
    };
  };
}

// Add debug logging for agent
Fx.debug((event, state) => {
  const timestamp = new Date(event.ts).toLocaleTimeString();
  
  switch (true) {
    case event.name.startsWith('start:'):
      console.log(`\n🚀 [${timestamp}] Starting ${event.name.substring(6)}...`);
      break;
    case event.name.startsWith('stop:'):
      console.log(`\n✅ [${timestamp}] Completed ${event.name.substring(5)}`);
      break;
    case event.name === 'think':
      const thought = (state as ExtendedQ2CAgentState).lastThought;
      if (thought) {
        console.log('\n🤔 Observation:', thought.observation);
        console.log('💭 Reasoning:', thought.reasoning);
        console.log('🎯 Next Action:', thought.action.type);
      }
      break;
    case event.name === 'act':
      const action = (state as ExtendedQ2CAgentState).lastThought?.action;
      if (action) {
        console.log(`\n🔄 Executing: ${action.type}`);
        console.log(`📝 Quote: ${action.quoteId}`);
        if (action.reason) console.log(`📋 Reason: ${action.reason}`);
      }
      break;
    case event.name.includes('error'):
      console.error(`\n❌ [${timestamp}] Error:`, event.meta?.error);
      break;
  }
});

// Verify environment variables
const requiredEnvVars = [
  'SF_CLIENT_ID',      // Connected-app consumer key
  'SF_USERNAME',       // user@org
  'SF_LOGIN_URL',      // https://login.salesforce.com | https://test.salesforce.com
  'SF_PRIVATE_KEY_PATH', // path to server.key
  'OPENAI_API_KEY'     // OpenAI API key for ReAct agent
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.log('Please set the following required environment variables:');
  console.log('-------------------------------------------');
  missingVars.forEach(varName => {
    console.log(`${varName}: Required for Salesforce JWT authentication`);
    if (varName === 'SF_PRIVATE_KEY_PATH') {
      console.log('  The path to your Salesforce private key (server.key)');
    }
    if (varName === 'SF_CLIENT_ID') {
      console.log('  The client_id (consumer key) from your Salesforce Connected App');
    }
    if (varName === 'SF_USERNAME') {
      console.log('  The username of the Salesforce user to authenticate as (user@org)');
    }
    if (varName === 'SF_LOGIN_URL') {
      console.log('  The Salesforce login URL (https://login.salesforce.com or https://test.salesforce.com)');
    }
    if (varName === 'OPENAI_API_KEY') {
      console.log('  Your OpenAI API key for the ReAct agent');
    }
  });
  console.log('\nThen try running the script again.');
  process.exit(1);
}

// Get authentication token
const getAuthToken = async () => {
  // Minimal config for getToken
  const tokenConfig = {
    clientId: process.env.SF_CLIENT_ID!,
    loginUrl: 'https://login.salesforce.com',  // Use production URL directly
    subject: 'shimikeri.kishore@gmail.com.cpq'  // Your Salesforce username directly
  };

  const tokenResult = await getToken(tokenConfig);
  if (isLeft(tokenResult)) {
    throw new Error(`Authentication failed: ${tokenResult.left.message}`);
  }
  return tokenResult.right;
};

// Process a single quote with progress tracking
const processSingleQuote = async (quote: Quote, token: OAuthToken) => {
  console.log(`\n🔄 Processing quote: ${quote.id} (${quote.name})`);
  
  const initialState = {
    ...createInitialState(),
    pendingActions: [
      createAction(quote.id, AgentActionType.FetchQuote)
    ],
    metadata: { token }
  };

  try {
    const finalState = await q2cAgent(initialState, []);
    
    // Display processing results
    console.log('\n=== Quote Processing Results ===');
    console.log(`Quote: ${quote.name} (${quote.id})`);
    
    const validationResults = finalState.validationResults.get(quote.id);
    if (validationResults) {
      console.log('\nValidation Results:');
      validationResults.forEach(result => {
        const icon = result.valid ? '✅' : '❌';
        console.log(`${icon} ${result.message}`);
      });
    }

    const completedActions = finalState.pendingActions
      .filter(a => a.status === AgentActionStatus.Completed);
    
    console.log('\nCompleted Actions:');
    completedActions.forEach(action => {
      console.log(`✅ ${action.type}`);
      if (action.error) {
        console.log(`   ❌ Error: ${action.error.message}`);
      }
    });

    return finalState;
  } catch (error) {
    console.error(`\n❌ Error processing quote ${quote.id}:`, error);
    throw error;
  }
};

// Interactive CLI menu
const showMainMenu = async (quotes: Quote[]): Promise<string> => {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { name: '🔍 View all quotes', value: 'VIEW_ALL' },
        { name: '📝 Process specific quote', value: 'PROCESS_ONE' },
        { name: '📊 Process quotes by status', value: 'PROCESS_BY_STATUS' },
        { name: '🔄 Process all quotes sequentially', value: 'PROCESS_ALL' },
        { name: '❌ Exit', value: 'EXIT' }
      ]
    }
  ]);
  return action;
};

// Quote selection menu
const selectQuote = async (quotes: Quote[]): Promise<Quote> => {
  const { quoteId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'quoteId',
      message: 'Select a quote to process:',
      choices: quotes.map(q => ({
        name: `${q.name} (${q.id}) - Status: ${q.status}`,
        value: q.id
      }))
    }
  ]);
  return quotes.find(q => q.id === quoteId)!;
};

// Status selection menu
const selectStatus = async (): Promise<string> => {
  const { status } = await inquirer.prompt([
    {
      type: 'list',
      name: 'status',
      message: 'Select quotes by status:',
      choices: [
        { name: '📄 Draft', value: 'Draft' },
        { name: '⏳ Pending', value: 'Pending' },
        { name: '✅ Approved', value: 'Approved' },
        { name: '❌ Rejected', value: 'Rejected' }
      ]
    }
  ]);
  return status;
};

// Display quotes with more details
const displayQuotes = (quotes: Quote[]) => {
  console.log('\n=== Quotes Overview ===');
  quotes.forEach(q => {
    const statusColor = {
      'Draft': chalk.blue,
      'Pending': chalk.yellow,
      'Approved': chalk.green,
      'Rejected': chalk.red
    }[q.status] || chalk.white;

    console.log(`\n${chalk.bold(q.name)} (${q.id})`);
    console.log(`Status: ${statusColor(q.status)}`);
    console.log(`Amount: ${chalk.cyan('$' + q.amount)}`);
    console.log(`Created: ${new Date(q.createdAt).toLocaleString()}`);
    if (q.lastModifiedAt) {
      console.log(`Last Modified: ${new Date(q.lastModifiedAt).toLocaleString()}`);
    }
    if (q.lineItems.length > 0) {
      console.log(`Line Items: ${q.lineItems.length}`);
    }
  });
};

// Main CLI execution
export const run = async () => {
  try {
    console.log('\n🔑 Authenticating with Salesforce...');
    const token = await getAuthToken();
    
    // Get list of quotes
    const conn = createConnection(token);
    let quotes = await SalesforceAPI.listQuotes(conn);
    
    if (quotes.length === 0) {
      console.log('\n❌ No quotes found in Salesforce');
      return;
    }

    console.log(`\n📝 Found ${quotes.length} quotes`);
    
    while (true) {
      const action = await showMainMenu(quotes);
      
      switch (action) {
        case 'VIEW_ALL':
          displayQuotes(quotes);
          break;
          
        case 'PROCESS_ONE':
          const selectedQuote = await selectQuote(quotes);
          console.log('\n=== Starting Quote Processing ===');
          const result = await processSingleQuote(selectedQuote, token);
          
          // Refresh quotes list after processing
          quotes = await SalesforceAPI.listQuotes(conn);
          console.log('\n✅ Quote processing completed');
          break;
          
        case 'PROCESS_BY_STATUS':
          const status = await selectStatus();
          const filteredQuotes = quotes.filter(q => q.status === status);
          console.log(`\n📊 Processing ${filteredQuotes.length} ${status} quotes...`);
          
          for (const quote of filteredQuotes) {
            await processSingleQuote(quote, token);
            // Refresh quotes after each processing
            quotes = await SalesforceAPI.listQuotes(conn);
          }
          
          console.log(`\n✅ Completed processing ${filteredQuotes.length} quotes`);
          break;
          
        case 'PROCESS_ALL':
          console.log('\n🔄 Processing all quotes sequentially...');
          for (const quote of quotes) {
            await processSingleQuote(quote, token);
            // Refresh quotes after each processing
            quotes = await SalesforceAPI.listQuotes(conn);
          }
          console.log('\n✅ Completed processing all quotes');
          break;
          
        case 'EXIT':
          console.log('\n👋 Goodbye!');
          return;
      }
      
      // Add a pause between actions
      if (action !== 'EXIT') {
        console.log('\nPress Enter to continue...');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: '' }]);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Fatal Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

// Run the CLI
run();