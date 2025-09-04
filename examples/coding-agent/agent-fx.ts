/**
 * Coding Agent using proper Fx Framework patterns
 * Clean functional implementation with no duplication
 */

import { 
  // Core composition
  step,
  loopWhile,
  when,
  sequence,
  
  // State operations (lenses)
  set,
  get,
  push,
  updateState,
  addState,
  
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
  
  // Types
  BaseContext,
  Step,
  createPlan,
  createAgent,
  Either,
  
  // Ledger System
  enableLogging,
  disableLogging,
  logEvent,
  getEvents
} from '@fx/core';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, resolve, dirname } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from root directory
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
  // Interactive loop properties
  userInput?: string;
  shouldExit?: boolean;
  skipProcessing?: boolean;
  error?: string;
  stack?: string;
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
  return step(name, async (state: AgentState) => {
    const result = await operation();
    
    return Either.fold(
      result,
      (error) => {
        const errorState = onError ? onError(error) : { error: error.message };
        return sequence([
          step('updateError', (s) => updateState(errorState)(s)),
          step('logError', (s) => addState('observation', `Error in ${name}: ${error.message}`)(s))
        ])(state);
      },
      (value) => {
        const successState = onSuccess(value);
        return sequence([
          step('updateResult', (s) => updateState(successState)(s)),
          step('logAction', (s) => addState('action', `${name} completed successfully`)(s))
        ])(state);
      }
    );
  });
};

const createToolRegistry = () => {
  const registry = createFxToolRegistry<AgentState>();

  // Register tools with proper schema validation
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
        // Security check
        const dangerousCommands = ['rm -rf', 'sudo', 'su', 'chmod 777', 'format', 'fdisk'];
        const isDangerous = dangerousCommands.some(dangerous => 
          input.command.toLowerCase().includes(dangerous.toLowerCase())
        );
        
        if (isDangerous) {
          const securityStep = step('security_block', (s) => 
            sequence([
              step('updateError', (s) => updateState({ error: `Command blocked for security: ${input.command}` })(s)),
              step('logError', (s) => addState('observation', `Command blocked for security: ${input.command}`)(s))
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
            operation: input.operation, 
            fileContent: input.content, 
            editedFile: input.filePath 
          })
        );
        return await toolStep(state) as AgentState;
      }
    ),

    createValidatedTool('code_search', 'Search for patterns in code', CodeSearchSchema,
      async (input: { pattern: string; directoryPath?: string; filePattern?: string }, state: AgentState) => {
        const toolStep = createToolStep(
          'code_search',
          async () => await safeCodeSearch(input.pattern),
          (searchResults: string) => ({ 
            searchPattern: input.pattern, 
            searchResults 
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
  
  // Context-aware matchers (combines multiple conditions)
  contextual: (conditions: Array<{ keywords: string[]; required: boolean }>, tools: string[], priority: number = 9) => {
    const patternConditions = conditions
      .filter(({ required }) => required) // Only use required conditions for now
      .map(({ keywords }) => patterns.any(...keywords.map(k => patterns.fieldContains('conversation', k))));
    
    return createPattern(
      patterns.all(...patternConditions),
      () => tools,
      priority
    );
  },
  
  // Semantic matchers (intent-based)
  semantic: (intent: string, tools: string[], priority: number = 7) => {
    const intentKeywords = {
      'file_operations': ['file', 'read', 'write', 'edit', 'create', 'delete'],
      'directory_operations': ['directory', 'folder', 'list', 'explore', 'navigate'],
      'code_operations': ['code', 'search', 'find', 'grep', 'pattern'],
      'system_operations': ['run', 'execute', 'command', 'bash', 'shell', 'git'],
      'analysis_operations': ['analyze', 'review', 'check', 'inspect', 'examine']
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
  
  const toolScores: Record<string, { keywords: string[]; extensions?: string[]; context: string[] }> = {
    read_file: {
      keywords: ['read', 'show', 'display', 'view', 'open', 'file'],
      extensions: ['.js', '.ts', '.json', '.md', '.txt', '.py', '.java'],
      context: ['file', 'content', 'code']
    },
    list_files: {
      keywords: ['list', 'show', 'directory', 'folder', 'files', 'ls'],
      context: ['directory', 'folder', 'contents', 'structure']
    },
    bash_command: {
      keywords: ['run', 'execute', 'command', 'git', 'npm', 'build', 'test'],
      context: ['terminal', 'shell', 'command', 'script']
    },
    edit_file: {
      keywords: ['edit', 'modify', 'change', 'update', 'create', 'write'],
      context: ['file', 'code', 'content', 'modify']
    },
    code_search: {
      keywords: ['search', 'find', 'grep', 'pattern', 'look', 'locate'],
      context: ['code', 'function', 'class', 'pattern', 'search']
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
  
  // Extension matching (for read_file)
  if (tool === 'read_file' && toolConfig.extensions) {
    toolConfig.extensions.forEach((ext: string) => {
      if (lastMessage.includes(ext)) score += 3;
    });
  }
  
  return score;
};

// Enhanced tool selector with scoring and fallback
const createEnhancedToolSelector = (): ((state: AgentState) => string[]) => {
  const matcher = createPatternMatcher<AgentState, string[]>();
  
  // Register high-confidence patterns
  matcher.addMany([
    // File operations
    createToolMatcher.exact(['read', 'file'], ['read_file'], 10),
    createToolMatcher.contextual([
      { keywords: ['read'], required: true },
      { keywords: ['.js', '.ts', '.json', '.md', '.txt'], required: false }
    ], ['read_file'], 9),
    
    // Directory operations
    createToolMatcher.any(['list', 'files'], ['list_files'], 9),
    createToolMatcher.any(['directory', 'folder'], ['list_files'], 8),
    
    // System operations
    createToolMatcher.any(['run', 'execute'], ['bash_command'], 8),
    createToolMatcher.any(['git', 'npm', 'build'], ['bash_command'], 9),
    
    // File editing
    createToolMatcher.any(['edit', 'modify'], ['edit_file'], 8),
    createToolMatcher.any(['create', 'write'], ['edit_file'], 7),
    
    // Code search
    createToolMatcher.any(['search', 'find'], ['code_search'], 8),
    createToolMatcher.semantic('code_operations', ['code_search'], 7)
  ]);
  
  return (state: AgentState): string[] => {
    // First try pattern matching
    const patternResult = matcher.createMatcher(() => [])(state);
    if (patternResult.length > 0) {
      return patternResult;
    }
    
    // Fallback to scoring system
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
const selectTools = step('selectTools', (state: AgentState) => {
  const toolSelector = createEnhancedToolSelector();
  const toolsToUse = toolSelector(state);
  
  // Log tool selection for ledger with scoring info
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content || '';
  const scores = ['read_file', 'list_files', 'bash_command', 'edit_file', 'code_search']
    .map(tool => ({ tool, score: calculateToolScore(state, tool) }))
    .filter(({ score }) => score > 0);
  
  logEvent('workflow:tools_selected', {
    tools: toolsToUse,
    userInput: lastMessage,
    scores: scores,
    selectionMethod: toolsToUse.length > 0 ? 'pattern_matching' : 'scoring_fallback'
  });
  
  return updateState({ toolsToUse })(state);
});

// ============================================================================
// WORKFLOW STEPS
// ============================================================================

const toolRegistry = createToolRegistry();

const runInference = step('runInference', async (state: AgentState) => {
  const lastMessage = state.conversation?.[state.conversation.length - 1];
  
  // Update state with template context
  const stateWithContext: AgentState = {
    ...state,
    currentGoal: lastMessage?.content || 'No goal specified',
    recentMemory: get('memory')(state) || []
  };

  // Call LLM with proper error handling using Either
  let result: Either<Error, AgentState>;
  try {
    const llmResult = await llmTemplateStep(llmProvider, SYSTEM_PROMPT_TEMPLATE)(stateWithContext);
    result = Either.right(llmResult as AgentState);
  } catch (error) {
    result = Either.left(error as Error);
  }
  
  return Either.fold(
    result,
    (error) => {
      console.log('⚠️ LLM call failed:', error.message);
      return sequence([
        step('updateResponse', (s) => updateState({ generateResponseResponse: 'I understand your request. Let me help you with that using the available tools.' })(s)),
        step('logObservation', (s) => addState('observation', `Generated fallback response for: ${lastMessage?.content}`)(s))
      ])(state);
    },
    (llmResult) => sequence([
      step('updateResponse', (s) => updateState({ generateResponseResponse: (llmResult as any).systemResponse })(s)),
      step('logObservation', (s) => addState('observation', `Generated response for: ${lastMessage?.content}`)(s))
    ])(llmResult)
  );
});

// Parameter extraction for tools
const extractToolParameters = (state: AgentState, toolName: string): Record<string, any> => {
  const lastMessage = state.conversation?.[state.conversation.length - 1]?.content?.toLowerCase() || '';
  const currentDir = state.currentWorkingDirectory || process.cwd();
  
  switch (toolName) {
    case 'list_files':
      // Extract directory path or use current directory
      const dirMatch = lastMessage.match(/(?:in|from|of)\s+([^\s]+)/);
      const extractedDir = dirMatch?.[1];
      
      // Handle special cases
      if (extractedDir === 'current' || extractedDir === 'current directory' || !extractedDir) {
        return { directoryPath: currentDir };
      }
      
      return { directoryPath: extractedDir };
      
    case 'read_file':
      // Extract file path
      const fileMatch = lastMessage.match(/(?:read|show|display|view|open)\s+([^\s]+\.\w+)/);
      return {
        filePath: fileMatch?.[1] || 'README.md' // fallback
      };
      
    case 'bash_command':
      // Extract command
      const commandMatch = lastMessage.match(/(?:run|execute|git|npm|build|test)\s+([^.!?]+)/);
      return {
        command: commandMatch?.[1]?.trim() || 'ls -la',
        workingDirectory: currentDir
      };
      
    case 'edit_file':
      // Extract file path and content hint
      const editMatch = lastMessage.match(/(?:edit|modify|create|write)\s+([^\s]+)/);
      return {
        filePath: editMatch?.[1] || 'new-file.txt',
        content: '// New file content',
        operation: 'create' as const
      };
      
    case 'code_search':
      // Extract search pattern
      const searchMatch = lastMessage.match(/(?:search|find|grep)\s+([^\s]+)/);
      return {
        pattern: searchMatch?.[1] || 'function',
        directoryPath: currentDir
      };
      
    default:
      return {};
  }
};

const handleToolCalls = step('handleToolCalls', async (state: AgentState) => {
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
    step(`execute_${toolName}`, async (currentState: AgentState) => {
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
});

const updateConversation = step('updateConversation', (state: AgentState) => {
  const assistantMessage = {
    role: 'assistant',
    content: state.generateResponseResponse || 'I completed the requested operations.'
  };
  
  return push('conversation', assistantMessage)(state);
});

// ============================================================================
// INTERACTIVE STEPS
// ============================================================================

const getUserInput = step('getUserInput', async (state: AgentState) => {
  process.stdout.write('> ');
  const userInput = await new Promise<string>((resolve) => {
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
  
  return updateState({ userInput })(state);
});

const checkExit = step('checkExit', (state: AgentState) => {
  const userInput = get('userInput')(state) as string;
  const shouldExit = userInput?.toLowerCase() === 'exit';
  return updateState({ shouldExit })(state);
});

const handleEmptyInput = step('handleEmptyInput', (state: AgentState): AgentState => {
  const userInput = get('userInput')(state) as string;
  const skipProcessing = !userInput || userInput.trim() === '';
  return updateState({ skipProcessing })(state) as AgentState;
});

const addUserMessage = step('addUserMessage', (state: AgentState): AgentState => {
  const userInput = get('userInput')(state) as string;
  const skipProcessing = get('skipProcessing')(state) as boolean;
  
  if (skipProcessing) return state;
  
  const userMessage = {
    role: 'user' as const,
    content: userInput
  };
  
  return {
    ...state,
    conversation: [...state.conversation, userMessage]
  };
});


const displayResponse = step('displayResponse', (state: AgentState) => {
  const skipProcessing = get('skipProcessing')(state) as boolean;
  if (skipProcessing) return state;
  
  const lastMessage = state.conversation[state.conversation.length - 1];
  console.log('\n🤖 Assistant:', lastMessage?.content || 'No response');
  
  const toolResults = get('toolResults')(state) as ToolResult[] || [];
  if (toolResults.length > 0) {
    console.log('\n🔧 Tool Results:');
    for (const result of toolResults) {
      if (result.error) {
        console.log(`  ❌ ${result.toolName}: ${result.error}`);
      } else {
        console.log(`  ✅ ${result.toolName}:`);
        if (result.result?.fileContent && typeof result.result.fileContent === 'string') {
          console.log(`     File content: ${result.result.fileContent.substring(0, 100)}...`);
        } else if (result.result?.directoryContents && Array.isArray(result.result.directoryContents)) {
          console.log(`     Found ${result.result.directoryContents.length} items`);
        } else if (result.result?.commandOutput && typeof result.result.commandOutput === 'string') {
          console.log(`     Command output: ${result.result.commandOutput.substring(0, 100)}...`);
        } else {
          console.log(`     ${JSON.stringify(result.result, null, 2)}`);
        }
      }
    }
  }
  
  console.log('');
  return state;
});

const handleError = step('handleError', (state: AgentState) => {
  const error = get('error')(state);
  if (error) {
    console.error('❌ Error:', error);
    if (state.verbose) {
      const stack = get('stack')(state);
      console.error('Stack trace:', stack);
    }
    return updateState({ error: undefined, stack: undefined })(state);
  }
  return state;
});

// ============================================================================
// CORE WORKFLOW
// ============================================================================

const coreWorkflow = sequence([
  selectTools,
  runInference,
  handleToolCalls,
  updateConversation
]);

// ============================================================================
// INTERACTIVE AGENT
// ============================================================================

const conversationLoop = sequence([
  getUserInput,
  checkExit,
  handleEmptyInput,
  when((state: AgentState) => !(get('shouldExit')(state) as boolean), sequence([
    addUserMessage,
    coreWorkflow,
    displayResponse,
    handleError
  ]))
]);

const plan = createPlan('coding-agent', [
  step('initialize', (state: AgentState) => {
    console.log('Type your message and press Enter. Type "exit" to quit.\n');
    return state;
  }),
  loopWhile(
    (state: AgentState) => !(get('shouldExit')(state) as boolean),
    conversationLoop
  ),
  step('goodbye', (state: AgentState) => {
    console.log('👋 Goodbye!');
    return state;
  })
]);

// ============================================================================
// EXPORTS
// ============================================================================

export const codingAgent = createAgent('coding-agent', plan);

// Helper function for testing - runs core workflow without interactive loop
export async function runCoreWorkflow(state: AgentState): Promise<AgentState> {
  // Enable logging for tests too
  enableLogging();
  return await coreWorkflow(state) as AgentState;
}

export async function runCodingAgent(verbose = false) {
  console.log('🚀 Starting Fx Coding Agent with OpenAI...\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable is required');
    console.log('Please set your OpenAI API key in the .env file');
    process.exit(1);
  }
  
  // Enable automatic ledger logging for durability
  enableLogging();
  console.log('📊 Ledger logging enabled for audit trail');
  
  const initialState: AgentState = {
    conversation: [],
    currentWorkingDirectory: process.cwd(),
    verbose,
    currentGoal: '',
    plan: [],
    currentStep: 0,
    maxIterations: 10,
    iterationCount: 0
  };
  
  try {
    await codingAgent.start(initialState);
    
    // Show ledger events after completion
    if (verbose) {
      const events = getEvents();
      console.log('\n📊 Ledger Events:');
      events.forEach((event, index) => {
        console.log(`  ${index + 1}. [${event.name}] ${event.timestamp}`);
      });
    }
  } catch (error) {
    console.error('❌ Fatal Error:', (error as Error).message);
    if (verbose) {
      console.error('Stack trace:', (error as Error).stack);
    }
  }
}