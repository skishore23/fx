/**
 * Navigator Coding Agent - Topological version of the coding-agent
 * Uses guard-driven execution with real LLM and tools
 */

import { 
  createAgent, 
  when, 
  step,
  updateState,
  addState,
  BaseContext,
  sequence,
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  createToolRegistry,
  createValidatedTool,
  Step
} from '@fx/navigator';
import { Either, safe, safeAsync } from '@fx/core';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve, dirname } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../../.env' });

const execAsync = promisify(exec);

// ---------- Types (same as coding-agent) ----------
interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified: string;
}

interface ToolResult {
  toolName: string;
  result?: Record<string, unknown>;
  error?: string;
}

interface AgentState extends BaseContext {
  conversation: Array<{ role: string; content: string }>;
  currentWorkingDirectory: string;
  verbose: boolean;
  lastResponse?: string;
  toolResults?: ToolResult[];
  toolsToUse?: string[];
  generateResponseResponse?: string;
  
  // Tool results
  fileContent?: string;
  filePath?: string;
  directoryContents?: FileItem[];
  directoryPath?: string;
  commandOutput?: string;
  commandError?: string;
  command?: string;
  editedFile?: string;
  operation?: string;
  searchResults?: string;
  searchPattern?: string;
  
  // Topological state
  currentGoal?: string;
  analysisComplete?: boolean;
  [key: string]: unknown;
}

// ---------- Schemas (same as coding-agent) ----------
const ReadFileSchema = z.object({
  filePath: z.string()
});

const ListFilesSchema = z.object({
  directoryPath: z.string()
});

const BashCommandSchema = z.object({
  command: z.string(),
  workingDirectory: z.string().optional()
});

const EditFileSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  operation: z.enum(['create', 'update', 'append'])
});

const CodeSearchSchema = z.object({
  pattern: z.string(),
  directoryPath: z.string().optional(),
  filePattern: z.string().optional()
});

// ---------- Safe Functions (same as coding-agent) ----------
const safeReadFile = safe((filePath: string): string => {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return readFileSync(resolvedPath, 'utf-8');
});

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

const safeWriteFile = safe(({ filePath, content }: { filePath: string; content: string }): void => {
  const resolvedPath = resolve(filePath);
  const dir = dirname(resolvedPath);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(resolvedPath, content, 'utf-8');
});

const safeCodeSearch = safeAsync((pattern: string) => {
  const command = `rg --line-number --color=never "${pattern}" .`;
  return execAsync(command, {
    timeout: 10000,
    maxBuffer: 1024 * 1024
  }).then(result => result.stdout || 'No matches found');
}, (error) => {
  if ((error as any)?.code === 1) {
    throw new Error('No matches found');
  }
  return error as Error;
});

// ---------- LLM Provider & Prompts (same as coding-agent) ----------
const SYSTEM_PROMPT_TEMPLATE = promptTemplate(
  'system',
  `You are a helpful coding assistant. You can help users with:

1. Reading and analyzing code files
2. Exploring directory structures  
3. Running shell commands safely
4. Editing and creating files
5. Searching through codebases

You have access to these tools: read_file, list_files, bash_command, edit_file, code_search

Current Goal: {{currentGoal}}
Recent Memory: {{recentMemory}}

When a user asks you to do something, determine which tools you need and use them to provide helpful responses.

Always be precise, helpful, and explain what you're doing. If you encounter errors, explain them clearly and suggest solutions.`,
  ['currentGoal', 'recentMemory']
);

// ---------- Tool Registry (same as coding-agent) ----------
const createLocalToolRegistry = () => {
  const registry = createToolRegistry<AgentState>();

  const createToolStep = <T>(
    name: string,
    operation: () => Either<Error, T> | Promise<Either<Error, T>>,
    onSuccess: (value: T) => Record<string, any>,
    onError?: (error: Error) => Record<string, any>
  ): Step<AgentState> => {
    return step(name, when(() => true), async (state: AgentState) => {
      const result = await operation();
      
      return Either.fold(
        result,
        (error) => {
          const errorState = onError ? onError(error) : { error: error.message };
          return sequence([
            step('updateError', when(() => true), (s) => updateState(errorState)(s)),
            step('logError', when(() => true), (s) => addState('observation', `Error in ${name}: ${error.message}`)(s))
          ])(state);
        },
        (value) => {
          const successState = onSuccess(value);
          return sequence([
            step('updateResult', when(() => true), (s) => updateState(successState)(s)),
            step('logAction', when(() => true), (s) => addState('action', `${name} completed successfully`)(s))
          ])(state);
        }
      );
    });
  };

  registry.registerMany([
    createValidatedTool('read_file', 'Read a file from the filesystem', ReadFileSchema,
      async (input: { filePath: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'read_file',
          () => safeReadFile(input.filePath),
          (content) => ({ filePath: input.filePath, fileContent: content })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('list_files', 'List files in a directory', ListFilesSchema,
      async (input: { directoryPath: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'list_files',
          () => safeListFiles(input.directoryPath),
          (detailedItems) => ({ directoryPath: input.directoryPath, directoryContents: detailedItems })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('bash_command', 'Execute a shell command', BashCommandSchema,
      async (input: { command: string; workingDirectory?: string }, state: AgentState) => {
        const dangerousCommands = ['rm -rf', 'sudo', 'su', 'chmod 777', 'format', 'fdisk'];
        const isDangerous = dangerousCommands.some(dangerous => 
          input.command.toLowerCase().includes(dangerous.toLowerCase())
        );
        
        if (isDangerous) {
          const securityStep = step('security_block', when(() => true), async (s) => 
            sequence([
              step('updateError', when(() => true), (s) => updateState({ error: `Command blocked for security: ${input.command}` } as Partial<AgentState>)(s as AgentState)),
              step('logError', when(() => true), (s) => addState('observation', `Command blocked for security: ${input.command}`)(s))
            ])(s)
          );
          return await securityStep(state) as AgentState;
        }
        
        const toolStep = createToolStep(
          'bash_command',
          async () => await safeExecuteCommand(input.command),
          (result: { stdout: string; stderr: string }) => ({ 
            command: input.command, 
            commandError: result.stderr, 
            commandOutput: result.stdout 
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('edit_file', 'Create or edit a file', EditFileSchema,
      async (input: { filePath: string; content: string; operation: 'create' | 'update' | 'append' }, state: AgentState) => {
        const toolStep = createToolStep(
          'edit_file',
          () => safeWriteFile({ filePath: input.filePath, content: input.content }),
          () => ({ 
            filePath: input.filePath, 
            editedFile: input.content, 
            operation: input.operation 
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('code_search', 'Search for patterns in code', CodeSearchSchema,
      async (input: { pattern: string; directoryPath?: string; filePattern?: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'code_search',
          () => safeCodeSearch(input.pattern),
          (result) => ({ 
            searchPattern: input.pattern, 
            searchResults: result 
          })
        );
        return await toolStep(state) as AgentState;
      }
    )
  ]);

  return registry;
};

// ---------- Tool Selection Logic (Navigator version) ----------
const selectTools = step('selectTools', 
  when(ctx => !!ctx.conversation?.length && !ctx.toolsToUse),
  (state: AgentState) => {
    const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
    console.log('🔧 Selecting tools for:', lastMessage);
    
    const toolsToUse: string[] = [];
    
    if (lastMessage.includes('read') || lastMessage.includes('file')) {
      toolsToUse.push('read_file');
    }
    if (lastMessage.includes('list') || lastMessage.includes('directory')) {
      toolsToUse.push('list_files');
    }
    if (lastMessage.includes('run') || lastMessage.includes('command') || lastMessage.includes('git') || lastMessage.includes('npm')) {
      toolsToUse.push('bash_command');
    }
    if (lastMessage.includes('edit') || lastMessage.includes('create') || lastMessage.includes('write')) {
      toolsToUse.push('edit_file');
    }
    if (lastMessage.includes('search') || lastMessage.includes('find')) {
      toolsToUse.push('code_search');
    }
    
    if (toolsToUse.length === 0) {
      toolsToUse.push('list_files');
    }
    
    console.log('🔧 Selected tools:', toolsToUse);
    return updateState({ 
      toolsToUse,
      currentGoal: lastMessage
    } as Partial<AgentState>)(state);
  }
);

// ---------- Parameter Extraction (same as coding-agent) ----------
const extractToolParameters = (state: AgentState, toolName: string): Record<string, any> => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  const currentDir = state.currentWorkingDirectory || process.cwd();
  
  switch (toolName) {
    case 'list_files':
      const dirMatch = lastMessage.match(/(?:in|from|of)\s+([^\s]+)/);
      const extractedDir = dirMatch?.[1];
      return { directoryPath: extractedDir || currentDir };
      
    case 'read_file':
      const fileMatch = lastMessage.match(/(?:read|show|display|view|open)\s+([^\s]+\.\w+)/);
      return { filePath: fileMatch?.[1] || 'README.md' };
      
    case 'bash_command':
      const commandMatch = lastMessage.match(/(?:run|execute|git|npm|build|test)\s+([^.!?]+)/);
      return {
        command: commandMatch?.[1]?.trim() || 'ls -la',
        workingDirectory: currentDir
      };
      
    case 'edit_file':
      const editMatch = lastMessage.match(/(?:edit|modify|create|write)\s+([^\s]+)/);
      return {
        filePath: editMatch?.[1] || 'new-file.txt',
        content: '// New file content',
        operation: 'create' as const
      };
      
    case 'code_search':
      const searchMatch = lastMessage.match(/(?:search|find|grep)\s+([^\s]+)/);
      return {
        pattern: searchMatch?.[1] || 'function',
        directoryPath: currentDir
      };
      
    default:
      return {};
  }
};

// ---------- Tool Execution (Navigator version) ----------
const handleToolCalls = step('handleToolCalls', 
  when(ctx => !!ctx.toolsToUse?.length && !ctx.analysisComplete),
  async (state: AgentState) => {
    const toolsToUse = state.toolsToUse || [];
    console.log('🔧 Executing tools:', toolsToUse);
    
    const toolRegistry = createToolRegistry();
    let currentState = state;
    
    // Execute tools sequentially
    for (const toolName of toolsToUse) {
      try {
        const parameters = extractToolParameters(currentState, toolName);
        console.log(`🔧 Executing ${toolName} with params:`, parameters);
        
        const stateWithInput = { ...currentState, toolInput: parameters };
        currentState = await toolRegistry.execute(toolName, stateWithInput) as AgentState;
        console.log(`✅ ${toolName} completed`);
      } catch (error) {
        console.error(`❌ Error executing tool ${toolName}:`, error);
      }
    }
    
    return updateState({
      analysisComplete: true
    } as Partial<AgentState>)(currentState);
  }
);

// ---------- LLM Response Generation (Navigator version) ----------
const runInference = step('runInference', 
  when(ctx => !!ctx.toolsToUse?.length && !ctx.generateResponseResponse),
  async (state: AgentState) => {
    const lastMessage = state.conversation?.[state.conversation.length - 1];
    console.log('🧠 Running LLM inference for:', lastMessage?.content);
    
    const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
    
    const stateWithContext: AgentState = {
      ...state,
      currentGoal: lastMessage?.content || 'No goal specified',
      recentMemory: state.memory || []
    };

    try {
      const llmResult = await llmTemplateStep(llmProvider, SYSTEM_PROMPT_TEMPLATE)(stateWithContext);
      const response = (llmResult as any).systemResponse || 'I understand your request. Let me help you with that using the available tools.';
      console.log('✅ LLM response received:', response.substring(0, 100) + '...');
      return updateState({ 
        generateResponseResponse: response
      } as Partial<AgentState>)(llmResult);
    } catch (error) {
      console.log('⚠️ LLM call failed:', (error as Error).message);
      return updateState({ 
        generateResponseResponse: 'I understand your request. Let me help you with that using the available tools.'
      } as Partial<AgentState>)(state);
    }
  }
);

// ---------- Response Display (Navigator version) ----------
const displayResponse = step('displayResponse', 
  when(ctx => !!ctx.generateResponseResponse),
  (state: AgentState) => {
    const response = state.generateResponseResponse;
    console.log(`🤖 Assistant: ${response}`);
    return updateState({
      lastResponse: response,
      conversation: [...(state.conversation || []), { role: 'assistant', content: response }]
    } as Partial<AgentState>)(state);
  }
);

// ---------- Topological Steps (Navigator-specific) ----------

/**
 * Analyze directory structure (runs when tools are executed)
 */
const analyzeResults = step<AgentState>(
  'analyzeResults',
  when(ctx => !!ctx.directoryContents && !ctx.analysisComplete),
  async (ctx) => {
    console.log('📊 Analyzing results...');
    return updateState({
      analysisComplete: true
    } as Partial<AgentState>)(ctx);
  }
);

// ---------- Example Usage (Navigator version) ----------

async function runNavigatorCodingAgent() {
  console.log('🚀 Navigator Coding Agent - Topological version of coding-agent\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.log('Please set your OpenAI API key in the .env file');
    return;
  }

  // Create navigator agent with topological execution
  const agent = createAgent<AgentState>([selectTools, runInference, handleToolCalls, analyzeResults, displayResponse]);

  // Initialize state (same as coding-agent test)
  const initialState: AgentState = {
    conversation: [{ role: 'user', content: 'list files in current directory' }],
    currentWorkingDirectory: process.cwd(),
    verbose: true,
    toolResults: []
  };

  try {
    console.log('🚀 Running navigator workflow with real LLM and tools...');
    const result = await agent.run(initialState);
    
    console.log('✅ Test completed successfully!');
    console.log('Response:', result.ctx.conversation[result.ctx.conversation.length - 1]?.content);
    
    if (result.ctx.directoryContents) {
      console.log(`Found ${result.ctx.directoryContents.length} items in directory`);
    }
    
    console.log('\n📊 Memory entries:');
    if (result.ctx.memory) {
      console.log(`Memory entries: ${result.ctx.memory.length}`);
      result.ctx.memory.forEach((entry, index) => {
        console.log(`  ${index + 1}. [${entry.type}] ${entry.content}`);
      });
    }
    
    console.log('\n📊 Execution Plan:');
    console.log(JSON.stringify(result.plan, null, 2));
    
    console.log('\n✅ Final Result:');
    console.log(`Goal: ${result.ctx.currentGoal}`);
    console.log(`Directory analyzed: ${!!result.ctx.directoryContents}`);
    console.log(`Files read: ${result.ctx.filePath || 'none'}`);
    console.log(`Commands executed: ${result.ctx.command || 'none'}`);
    console.log(`Success: ${result.success}`);
    console.log(`Duration: ${result.duration}ms`);
  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    if (initialState.verbose) {
      console.error('Stack trace:', (error as Error).stack);
    }
  }
}

// Run the example
runNavigatorCodingAgent().catch(console.error);

export { runNavigatorCodingAgent };