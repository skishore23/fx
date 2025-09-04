/**
 * Comprehensive Test Suite for Fixed Agent-FX
 * Tests complex scenarios including file operations, commands, and search
 */

import { runCoreWorkflow } from './agent-fx';
import { BaseContext } from '@fx/core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
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

class ComplexTestSuite {
  private testDir: string;

  constructor() {
    this.testDir = join(process.cwd(), 'test-workspace');
    this.setupTestEnvironment();
  }

  private setupTestEnvironment() {
    // Create test workspace
    if (!existsSync(this.testDir)) {
      mkdirSync(this.testDir, { recursive: true });
    }

    // Create test files
    const testFiles = [
      {
        path: join(this.testDir, 'hello.js'),
        content: `console.log('Hello, World!');
function greet(name) {
  return \`Hello, \${name}!\`;
}
module.exports = { greet };`
      },
      {
        path: join(this.testDir, 'package.json'),
        content: `{
  "name": "test-project",
  "version": "1.0.0",
  "description": "A test project for agent testing",
  "main": "hello.js",
  "scripts": {
    "start": "node hello.js",
    "test": "echo "No tests specified""
  }
}`
      },
      {
        path: join(this.testDir, 'README.md'),
        content: `# Test Project

This is a test project for demonstrating the agent's capabilities.

## Features
- File operations
- Code analysis
- Command execution

## Usage
\`\`\`bash
npm start
\`\`\``
      }
    ];

    testFiles.forEach(file => {
      writeFileSync(file.path, file.content, 'utf-8');
    });

    console.log('🧪 Test environment setup complete');
  }

  private async runTest(testName: string, userInput: string): Promise<AgentState> {
    console.log(`\n🔬 Running Test: ${testName}`);
    console.log(`📝 User Input: "${userInput}"`);
    console.log('─'.repeat(60));

    let state: AgentState = {
      conversation: [],
      currentWorkingDirectory: this.testDir,
      verbose: true
    };

    // Add user message
    state.conversation.push({
      role: 'user',
      content: userInput
    });

    try {
      console.log('🚀 Running core workflow...');
      state = await runCoreWorkflow(state as any) as AgentState;
      
      // Display results
      const lastMessage = state.conversation[state.conversation.length - 1];
      console.log(`🤖 Response: ${lastMessage?.content}`);
      
      if (state.toolResults && state.toolResults.length > 0) {
        console.log(`🔧 Tools Used: ${state.toolResults.length}`);
        state.toolResults.forEach((result, index) => {
          if (result.error) {
            console.log(`  ❌ ${result.toolName}: ${result.error}`);
          } else {
            console.log(`  ✅ ${result.toolName}: Success`);
            if (result.result.directoryContents) {
              console.log(`     Found ${result.result.directoryContents.length} items`);
            } else if (result.result.fileContent) {
              console.log(`     File content length: ${result.result.fileContent.length} chars`);
            } else if (result.result.commandOutput) {
              console.log(`     Command output: ${result.result.commandOutput.substring(0, 100)}...`);
            } else if (result.result.searchResults) {
              console.log(`     Search results: ${result.result.searchResults.substring(0, 100)}...`);
            }
          }
        });
      }

      const memory = (state.memory as any[]) || [];
      console.log(`🧠 Memory Entries: ${memory.length}`);
      
      return state;
    } catch (error) {
      console.error(`❌ Test "${testName}" failed:`, error);
      throw error;
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Comprehensive Agent Test Suite\n');
    console.log('='.repeat(80));

    const tests = [
      {
        name: 'File Listing',
        input: 'list all files in the current directory'
      },
      {
        name: 'File Reading',
        input: 'read the hello.js file'
      },
      {
        name: 'Package.json Analysis',
        input: 'read package.json and show me the scripts'
      },
      {
        name: 'Command Execution',
        input: 'run npm start command'
      },
      {
        name: 'Code Search',
        input: 'search for the word "Hello" in all files'
      },
      {
        name: 'Function Search',
        input: 'search for function definitions in JavaScript files'
      },
      {
        name: 'File Creation',
        input: 'create a new file called test.txt with content "This is a test file"'
      },
      {
        name: 'Complex Query',
        input: 'analyze the project structure and tell me what this project does'
      }
    ];

    const results = [];
    
    for (const test of tests) {
      try {
        const result = await this.runTest(test.name, test.input);
        results.push({ test: test.name, success: true, result });
        
        // Add delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({ test: test.name, success: false, error });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${((successful / results.length) * 100).toFixed(1)}%`);
    
    console.log('\n📋 Detailed Results:');
    results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      console.log(`  ${index + 1}. ${status} ${result.test}`);
    });

    return results;
  }

  async demonstrateMemorySystem() {
    console.log('\n🧠 MEMORY SYSTEM DEMONSTRATION');
    console.log('─'.repeat(60));

    let state: AgentState = {
      conversation: [],
      currentWorkingDirectory: this.testDir,
      verbose: true
    };

    // Run a series of operations to build memory
    const operations = [
      'list files in current directory',
      'read hello.js file',
      'search for "console" in all files'
    ];

    for (const operation of operations) {
      state.conversation.push({ role: 'user', content: operation });
      state = await runCoreWorkflow(state as any) as AgentState;
    }

    // Analyze memory
    const memory = (state.memory as any[]) || [];
    console.log(`Total Memory Entries: ${memory.length}`);
    
    console.log('\n📝 Memory Timeline:');
    memory.forEach((entry, index) => {
      console.log(`  ${index + 1}. [${entry.type}] ${entry.content}`);
    });

    // Group by type
    const byType = memory.reduce((acc, entry) => {
      acc[entry.type] = (acc[entry.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Memory by Type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} entries`);
    });
  }
}

// Main execution
async function runComplexTests() {
  try {
    const testSuite = new ComplexTestSuite();
    
    // Run comprehensive tests
    await testSuite.runAllTests();
    
    // Demonstrate memory system
    await testSuite.demonstrateMemorySystem();
    
    console.log('\n🎉 Complex test suite completed successfully!');
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runComplexTests();
}
