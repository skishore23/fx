/**
 * Test script for the functional agent-fx.ts
 * Uses proper agent lifecycle methods
 */

import { runCoreWorkflow, codingAgent } from './agent-fx';
import { BaseContext, getEvents } from '@fx/core';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../../.env' });

// Define the agent state type
interface AgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentWorkingDirectory: string;
  verbose: boolean;
  lastResponse?: string;
  toolResults?: Array<{ toolName: string; result?: any; error?: string }>;
  toolsToUse?: string[];
  generateResponseResponse?: string;
  [key: string]: any;
}

async function testFunctionalAgent() {
  console.log('🧪 Testing Functional Agent-FX...\n');
  
  // Initialize state
  const initialState: AgentState = {
    conversation: [],
    currentWorkingDirectory: process.cwd(),
    verbose: true
  };
  
  // Test with a simple request
  initialState.conversation.push({
    role: 'user',
    content: 'list files in current directory'
  });
  
  try {
    console.log('🚀 Running core workflow with ledger logging...');
    const result = await runCoreWorkflow(initialState);
    
    console.log('✅ Test completed successfully!');
    console.log('Response:', result.conversation[result.conversation.length - 1]?.content);
    
    if (result.directoryContents) {
      console.log(`Found ${result.directoryContents.length} items in directory`);
    }
    
    const memory = (result.memory as any[]) || [];
    console.log('Memory entries:', memory.length);
    
    // Show memory entries
    if (memory.length > 0) {
      console.log('\n🧠 Memory entries:');
      memory.forEach((entry, index) => {
        console.log(`  ${index + 1}. [${entry.type}] ${entry.content}`);
      });
    }
    
    // Show ledger events
    const events = getEvents();
    if (events.length > 0) {
      console.log('\n📊 Ledger Events:');
      events.forEach((event, index) => {
        console.log(`  ${index + 1}. [${event.name}] ${event.timestamp}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testFunctionalAgent();
