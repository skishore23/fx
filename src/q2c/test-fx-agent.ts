import dotenv from 'dotenv';
import { createTestableWorkflow } from './q2cFxAgent';
import Fx from '../index';

// Load environment variables
dotenv.config();

// Mock Slack context
const mockSlack = {
  say: async (args: any) => {
    console.log(`📤 SLACK MESSAGE: ${args.text}`);
    return { ok: true };
  },
  threadTs: 'fake-thread-ts-123'
};

// Test different query types
const testQueries = [
  "list all quotes in Salesforce",
  "what's the approval status of all our pending quotes?",
  "approve quote a0qbm000000hqbFAAQ",
  "when will quote a0qbm000000hqbFAAQ expire?",
  "show me the details of quote a0qbm000000hpqTAAQ"
];

// Setup debug hook to monitor agent execution
Fx.debug((event, state) => {
  // Only log key events to avoid flooding console
  if (event.name === 'parse_intent' || 
      event.name === 'generate_plan' || 
      event.name.includes('tool:') ||
      event.name.startsWith('start:') ||
      event.name.startsWith('stop:')) {
    
    console.log(`\n🔄 EVENT: ${event.name}`);
    
    if (event.name === 'generate_plan') {
      console.log(`📋 PLAN REASONING: ${state.execution.plan?.reasoning}`);
      console.log("📋 STEPS:");
      state.execution.plan?.steps.forEach((step: any, i: number) => {
        console.log(`   ${i+1}. ${step.description} (${step.tool})`);
      });
    }
    
    if (event.name.includes('tool:')) {
      console.log(`🔧 ARGS: ${JSON.stringify(event.args)}`);
    }
  }
});

// Run tests
async function runTests() {
  console.log("🧪 Starting functional Q2C agent tests\n");
  
  // Create a testable workflow
  const workflow = createTestableWorkflow();
  
  // Run each test query
  for (const [index, query] of testQueries.entries()) {
    console.log(`\n\n✨ TEST ${index + 1}: "${query}"\n`);
    
    // Create initial state
    const initialState = {
      input: {
        raw: query,
        entities: {}
      },
      conversation: {
        slack: mockSlack,
        threadTs: mockSlack.threadTs,
        messages: [
          {
            role: 'user' as const,
            content: query,
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
    };
    
    try {
      // Run the workflow
      const finalState = await Fx.spawn(workflow, initialState);
      
      console.log(`\n✅ Test ${index + 1} completed`);
      console.log(`Final state - execution complete: ${finalState.execution.isComplete}`);
      
      if (finalState.execution.error) {
        console.log(`❌ Error during execution: ${finalState.execution.error}`);
      }
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`❌ Test ${index + 1} failed:`, error);
    }
  }
  
  console.log("\n🏁 All tests completed");
}

// Run tests
runTests().catch(error => {
  console.error("Critical test error:", error);
}); 