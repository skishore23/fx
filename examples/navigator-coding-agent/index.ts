/**
 * Navigator Coding Agent - Topological version of the coding-agent
 * Uses guard-driven execution with real LLM and tools
 */

import { 
  createNavigatorAgent, 
  step
} from '@fx/navigator';
import { 
  // Core composition
  step as coreStep,
  sequence,
  when, 
  
  // State operations (lenses)
  set,
  get,
  push,
  updateState,
  logObservation,
  logAction,
  
  // LLM Provider
  createOpenAIProvider,
  llmTemplateStep,
  promptTemplate,
  
  // Tool Registry System
  createToolRegistry as createFxToolRegistry,
  createValidatedTool,
  
  // Safe Functions
  safe,
  safeAsync,
  
  // Pattern Matching
  createPatternMatcher,
  createPattern,
  patterns,
  
  // ReAct Patterns
  createReActPattern,
  createChainOfThoughtPattern,
  
  // Types
  BaseContext,
  Step,
  Either,
  
  // Ledger System
  enableLogging,
  logEvent,
  getEvents,
  
  // Memory system
  type MemoryEntry
} from '@fx/core';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve, dirname } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../../.env' });

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

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
  
  // Interactive state
  userInput?: string;
  shouldExit?: boolean;
  skipProcessing?: boolean;
  
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
  lastTool?: string;
  error?: string;
  
  // Memory system
  memory?: MemoryEntry[];
  memoryFiltered?: MemoryEntry[];
  recentMemory?: MemoryEntry[];
  
  // Chain of Thought properties
  problem?: string;
  thoughts?: Array<{
    step: number;
    thought: string;
    reasoning: string;
  }>;
  currentStep?: number;
  conclusion?: string;
  
  [key: string]: unknown;
}

// ============================================================================
// SCHEMAS
// ============================================================================

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

// ============================================================================
// SAFE FUNCTIONS
// ============================================================================

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

// ============================================================================
// TOOL SYSTEM
// ============================================================================

// Helper function to create tool steps with consistent error handling
  const createToolStep = <T>(
    name: string,
    operation: () => Either<Error, T> | Promise<Either<Error, T>>,
    onSuccess: (value: T) => Record<string, any>,
    onError?: (error: Error) => Record<string, any>
  ): Step<AgentState> => {
  return coreStep(name, async (state: AgentState) => {
      const result = await operation();
      
      return Either.fold(
        result,
        (error) => {
          const errorState = onError ? onError(error) : { error: error.message };
          return sequence([
          coreStep('updateError', (s) => updateState(errorState)(s)),
          coreStep('logError', (s) => logObservation(`Error in ${name}: ${error.message}`)(s))
          ])(state);
        },
        (value) => {
          const successState = onSuccess(value);
          return sequence([
          coreStep('updateResult', (s) => updateState(successState)(s)),
          coreStep('logAction', (s) => logAction(`${name} completed successfully`)(s))
          ])(state);
        }
      );
    });
  };

export const createToolRegistry = () => {
  const registry = createFxToolRegistry<AgentState>();

  // Register tools with proper schema validation
  registry.registerMany([
    createValidatedTool('read_file', 'Read and analyze code files', ReadFileSchema,
      async (input: { filePath: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'read_file',
          () => safeReadFile(input.filePath),
          (content) => ({
            filePath: input.filePath,
            fileContent: content,
            lastTool: 'read_file'
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('list_files', 'Explore directory structures', ListFilesSchema,
      async (input: { directoryPath: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'list_files',
          () => safeListFiles(input.directoryPath),
          (items) => ({
            directoryPath: input.directoryPath,
            directoryContents: items,
            lastTool: 'list_files'
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('bash_command', 'Run shell commands', BashCommandSchema,
      async (input: { command: string; workingDirectory?: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'bash_command',
          () => safeExecuteCommand(input.command),
          (result) => ({
            command: input.command,
            commandOutput: (result as any).stdout,
            commandError: (result as any).stderr,
            lastTool: 'bash_command'
          }),
          (error) => ({
            command: input.command, 
            commandError: error.message,
            lastTool: 'bash_command'
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('edit_file', 'Create, modify, and update files', EditFileSchema,
      async (input: { filePath: string; content: string; operation: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'edit_file',
          () => safeWriteFile({ filePath: input.filePath, content: input.content }),
          () => ({ 
            filePath: input.filePath, 
            editedFile: input.content, 
            operation: input.operation,
            lastTool: 'edit_file'
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('code_search', 'Search for patterns, functions, or specific code', CodeSearchSchema,
      async (input: { pattern: string; directoryPath?: string; filePattern?: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'code_search',
          () => safeCodeSearch(input.pattern),
          (results) => ({
            searchPattern: input.pattern, 
            searchResults: results,
            lastTool: 'code_search'
          })
        );
        return await toolStep(state) as AgentState;
      }
    )
  ]);

  return registry;
};

// ============================================================================
// LLM PROVIDER & PROMPTS
// ============================================================================

const llmProvider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const CODING_PROMPT_TEMPLATE = promptTemplate(
  'system',
  `You are an advanced AI coding assistant similar to Cursor. You can help users with:

1. **Code Generation**: Create new files, functions, classes, and complete applications
2. **Code Analysis**: Read, understand, and explain existing code
3. **Project Management**: Set up project structures, dependencies, and configurations
4. **Debugging**: Find and fix bugs, analyze error messages
5. **Testing**: Write and run tests, ensure code quality
6. **Refactoring**: Improve code structure, performance, and maintainability
7. **Documentation**: Generate README files, comments, and API docs

**Available Tools:**
- read_file: Read and analyze code files
- list_files: Explore directory structures
- bash_command: Run shell commands (git, npm, build, test, etc.)
- edit_file: Create, modify, and update files
- code_search: Search for patterns, functions, or specific code

**Current Context:**
- Goal: {{currentGoal}}
- Working Directory: {{currentWorkingDirectory}}
- Recent Memory: {{recentMemory}}

**Instructions:**
- Always think step-by-step about what needs to be done
- Generate complete, working code that can be executed
- Include proper error handling and documentation
- Test your code when possible
- Explain your reasoning and approach
- Ask clarifying questions if the request is ambiguous

**Code Quality Standards:**
- Write clean, readable, and maintainable code
- Follow best practices for the language/framework
- Include proper error handling
- Add comments for complex logic
- Ensure code is production-ready

When a user asks you to build something, create a complete working solution with all necessary files, dependencies, and instructions.`,
  ['currentGoal', 'recentMemory', 'currentWorkingDirectory']
);

// ============================================================================
// ENHANCED TOOL SELECTOR
// ============================================================================

// Functional tool matching utilities
const createToolMatcher = {
  // High-confidence matchers (exact patterns)
  exact: (keywords: string[], tools: string[], priority: number = 10) => 
    createPattern(
      patterns.all(...keywords.map(keyword => patterns.fieldContains('conversation', keyword))),
      () => tools,
      priority
    ),
  
  // Medium-confidence matchers (any of the keywords)
  any: (keywords: string[], tools: string[], priority: number = 8) =>
    createPattern(
      patterns.any(...keywords.map(keyword => patterns.fieldContains('conversation', keyword))),
      () => tools,
      priority
    ),
  
  // Semantic matchers (intent-based)
  semantic: (intent: string, tools: string[], priority: number = 7) => {
    const intentKeywords = {
      'file_operations': ['read', 'write', 'create', 'edit', 'file'],
      'directory_operations': ['list', 'explore', 'directory', 'folder'],
      'code_execution': ['run', 'execute', 'test', 'build', 'compile'],
      'code_search': ['search', 'find', 'grep', 'lookup']
    };
    
    const keywords = intentKeywords[intent as keyof typeof intentKeywords] || [intent];
    return createPattern(
      patterns.any(...keywords.map(k => patterns.fieldContains('conversation', k))),
      () => tools,
      priority
    );
  }
};

// Tool scoring system for intelligent selection
const calculateToolScore = (state: AgentState, tool: string): number => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  
  const toolScores: Record<string, { keywords: string[]; context: string[] }> = {
    read_file: {
      keywords: ['read', 'show', 'display', 'view', 'open'],
      context: ['file', 'code', 'content']
    },
    list_files: {
      keywords: ['list', 'show', 'explore', 'directory', 'folder'],
      context: ['files', 'directory', 'structure']
    },
    bash_command: {
      keywords: ['run', 'execute', 'git', 'npm', 'build', 'test'],
      context: ['command', 'shell', 'terminal']
    },
    edit_file: {
      keywords: ['create', 'write', 'edit', 'modify', 'update'],
      context: ['file', 'code', 'program']
    },
    code_search: {
      keywords: ['search', 'find', 'grep', 'lookup'],
      context: ['code', 'pattern', 'function']
    }
  };
  
  const toolConfig = toolScores[tool as keyof typeof toolScores];
  if (!toolConfig) return 0;
  
  let score = 0;
  
  // Keyword matching
  toolConfig.keywords.forEach(keyword => {
    if (lastMessage.includes(keyword)) score += 2;
  });
  
  // Context matching
  toolConfig.context.forEach(context => {
    if (lastMessage.includes(context)) score += 1;
  });
  
  return score;
};

// Enhanced tool selector with scoring and default
const createEnhancedToolSelector = (): ((state: AgentState) => string[]) => {
  const matcher = createPatternMatcher<AgentState, string[]>();
  
  // Register high-confidence patterns
  matcher.addMany([
    // File operations
    createToolMatcher.exact(['read', 'file'], ['read_file'], 10),
    createToolMatcher.any(['show', 'display'], ['read_file'], 9),
    
    // Directory operations
    createToolMatcher.exact(['list', 'files'], ['list_files'], 10),
    createToolMatcher.any(['explore', 'directory'], ['list_files'], 9),
    
    // Code execution
    createToolMatcher.any(['run', 'execute'], ['bash_command'], 8),
    createToolMatcher.any(['git', 'npm'], ['bash_command'], 9),
    
    // File editing
    createToolMatcher.any(['create', 'write'], ['edit_file'], 9),
    createToolMatcher.any(['edit', 'modify'], ['edit_file'], 8),
    
    // Code search
    createToolMatcher.any(['search', 'find'], ['code_search'], 8),
    createToolMatcher.any(['grep', 'lookup'], ['code_search'], 9)
  ]);
  
  return (state: AgentState): string[] => {
    // First try pattern matching
    const patternResult = matcher.createMatcher(() => [])(state);
    if (patternResult.length > 0) {
      return patternResult;
    }
    
    // Default to scoring system
    const allTools = ['read_file', 'list_files', 'bash_command', 'edit_file', 'code_search'];
    const scoredTools = allTools
      .map(tool => ({ tool, score: calculateToolScore(state, tool) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2) // Return top 2 tools
      .map(({ tool }) => tool);
    
    return scoredTools;
  };
};

// Create a step for tool selection
const selectTools = step('selectTools', 
  (ctx: AgentState) => !!ctx.conversation?.length && (!ctx.toolsToUse || ctx.toolsToUse.length === 0),
  async (state: AgentState) => {
    const toolSelector = createEnhancedToolSelector();
    const toolsToUse = toolSelector(state);
    
    // Log tool selection for ledger
    const lastMessage = state.conversation?.[state.conversation.length - 1]?.content || '';
    const scores = ['read_file', 'list_files', 'bash_command', 'edit_file', 'code_search']
      .map(tool => ({ tool, score: calculateToolScore(state, tool) }))
      .filter(({ score }) => score > 0);
    
    logEvent('workflow:tools_selected', {
      tools: toolsToUse,
      userInput: lastMessage,
      scores: scores,
      selectionMethod: toolsToUse.length > 0 ? 'pattern_matching' : 'scoring_default'
    });
    
    return updateState({ toolsToUse } as Partial<AgentState>)(state);
  }
);

// ============================================================================
// CHAIN OF THOUGHT CODING WORKFLOW
// ============================================================================

// Create Chain of Thought pattern for coding
const createCodingChainOfThought = (llmProvider: any) => {
  return createChainOfThoughtPattern(llmProvider);
};

// ============================================================================
// WORKFLOW STEPS
// ============================================================================

const toolRegistry = createToolRegistry();

const runInference = step('runInference', 
  (ctx: AgentState) => !!ctx.conversation?.length && !ctx.generateResponseResponse,
  async (state: AgentState): Promise<AgentState> => {
    const lastMessage = state.conversation?.[state.conversation.length - 1];
    
    // Update state with template context
    const stateWithContext: AgentState = {
      ...state,
      currentGoal: lastMessage?.content || 'No goal specified',
      recentMemory: (state.memory as any[])?.slice(-5) || []
    };

    // Call LLM with proper error handling using Either
    let result: Either<Error, AgentState>;
    try {
      const llmResult = await llmTemplateStep(llmProvider, CODING_PROMPT_TEMPLATE)(stateWithContext);
      result = Either.right(llmResult as AgentState);
    } catch (error) {
      result = Either.left(error as Error);
    }
    
    return Either.fold(
      result,
      (error) => {
        console.log('⚠️ LLM call failed:', error.message);
    return updateState({ 
          generateResponseResponse: 'I understand your coding request. Let me help you with that using the available tools.' 
    } as Partial<AgentState>)(state);
      },
      (llmResult) => updateState({ 
        generateResponseResponse: (llmResult as any).systemResponse 
      } as Partial<AgentState>)(state)
    );
  }
);

// Parameter extraction for tools
const extractToolParameters = (state: AgentState, toolName: string): Record<string, any> => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  
  switch (toolName) {
    case 'read_file':
      // Extract file path from message
      const fileMatch = lastMessage.match(/(?:read|show|display|view|open)\s+([^\s]+\.\w+)/);
      if (!fileMatch?.[0]) {
        throw new Error('No valid file path found in message. Please provide a file path to read.');
      }
      return { filePath: fileMatch[0] };
      
    case 'list_files':
      // Extract directory path
      const dirMatch = lastMessage.match(/(?:in|from|of)\s+([^\s]+)/);
      return { 
        directoryPath: dirMatch?.[1] || state.currentWorkingDirectory || process.cwd()
      };
      
    case 'bash_command':
      // Extract command
      const commandMatch = lastMessage.match(/(?:run|execute|git|npm|build|test)\s+([^.!?]+)/);
      if (!commandMatch?.[0]) {
        throw new Error('No valid command found in message. Please provide a command to execute.');
      }
      return {
        command: commandMatch[0].trim(),
        workingDirectory: state.currentWorkingDirectory || process.cwd()
      };
      
    case 'edit_file':
      // For editing, we'll use LLM to generate content
      const currentGoal = state.currentGoal || lastMessage;
      return {
        filePath: 'generated_code.py', // Default, can be improved
        content: '// Generated code will be created by LLM',
        operation: 'create'
      };
      
    case 'code_search':
      // Extract search pattern
      const searchMatch = lastMessage.match(/(?:search|find|grep)\s+([^\s]+)/);
      if (!searchMatch?.[0]) {
        throw new Error('No search pattern found in message. Please provide a pattern to search for.');
      }
      return {
        pattern: searchMatch[0],
        directoryPath: state.currentWorkingDirectory || process.cwd()
      };
      
    default:
      return {};
  }
};

const handleToolCalls = step('handleToolCalls', 
  (ctx: AgentState) => !!(ctx.toolsToUse && ctx.toolsToUse.length > 0) && !ctx.analysisComplete,
  async (state: AgentState): Promise<AgentState> => {
    const toolsToUse = state.toolsToUse || [];
    
    if (toolsToUse.length === 0) {
      return state;
    }
    
    // Log tool execution for ledger
    logEvent('workflow:tools_executed', {
      tools: toolsToUse,
      timestamp: new Date().toISOString()
    });
    
    // Execute tools using Kleisli composition
    const toolExecutionSteps = toolsToUse.map(toolName => 
      coreStep(`execute_${toolName}`, async (currentState: AgentState) => {
        const parameters = extractToolParameters(currentState, toolName);
        
        try {
          // Update state with tool input for the registry to use
        const stateWithInput = { ...currentState, toolInput: parameters };
          return await toolRegistry.execute(toolName, stateWithInput) as AgentState;
      } catch (error) {
          console.error(`Error executing tool ${toolName}:`, error);
          // Return state unchanged on error (fail gracefully)
          return currentState;
        }
      })
    );
    
    // Compose all tool executions using Kleisli composition
    if (toolExecutionSteps.length === 0) {
      return state;
    }
    
    const composedToolExecution = sequence(toolExecutionSteps);
    return await composedToolExecution(state);
  }
);

const updateConversation = step('updateConversation', 
  (ctx: AgentState) => !!ctx.generateResponseResponse,
  async (state: AgentState): Promise<AgentState> => {
    const assistantMessage = {
      role: 'assistant',
      content: state.generateResponseResponse || 'I completed the coding operations.'
    };
    
    return push('conversation', assistantMessage)(state) as AgentState;
  }
);

const displayResponse = step('displayResponse', 
  (ctx: AgentState) => !!ctx.generateResponseResponse,
  async (state: AgentState): Promise<AgentState> => {
    const skipProcessing = get('skipProcessing')(state) as boolean;
    if (skipProcessing) return state;
    
    const lastMessage = state.conversation[state.conversation.length - 1];
    console.log('\n🤖 Coding Assistant:', lastMessage?.content || 'No response');
    
    // Display Chain of Thought reasoning
    if (state.thoughts && state.thoughts.length > 0) {
      console.log('\n🧠 Chain of Thought Reasoning:');
      state.thoughts.forEach((thought, index) => {
        console.log(`  ${index + 1}. ${thought.thought}`);
        if (thought.reasoning) {
          console.log(`     Reasoning: ${thought.reasoning}`);
        }
      });
      console.log('');
    }
    
    if (state.conclusion) {
      console.log(`\n💡 Conclusion: ${state.conclusion}\n`);
    }
    
    // Display coding results
    if (state.directoryContents && state.directoryContents.length > 0) {
      console.log('\n📁 Directory Contents:');
      state.directoryContents.forEach((item, index) => {
        console.log(`  ${index + 1}. ${item.name} (${item.type})`);
      });
    }
    
    if (state.fileContent) {
      console.log('\n📄 File Content:');
      console.log(`  File: ${state.filePath}`);
      console.log(`  Content preview: ${state.fileContent.substring(0, 200)}...`);
    }
    
    if (state.commandOutput) {
      console.log('\n🔧 Command Output:');
      console.log(`  Command: ${state.command}`);
      console.log(`  Output: ${state.commandOutput}`);
    }
    
    if (state.editedFile) {
      console.log('\n✏️ File Created/Edited:');
      console.log(`  File: ${state.filePath}`);
      console.log(`  Content preview: ${state.editedFile.substring(0, 200)}...`);
    }
    
    if (state.searchResults) {
      console.log('\n🔍 Search Results:');
      console.log(`  Pattern: ${state.searchPattern}`);
      console.log(`  Results: ${state.searchResults}`);
    }
    
    console.log('');
    return state;
  }
);

// ============================================================================
// CHAIN OF THOUGHT WORKFLOW STEPS
// ============================================================================

// Initialize Chain of Thought state
const initializeChainOfThought = step('initializeChainOfThought', 
  (ctx: AgentState) => !!ctx.conversation?.length && !ctx.problem,
  async (state: AgentState): Promise<AgentState> => {
    const lastMessage = state.conversation?.[state.conversation.length - 1]?.content || '';
    
    return updateState({
      problem: lastMessage,
      thoughts: [],
      currentStep: 0,
      conclusion: undefined
    } as Partial<AgentState>)(state);
  }
);

// Execute Chain of Thought pattern
const executeChainOfThought = step('executeChainOfThought', 
  (ctx: AgentState) => !!ctx.problem && (!ctx.thoughts || ctx.thoughts.length === 0),
  async (state: AgentState): Promise<AgentState> => {
    try {
      // Ensure problem is defined
      if (!state.problem) {
        return state;
      }
      
      const pattern = createCodingChainOfThought(llmProvider);
      const result = await pattern.workflow(state as any);
      
      // Extract Chain of Thought results and merge with our state
    return updateState({
        thoughts: (result as any).thoughts || state.thoughts,
        conclusion: (result as any).conclusion || state.conclusion,
        currentStep: (result as any).currentStep || state.currentStep
      } as Partial<AgentState>)(state);
    } catch (error) {
      console.log('⚠️ Chain of Thought failed:', (error as Error).message);
      return state;
    }
  }
);

// ============================================================================
// CORE WORKFLOW
// ============================================================================

// Note: Core workflow removed as it's not used in the topological execution

// ============================================================================
// INTERACTIVE AGENT
// ============================================================================

async function runInteractiveCodingAgent() {
  console.log('🚀 Navigator Coding Agent - Topological Execution\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.log('Please set your OpenAI API key in the .env file');
    return;
  }

  // Enable logging
  enableLogging();
  console.log('📊 Ledger logging enabled for audit trail\n');

  // Create navigator agent with Chain of Thought workflow
  const agent = createNavigatorAgent<AgentState>([
    initializeChainOfThought,
    executeChainOfThought,
    selectTools,
    runInference,
    handleToolCalls,
    updateConversation,
    displayResponse
  ]);

  // Interactive loop
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const getUserInput = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('🎯 What would you like me to build? ', resolve);
    });
  };

  // Get user input once
  const userGoal = await getUserInput();
  
  if (userGoal.toLowerCase() === 'exit') {
    console.log('👋 Goodbye!');
    rl.close();
    return;
  }
  
  if (userGoal.toLowerCase() === 'help') {
    console.log('\n📋 Available commands:');
    console.log('  - Describe any coding task (e.g., "build a calculator in Python")');
    console.log('  - "exit" - quit the agent');
    console.log('  - "help" - show this help\n');
    rl.close();
    return;
  }
  
  if (!userGoal.trim()) {
    console.log('❓ Please enter a coding goal or type "help" for commands\n');
    rl.close();
    return;
  }

  console.log(`\n🎯 Goal: ${userGoal}\n`);

  // Initialize state with the user's goal
  const initialState: AgentState = {
    conversation: [{ role: 'user', content: userGoal }],
    currentWorkingDirectory: process.cwd(),
    verbose: true,
    toolResults: [],
    memory: [],
    userInput: userGoal,
    toolsToUse: [],
    currentGoal: userGoal,
    generateResponseResponse: '',
    lastResponse: '',
    shouldExit: false,
    skipProcessing: false,
    analysisComplete: false,
    // Chain of Thought properties
    problem: '',
    thoughts: [],
    currentStep: 0,
    conclusion: undefined
  };

  console.log('🤖 Starting topological execution...\n');

  try {
    // Run the topological agent once - it will execute all steps based on guards
    const result = await agent.run(initialState);
    
    console.log('\n✅ Task completed!');
    console.log(`Success: ${result.success}`);
    
    if (result.ctx.directoryContents) {
      console.log(`📁 Found ${result.ctx.directoryContents.length} items in directory`);
    }
    
    if (result.ctx.filePath) {
      console.log(`📄 Read file: ${result.ctx.filePath}`);
    }
    
    if (result.ctx.command) {
      console.log(`🔧 Executed command: ${result.ctx.command}`);
    }
    
    if (result.ctx.editedFile) {
      console.log(`✏️ Created/edited file: ${result.ctx.filePath}`);
    }
    
    // Show final response
    if (result.ctx.lastResponse) {
      console.log(`\n🤖 Final Response:\n${result.ctx.lastResponse}`);
    }
    
  } catch (error) {
    console.error('❌ Task failed:', (error as Error).message);
  } finally {
    rl.close();
  }
}

// Run the interactive agent
runInteractiveCodingAgent().catch(console.error);

export { runInteractiveCodingAgent };