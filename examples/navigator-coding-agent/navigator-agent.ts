/**
 * Navigator Coding Agent - Clean Topological Version
 * Demonstrates the key difference from flow agents: guard-driven execution
 */

import { 
  createAgent, 
  when, 
  step,
  updateState,
  addState,
  BaseContext,
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  createToolRegistry,
  createValidatedTool
} from '@fx/navigator';
import { Either, safe, safeAsync } from '@fx/core';
import { z } from 'zod';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../../.env' });

const execAsync = promisify(exec);

// ---------- Types ----------
interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified: string;
}

interface AgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentWorkingDirectory: string;
  verbose: boolean;
  lastResponse?: string;
  
  // Tool results
  directoryContents?: FileItem[];
  fileContent?: string;
  commandOutput?: string;
  
  // Topological state
  currentGoal?: string;
  toolsSelected?: boolean;
  toolsExecuted?: boolean;
  llmResponse?: string;
  analysisComplete?: boolean;
  [key: string]: unknown;
}

// ---------- Safe Functions ----------
const safeListFiles = safe((directoryPath: string): FileItem[] => {
  const resolvedPath = resolve(directoryPath);
  const items = readdirSync(resolvedPath);
  
  return items.map(item => {
    const itemPath = join(resolvedPath, item);
    const stats = statSync(itemPath);
    
    return {
      name: item,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.isFile() ? stats.size : undefined,
      modified: stats.mtime.toISOString()
    };
  });
});

const safeExecuteCommand = safeAsync((command: string) => 
  execAsync(command, { 
    timeout: 30000,
    maxBuffer: 1024 * 1024
  })
);

// ---------- Tool Registry ----------
const createTools = () => {
  const registry = createToolRegistry<AgentState>();

  registry.registerMany([
    createValidatedTool('list_files', 'List files in a directory', z.object({ directoryPath: z.string() }),
      async (input: { directoryPath: string }, state: AgentState) => {
        try {
          const result = await safeListFiles(input.directoryPath);
          return Either.fold(
            result,
            (error) => {
              console.error('❌ Error in list_files:', error.message);
              return updateState({ error: error.message } as Partial<AgentState>)(state);
            },
            (detailedItems) => {
              return updateState({ 
                directoryPath: input.directoryPath, 
                directoryContents: detailedItems 
              } as Partial<AgentState>)(state);
            }
          );
        } catch (error) {
          console.error('❌ Error in list_files:', error);
          return state;
        }
      }
    ),

    createValidatedTool('bash_command', 'Execute a shell command', z.object({ command: z.string() }),
      async (input: { command: string }, state: AgentState) => {
        try {
          const result = await safeExecuteCommand(input.command);
          return Either.fold(
            result,
            (error) => {
              console.error('❌ Error in bash_command:', error.message);
              return updateState({ error: error.message } as Partial<AgentState>)(state);
            },
            (execResult: { stdout: string; stderr: string }) => {
              return updateState({ 
                command: input.command, 
                commandOutput: execResult.stdout 
              } as Partial<AgentState>)(state);
            }
          );
        } catch (error) {
          console.error('❌ Error in bash_command:', error);
          return state;
        }
      }
    )
  ]);

  return registry;
};

// ---------- LLM Setup ----------
const SYSTEM_PROMPT_TEMPLATE = promptTemplate(
  'system',
  `You are a helpful coding assistant. You can help users with:

1. Reading and analyzing code files
2. Exploring directory structures  
3. Running shell commands safely

Current Goal: {{currentGoal}}

When a user asks you to do something, determine which tools you need and use them to provide helpful responses.

Always be precise, helpful, and explain what you're doing.`,
  ['currentGoal']
);

// ---------- Topological Steps ----------

/**
 * Step 1: Select tools based on user input
 * Runs when: conversation exists and tools not yet selected
 */
const selectTools = step('selectTools', 
  when(ctx => !!ctx.conversation?.length && !ctx.toolsSelected),
  (state: AgentState) => {
    const lastMessage = state.conversation[state.conversation.length - 1]?.content?.toLowerCase() || '';
    console.log('🔧 Step 1: Selecting tools for:', lastMessage);
    
    return updateState({ 
      currentGoal: lastMessage,
      toolsSelected: true
    } as Partial<AgentState>)(state);
  }
);

/**
 * Step 2: Execute tools based on the goal
 * Runs when: tools selected and not yet executed
 */
const executeTools = step('executeTools', 
  when(ctx => !!ctx.toolsSelected && !ctx.toolsExecuted),
  async (state: AgentState) => {
    console.log('🔧 Step 2: Executing tools for goal:', state.currentGoal);
    
    const tools = createTools();
    let currentState = state;
    
    // Execute list_files tool
    try {
      console.log('  - Executing list_files');
      const result = await tools.execute('list_files', { 
        ...currentState, 
        toolInput: { directoryPath: currentState.currentWorkingDirectory } 
      });
      currentState = result as AgentState;
    } catch (error) {
      console.error('Error executing list_files:', error);
    }
    
    // Execute bash_command tool
    try {
      console.log('  - Executing bash_command');
      const result = await tools.execute('bash_command', { 
        ...currentState, 
        toolInput: { command: 'ls -la' } 
      });
      currentState = result as AgentState;
    } catch (error) {
      console.error('Error executing bash_command:', error);
    }
    
    return updateState({
      toolsExecuted: true
    } as Partial<AgentState>)(currentState);
  }
);

/**
 * Step 3: Generate LLM response
 * Runs when: tools executed and no LLM response yet
 */
const generateResponse = step('generateResponse', 
  when(ctx => !!ctx.toolsExecuted && !ctx.llmResponse),
  async (state: AgentState) => {
    console.log('🧠 Step 3: Generating LLM response');
    
    const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
    
    const stateWithContext: AgentState = {
      ...state,
      currentGoal: state.currentGoal || 'No goal specified'
    };

    try {
      const llmResult = await llmTemplateStep(llmProvider, SYSTEM_PROMPT_TEMPLATE)(stateWithContext);
      const response = (llmResult as any).systemResponse || 'I understand your request. Let me help you with that using the available tools.';
      
      console.log('✅ LLM response generated');
      return updateState({ 
        llmResponse: response
      } as Partial<AgentState>)(llmResult);
    } catch (error) {
      console.log('⚠️ LLM call failed:', (error as Error).message);
      return updateState({ 
        llmResponse: 'I understand your request. Let me help you with that using the available tools.'
      } as Partial<AgentState>)(state);
    }
  }
);

/**
 * Step 4: Display final response and save to file
 * Runs when: LLM response generated and analysis not complete
 */
const displayResponse = step('displayResponse', 
  when(ctx => !!ctx.llmResponse && !ctx.analysisComplete),
  (state: AgentState) => {
    console.log('📝 Step 4: Displaying response');
    
    const response = state.llmResponse!;
    console.log(`🤖 Assistant: ${response}`);
    
    // Create and save the coding session report
    const sessionContent = `# Coding Agent Session Report

Generated on: ${new Date().toISOString()}
Goal: ${state.currentGoal}

## Assistant Response

${response}

## Directory Analysis

${state.directoryContents && state.directoryContents.length > 0 ? 
  `Found ${state.directoryContents.length} items in directory:\n\n` +
  state.directoryContents.map((item, index) => `${index + 1}. ${item.name} (${item.type})`).join('\n') : 
  'No directory contents were analyzed.'}

## Command Execution

${state.commandOutput ? 
  `Command executed: ${state.command}\n\nOutput:\n\`\`\`\n${state.commandOutput}\n\`\`\`` : 
  'No commands were executed.'}

## Session Summary

- Tools Selected: ${state.toolsSelected ? 'Yes' : 'No'}
- Tools Executed: ${state.toolsExecuted ? 'Yes' : 'No'}
- LLM Response: ${state.llmResponse ? 'Generated' : 'Not generated'}
- Analysis Complete: ${state.analysisComplete ? 'Yes' : 'No'}

---
*Generated by @fx/navigator Coding Agent*
`;

    try {
      const sessionPath = join(process.cwd(), `coding-session-${Date.now()}.md`);
      writeFileSync(sessionPath, sessionContent, 'utf-8');
      console.log(`\n📄 Coding session report saved to: ${sessionPath}`);
    } catch (error) {
      console.error('❌ Error saving session report:', error);
    }
    
    return updateState({
      lastResponse: response,
      analysisComplete: true,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    } as Partial<AgentState>)(state);
  }
);

// ---------- Example Usage ----------

async function runNavigatorAgent() {
  console.log('🚀 Navigator Coding Agent - Topological Execution\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    return;
  }

  // Create navigator agent with topological execution
  const agent = createAgent<AgentState>()
    .add(selectTools, executeTools, generateResponse, displayResponse);

  // Initialize state
  const initialState: AgentState = {
    conversation: [{ role: 'user', content: 'list files in current directory' }],
    currentWorkingDirectory: process.cwd(),
    verbose: true
  };

  try {
    console.log('🚀 Running navigator agent with topological execution...');
    const result = await agent.run(initialState);
    
    console.log('\n✅ Navigator Agent completed successfully!');
    console.log('Response:', result.ctx.conversation[result.ctx.conversation.length - 1]?.content);
    
    if (result.ctx.directoryContents) {
      console.log(`Found ${result.ctx.directoryContents.length} items in directory`);
    }
    
    console.log('\n📊 Execution Plan:');
    console.log(JSON.stringify(result.plan, null, 2));
    
    console.log('\n✅ Final Result:');
    console.log(`Goal: ${result.ctx.currentGoal}`);
    console.log(`Tools selected: ${result.ctx.toolsSelected}`);
    console.log(`Tools executed: ${result.ctx.toolsExecuted}`);
    console.log(`LLM response: ${!!result.ctx.llmResponse}`);
    console.log(`Analysis complete: ${result.ctx.analysisComplete}`);
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.duration}ms`);
  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
  }
}

// Run the example
runNavigatorAgent().catch(console.error);

export { runNavigatorAgent };
