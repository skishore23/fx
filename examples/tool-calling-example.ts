/**
 * Tool Calling and Routing Example
 * Demonstrates the Fx framework's tool calling system
 */

import {
  createAgentExecutor,
  router,
  patternGate,
  argSpec,
  planFromUtterance,
  withPolicies,
  getDefaultPolicyForRisk,
  createDefaultSafetyConfig,
  ObservabilityManager,
  defaultToolRegistry,
  createPlan,
  createAgent
} from '../packages/fx-core/src';

// ---------- Example: Basic Tool Calling ----------

async function basicToolCallingExample() {
  console.log('🔧 Basic Tool Calling Example\n');

  // 1) Router System
  console.log('1️⃣ Router System');
  const testInputs = [
    'read the file config.json',
    'search for information about TypeScript',
    'write content to output.txt',
    'execute the command ls -la',
    'call the API endpoint /users'
  ];

  for (const input of testInputs) {
    const gated = patternGate(input, []);
    const { candidates } = await router.route({ text: input }, gated);
    console.log(`Input: "${input}"`);
    console.log(`  Pattern matches: ${gated.join(', ') || 'none'}`);
    console.log(`  Router candidates: ${candidates.map(c => `${c.tool} (${c.score.toFixed(2)}, ${c.reason})`).join(', ')}`);
    console.log();
  }

  // 2) Argument Parsing
  console.log('2️⃣ Argument Parsing');
  const testMessages = [
    'read "My File.txt"',
    'write to config.json with content {"version": "1.0"}',
    'search for "machine learning" limit 10',
    'call https://api.github.com/users/octocat',
    'run ls -la in /home/user'
  ];

  for (const message of testMessages) {
    console.log(`Message: "${message}"`);
    
    const readArgs = argSpec.read_file(message);
    const writeArgs = argSpec.write_file(message);
    const searchArgs = argSpec.search(message);
    const apiArgs = argSpec.api_call(message);
    const commandArgs = argSpec.execute_command(message);
    
    if (readArgs) console.log(`  Read file args:`, readArgs);
    if (writeArgs) console.log(`  Write file args:`, writeArgs);
    if (searchArgs) console.log(`  Search args:`, searchArgs);
    if (apiArgs) console.log(`  API call args:`, apiArgs);
    if (commandArgs) console.log(`  Command args:`, commandArgs);
    
    console.log();
  }
}

// ---------- Example: Multi-Step Planning ----------

async function multiStepPlanningExample() {
  console.log('📋 Multi-Step Planning Example\n');

  const tools = [
    defaultToolRegistry.get('read_file'),
    defaultToolRegistry.get('write_file'),
    defaultToolRegistry.get('http_request'),
    defaultToolRegistry.get('execute_command')
  ].filter(tool => tool !== undefined);

  const multiStepInputs = [
    'read config.json and then write to output.txt',
    'search for "TypeScript" then call API with results',
    'execute ls command and read the output file'
  ];

  for (const input of multiStepInputs) {
    try {
      const plan = planFromUtterance(input, tools);
      console.log(`Input: "${input}"`);
      console.log(`  Plan steps: ${plan.steps.length}`);
      console.log(`  Total time budget: ${plan.totalTimeBudgetMs}ms`);
      console.log(`  Risk level: ${plan.riskLevel}`);
      console.log(`  Steps: ${plan.steps.map(s => s.tool.name).join(' → ')}`);
      console.log();
    } catch (error) {
      console.log(`Input: "${input}"`);
      console.log(`  Error: ${(error as Error).message}`);
      console.log();
    }
  }
}

// ---------- Example: Safety and Policies ----------

async function safetyAndPoliciesExample() {
  console.log('🛡️ Safety and Policies Example\n');

  // Tool metadata
  const readFileTool = defaultToolRegistry.get('read_file');
  if (readFileTool) {
    console.log('Tool Metadata:');
    console.log(`  Name: ${readFileTool.name}`);
    console.log(`  Capabilities: ${readFileTool.caps.join(', ')}`);
    console.log(`  Risk level: ${readFileTool.risk}`);
    console.log(`  Time budget: ${readFileTool.timeBudgetMs || 'default'}ms`);
    console.log(`  Memory budget: ${readFileTool.memoryBudgetMB || 'default'}MB`);
    console.log(`  Preconditions: ${readFileTool.pre.length}`);
    console.log(`  Postconditions: ${readFileTool.post.length}`);
    console.log();
  }

  // Policy application
  if (readFileTool) {
    const policy = getDefaultPolicyForRisk(readFileTool.risk);
    const policyAppliedTool = withPolicies(readFileTool, policy);
    
    console.log('Policy Application:');
    console.log(`  Original tool: ${readFileTool.name}`);
    console.log(`  Risk: ${readFileTool.risk}`);
    console.log(`  Applied policy:`);
    console.log(`    Timeout: ${policy.timeoutMs || 'none'}ms`);
    console.log(`    Retries: ${policy.retries || 'none'}`);
    console.log(`    Backoff: ${policy.backoff || 'none'}`);
    console.log(`    Approval required: ${policy.requireApproval || false}`);
    console.log();
  }

  // Safety configuration
  const safetyConfig = createDefaultSafetyConfig();
  console.log('Safety Configuration:');
  console.log(`  Allowed file paths: ${safetyConfig.allowlists.filePaths?.join(', ')}`);
  console.log(`  Allowed network hosts: ${safetyConfig.allowlists.networkHosts?.join(', ')}`);
  console.log(`  Allowed commands: ${safetyConfig.allowlists.commands?.join(', ')}`);
  console.log(`  Max concurrency: ${safetyConfig.quotas.maxConcurrency}`);
  console.log(`  Max memory: ${safetyConfig.quotas.maxMemoryMB}MB`);
  console.log(`  Max CPU time: ${safetyConfig.quotas.maxCpuTimeMs}ms`);
  console.log(`  Idempotency enabled: ${safetyConfig.idempotency.enabled}`);
  console.log();
}

// ---------- Example: Observability ----------

async function observabilityExample() {
  console.log('📊 Observability Example\n');

  const observabilityManager = new ObservabilityManager();
  
  // Simulate some decisions
  const decisions = [
    {
      input: 'read config.json',
      patternsMatched: ['read_file'],
      routerCandidates: [{ tool: 'read_file' as const, score: 0.9, reason: 'pattern' }],
      chosen: ['read_file' as const],
      args: { read_file: { filePath: 'config.json' } },
      outcome: 'ok' as const,
      latMs: 150
    },
    {
      input: 'search for TypeScript',
      patternsMatched: [],
      routerCandidates: [{ tool: 'search' as const, score: 0.7, reason: 'classifier' }],
      chosen: ['search' as const],
      args: { search: { query: 'TypeScript' } },
      outcome: 'ok' as const,
      latMs: 200
    },
    {
      input: 'invalid command',
      patternsMatched: [],
      routerCandidates: [],
      chosen: [],
      args: {},
      outcome: 'fail' as const,
      latMs: 50,
      error: 'No matching tools found'
    }
  ];

  for (const decision of decisions) {
    const recordId = observabilityManager.recordDecision(decision);
    console.log(`Recorded decision: ${recordId}`);
  }

  const report = observabilityManager.getReport();
  console.log('\nObservability Report:');
  console.log(`  Recent decisions: ${report.recentDecisions.length}`);
  console.log(`  Tool accuracy:`, Object.fromEntries(report.confusionMatrix.toolAccuracy));
  console.log(`  Performance metrics:`);
  console.log(`    Avg latency: ${report.confusionMatrix.performanceMetrics.avgLatencyMs.toFixed(2)}ms`);
  console.log(`    Success rate: ${(report.confusionMatrix.performanceMetrics.successRate * 100).toFixed(1)}%`);
  console.log(`    Error rate: ${(report.confusionMatrix.performanceMetrics.errorRate * 100).toFixed(1)}%`);
  console.log();
}

// ---------- Example: Agent Executor ----------

async function agentExecutorExample() {
  console.log('🤖 Agent Executor Example\n');

  const executor = createAgentExecutor();
  
  console.log('Agent Executor Features:');
  console.log('  ✅ Router system (pattern gates + classifier)');
  console.log('  ✅ Declarative argument parsing');
  console.log('  ✅ Tool metadata with capabilities & risk');
  console.log('  ✅ Deterministic planning');
  console.log('  ✅ Policy decorators');
  console.log('  ✅ Safety baseline');
  console.log('  ✅ Observability & decision tracking');
  console.log();

  // Simulate agent execution
  const initialState = {
    userMessage: 'read config.json and write to output.txt',
    observability: executor['observabilityManager']
  };

  try {
    const { state, result } = await executor.runTurn(initialState, initialState.userMessage);
    
    console.log('Execution Result:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Execution time: ${result.executionTimeMs}ms`);
    if (result.decisionId) {
      console.log(`  Decision ID: ${result.decisionId}`);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  } catch (error) {
    console.log('Execution failed:', (error as Error).message);
  }
}

// ---------- Example: Integration with Fx Workflows ----------

async function workflowIntegrationExample() {
  console.log('🔄 Workflow Integration Example\n');

  const executor = createAgentExecutor();
  
  // Create a workflow that uses the agent executor
  const agentWorkflow = createPlan('tool-calling-workflow', [
    async (state) => {
      const { state: newState, result } = await executor.runTurn(state, state.userMessage as string);
      return {
        ...newState,
        lastExecutionResult: result
      };
    }
  ]);

  // Create an agent with the workflow
  const agent = createAgent('tool-calling-agent', agentWorkflow);

  console.log('Created agent with tool calling workflow');
  console.log('Agent features:');
  console.log('  - Intelligent tool routing');
  console.log('  - Multi-step planning');
  console.log('  - Safety controls');
  console.log('  - Observability tracking');
  console.log('  - Policy enforcement');
  console.log();
}

// ---------- Main Example Runner ----------

async function runAllExamples() {
  console.log('🚀 Fx Framework Tool Calling Examples\n');
  console.log('=====================================\n');

  await basicToolCallingExample();
  await multiStepPlanningExample();
  await safetyAndPoliciesExample();
  await observabilityExample();
  await agentExecutorExample();
  await workflowIntegrationExample();

  console.log('🎉 All examples completed successfully!');
  console.log('\nThe Fx framework provides a comprehensive tool calling system with:');
  console.log('• Intelligent routing with pattern gates and classifiers');
  console.log('• Robust argument parsing with a declarative DSL');
  console.log('• Comprehensive tool metadata and validation');
  console.log('• Multi-step planning with dependency resolution');
  console.log('• Policy decorators for safety and reliability');
  console.log('• Complete observability and decision tracking');
  console.log('• Seamless integration with Fx workflows');
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}

export { 
  basicToolCallingExample,
  multiStepPlanningExample,
  safetyAndPoliciesExample,
  observabilityExample,
  agentExecutorExample,
  workflowIntegrationExample,
  runAllExamples
};
