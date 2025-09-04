/**
 * Safety Baseline for Fx Framework
 * Provides allowlists, idempotency, resource quotas, and sandboxes
 * Built using functional composition and category theory principles
 */

import { BaseContext, Step } from './types';
import { ToolSpec, ExecutionContext, ResourceQuotas, ApprovalSystem } from './tool-metadata';
import { sequence, parallel, when, validate, fromFunction } from './composition';

// ---------- Safety Types ----------

export interface AllowlistConfig {
  readonly filePaths?: string[];
  readonly networkHosts?: string[];
  readonly commands?: string[];
  readonly capabilities?: string[];
}

export interface IdempotencyConfig {
  readonly enabled: boolean;
  readonly ttlMs?: number;
  readonly keyGenerator?: (toolName: string, args: unknown) => string;
}

export interface SafetyConfig {
  readonly allowlists: AllowlistConfig;
  readonly idempotency: IdempotencyConfig;
  readonly quotas: ResourceQuotas;
  readonly sandbox: SandboxConfig;
}

export interface SandboxConfig {
  readonly workingDirectory: string;
  readonly allowedPaths: string[];
  readonly blockedPaths: string[];
  readonly maxMemoryMB: number;
  readonly maxCpuTimeMs: number;
  readonly networkAccess: boolean;
  readonly allowedHosts?: string[];
}

export interface SafetyViolation {
  readonly type: 'allowlist' | 'quota' | 'sandbox' | 'idempotency';
  readonly message: string;
  readonly toolName: string;
  readonly details?: unknown;
}

// ---------- Safety Pure Functions (Morphisms) ----------

/**
 * Pure function to validate file path against allowlist
 * Category theory: This is a morphism (AllowlistConfig, string) -> boolean
 */
export const validateFilePath = (config: AllowlistConfig, filePath: string): boolean => {
  if (!config.filePaths) return true;
  return config.filePaths.some(pattern => filePath.includes(pattern));
};

/**
 * Pure function to validate network host against allowlist
 * Category theory: This is a morphism (AllowlistConfig, string) -> boolean
 */
export const validateNetworkHost = (config: AllowlistConfig, host: string): boolean => {
  if (!config.networkHosts) return true;
  return config.networkHosts.some(pattern => host.includes(pattern));
};

/**
 * Pure function to validate command against allowlist
 * Category theory: This is a morphism (AllowlistConfig, string) -> boolean
 */
export const validateCommand = (config: AllowlistConfig, command: string): boolean => {
  if (!config.commands) return true;
  const baseCommand = command.split(' ')[0];
  return baseCommand ? config.commands.includes(baseCommand) : false;
};

/**
 * Pure function to validate capability against allowlist
 * Category theory: This is a morphism (AllowlistConfig, string) -> boolean
 */
export const validateCapability = (config: AllowlistConfig, capability: string): boolean => {
  if (!config.capabilities) return true;
  return config.capabilities.includes(capability);
};

/**
 * Pure function to check resource quota
 * Category theory: This is a morphism (ResourceQuotas, ResourceUsage) -> boolean
 */
export const checkResourceQuota = (quotas: ResourceQuotas, usage: { [K in keyof ResourceQuotas]: number }): boolean => {
  return Object.entries(quotas).every(([key, limit]) => {
    const currentUsage = usage[key as keyof ResourceQuotas] || 0;
    return currentUsage <= limit;
  });
};

/**
 * Pure function to generate idempotency key
 * Category theory: This is a morphism (string, unknown) -> string
 */
export const generateIdempotencyKey = (toolName: string, args: unknown): string => {
  return `${toolName}:${JSON.stringify(args)}`;
};

/**
 * Pure function to validate sandbox constraints
 * Category theory: This is a morphism (SandboxConfig, ExecutionContext) -> boolean
 */
export const validateSandboxConstraints = (config: SandboxConfig, context: ExecutionContext): boolean => {
  // Check working directory
  if (context.state.currentWorkingDirectory && typeof context.state.currentWorkingDirectory === 'string' && !config.allowedPaths.includes(context.state.currentWorkingDirectory)) {
    return false;
  }
  
  // Check memory usage
  if (context.state.memoryUsage && typeof context.state.memoryUsage === 'number' && context.state.memoryUsage > config.maxMemoryMB) {
    return false;
  }
  
  return true;
};

// ---------- Safety Steps (Composed from Pure Functions) ----------

/**
 * Step to validate allowlist constraints
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const validateAllowlistStep = <T extends BaseContext>(
  config: AllowlistConfig,
  tool: ToolSpec<unknown, unknown>,
  args: unknown
): Step<T> => {
  return fromFunction('validateAllowlist', async (state: T) => {
    const violations: SafetyViolation[] = [];
    
    // Validate file paths
    if (tool.caps.includes('fs.read') || tool.caps.includes('fs.write')) {
      const filePath = (args as any)?.filePath;
      if (filePath && !validateFilePath(config, filePath)) {
        violations.push({
          type: 'allowlist',
          message: `File path not allowed: ${filePath}`,
          toolName: tool.name,
          details: { filePath, allowedPaths: config.filePaths }
        });
      }
    }
    
    // Validate network hosts
    if (tool.caps.includes('net.http')) {
      const url = (args as any)?.url;
      if (url) {
        const host = new URL(url).hostname;
        if (!validateNetworkHost(config, host)) {
          violations.push({
            type: 'allowlist',
            message: `Network host not allowed: ${host}`,
            toolName: tool.name,
            details: { host, allowedHosts: config.networkHosts }
          });
        }
      }
    }
    
    // Validate commands
    if (tool.caps.includes('shell.exec')) {
      const command = (args as any)?.command;
      if (command && !validateCommand(config, command)) {
        violations.push({
          type: 'allowlist',
          message: `Command not allowed: ${command}`,
          toolName: tool.name,
          details: { command, allowedCommands: config.commands }
        });
      }
    }
    
    // Validate capabilities
    for (const cap of tool.caps) {
      if (!validateCapability(config, cap)) {
        violations.push({
          type: 'allowlist',
          message: `Capability not allowed: ${cap}`,
          toolName: tool.name,
          details: { capability: cap, allowedCapabilities: config.capabilities }
        });
      }
    }
    
    return {
      ...state,
      safetyViolations: [...(state.safetyViolations as SafetyViolation[] || []), ...violations]
    } as T;
  });
};

/**
 * Step to validate resource quotas
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const validateResourceQuotaStep = <T extends BaseContext>(
  quotas: ResourceQuotas,
  tool: ToolSpec<unknown, unknown>
): Step<T> => {
  return fromFunction('validateResourceQuota', async (state: T) => {
    const violations: SafetyViolation[] = [];
    const usage = state.resourceUsage as { [K in keyof ResourceQuotas]: number } || {};
    
    // Check concurrency
    if (!checkResourceQuota(quotas, { ...usage, maxConcurrency: (usage.maxConcurrency || 0) + 1 })) {
      violations.push({
        type: 'quota',
        message: 'Concurrency quota exceeded',
        toolName: tool.name,
        details: { quota: 'maxConcurrency', limit: quotas.maxConcurrency, current: usage.maxConcurrency }
      });
    }
    
    // Check memory
    if (tool.memoryBudgetMB && !checkResourceQuota(quotas, { ...usage, maxMemoryMB: (usage.maxMemoryMB || 0) + tool.memoryBudgetMB })) {
      violations.push({
        type: 'quota',
        message: 'Memory quota exceeded',
        toolName: tool.name,
        details: { quota: 'maxMemoryMB', limit: quotas.maxMemoryMB, current: usage.maxMemoryMB }
      });
    }
    
    return {
      ...state,
      safetyViolations: [...(state.safetyViolations as SafetyViolation[] || []), ...violations]
    } as T;
  });
};

/**
 * Step to validate sandbox constraints
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const validateSandboxStep = <T extends BaseContext>(
  config: SandboxConfig,
  context: ExecutionContext
): Step<T> => {
  return fromFunction('validateSandbox', async (state: T) => {
    const violations: SafetyViolation[] = [];
    
    if (!validateSandboxConstraints(config, context)) {
      violations.push({
        type: 'sandbox',
        message: 'Sandbox constraints violated',
        toolName: 'unknown',
        details: { config, context: context.state }
      });
    }
    
    return {
      ...state,
      safetyViolations: [...(state.safetyViolations as SafetyViolation[] || []), ...violations]
    } as T;
  });
};

/**
 * Composed safety validation step using existing composition operators
 * Category theory: This composes multiple Kleisli arrows using sequence
 */
export const validateSafetyStep = <T extends BaseContext>(
  config: SafetyConfig,
  tool: ToolSpec<unknown, unknown>,
  args: unknown,
  context: ExecutionContext
): Step<T> => {
  // Compose all safety validations in sequence
  return sequence([
    validateAllowlistStep(config.allowlists, tool, args),
    validateResourceQuotaStep(config.quotas, tool),
    validateSandboxStep(config.sandbox, context)
  ]);
};

/**
 * Composed safety validation with parallel execution where possible
 * Category theory: This uses parallel composition for independent validations
 */
export const validateSafetyParallelStep = <T extends BaseContext>(
  config: SafetyConfig,
  tool: ToolSpec<unknown, unknown>,
  args: unknown,
  context: ExecutionContext
): Step<T> => {
  // Run independent validations in parallel, then merge results
  return parallel([
    validateAllowlistStep(config.allowlists, tool, args),
    validateResourceQuotaStep(config.quotas, tool),
    validateSandboxStep(config.sandbox, context)
  ], (results, originalState) => {
    // Merge all safety violations from parallel results
    const allViolations = results.flatMap(result => result.safetyViolations as SafetyViolation[] || []);
    return {
      ...originalState,
      safetyViolations: allViolations
    };
  });
};

// ---------- Allowlist Implementation (Composed from Steps) ----------

export class AllowlistChecker {
  constructor(private config: AllowlistConfig) {}

  /**
   * Check if a file path is allowed
   */
  checkFilePath(path: string): boolean {
    if (!this.config.filePaths) return true;
    
    return this.config.filePaths.some(allowed => {
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1);
        return path.startsWith(prefix);
      }
      return path === allowed;
    });
  }

  /**
   * Check if a network host is allowed
   */
  checkNetworkHost(host: string): boolean {
    if (!this.config.networkHosts) return true;
    
    return this.config.networkHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(1);
        return host.endsWith(suffix);
      }
      return host === allowed;
    });
  }

  /**
   * Check if a command is allowed
   */
  checkCommand(command: string): boolean {
    if (!this.config.commands) return true;
    
    const baseCommand = command.split(' ')[0];
    return baseCommand ? this.config.commands.includes(baseCommand) : false;
  }

  /**
   * Check if a capability is allowed
   */
  checkCapability(capability: string): boolean {
    if (!this.config.capabilities) return true;
    
    return this.config.capabilities.includes(capability);
  }

  /**
   * Validate tool against allowlists
   */
  validateTool(tool: ToolSpec<unknown, unknown>, args: unknown): SafetyViolation[] {
    const violations: SafetyViolation[] = [];

    // Check capabilities
    for (const cap of tool.caps) {
      if (!this.checkCapability(cap)) {
        violations.push({
          type: 'allowlist',
          message: `Capability '${cap}' not allowed`,
          toolName: tool.name,
          details: { capability: cap }
        });
      }
    }

    // Check file paths
    if (tool.name === 'read_file' || tool.name === 'write_file') {
      const filePath = (args as { filePath?: string })?.filePath;
      if (filePath && !this.checkFilePath(filePath)) {
        violations.push({
          type: 'allowlist',
          message: `File path '${filePath}' not allowed`,
          toolName: tool.name,
          details: { filePath }
        });
      }
    }

    // Check network hosts
    if (tool.name === 'http_request') {
      const url = (args as { url?: string })?.url;
      if (url) {
        try {
          const host = new URL(url).hostname;
          if (!this.checkNetworkHost(host)) {
            violations.push({
              type: 'allowlist',
              message: `Network host '${host}' not allowed`,
              toolName: tool.name,
              details: { host, url }
            });
          }
        } catch {
          violations.push({
            type: 'allowlist',
            message: `Invalid URL '${url}'`,
            toolName: tool.name,
            details: { url }
          });
        }
      }
    }

    // Check commands
    if (tool.name === 'execute_command') {
      const command = (args as { command?: string })?.command;
      if (command && !this.checkCommand(command)) {
        violations.push({
          type: 'allowlist',
          message: `Command '${command}' not allowed`,
          toolName: tool.name,
          details: { command }
        });
      }
    }

    return violations;
  }
}

// ---------- Idempotency Implementation ----------

export class IdempotencyManager {
  private cache = new Map<string, { result: unknown; timestamp: number }>();

  constructor(private config: IdempotencyConfig) {}

  /**
   * Generate idempotency key
   */
  generateKey(toolName: string, args: unknown): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(toolName, args);
    }
    
    // Default key generation
    const argsStr = JSON.stringify(args, Object.keys(args as Record<string, unknown>).sort());
    return `${toolName}:${Buffer.from(argsStr).toString('base64')}`;
  }

  /**
   * Check if result exists in cache
   */
  getCachedResult(key: string): unknown | null {
    if (!this.config.enabled) return null;
    
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    // Check TTL
    if (this.config.ttlMs && Date.now() - cached.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.result;
  }

  /**
   * Cache a result
   */
  cacheResult(key: string, result: unknown): void {
    if (!this.config.enabled) return;
    
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    if (!this.config.ttlMs) return;
    
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.config.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached results
   */
  clearAll(): void {
    this.cache.clear();
  }
}

// ---------- Resource Quota Implementation ----------

export class ResourceQuotaManager {
  private usage = {
    maxConcurrency: 0,
    maxMemoryMB: 0,
    maxCpuTimeMs: 0,
    maxNetworkRequests: 0
  };

  constructor(private quotas: ResourceQuotas) {}

  /**
   * Check if resource usage is within quotas
   */
  checkQuota(resource: keyof ResourceQuotas, requested: number): boolean {
    const current = this.usage[resource];
    const limit = this.quotas[resource];
    
    return current + requested <= limit;
  }

  /**
   * Reserve resources
   */
  reserve(resource: keyof ResourceQuotas, amount: number): boolean {
    if (!this.checkQuota(resource, amount)) {
      return false;
    }
    
    this.usage[resource] += amount;
    return true;
  }

  /**
   * Release resources
   */
  release(resource: keyof ResourceQuotas, amount: number): void {
    this.usage[resource] = Math.max(0, this.usage[resource] - amount);
  }

  /**
   * Get current usage
   */
  getUsage(): typeof this.usage {
    return { ...this.usage };
  }

  /**
   * Get available capacity
   */
  getAvailable(resource: keyof ResourceQuotas): number {
    return this.quotas[resource] - this.usage[resource];
  }

  /**
   * Reset all usage
   */
  reset(): void {
    this.usage = {
      maxConcurrency: 0,
      maxMemoryMB: 0,
      maxCpuTimeMs: 0,
      maxNetworkRequests: 0
    };
  }
}

// ---------- Sandbox Implementation ----------

export class SandboxManager {
  constructor(private config: SandboxConfig) {}

  /**
   * Validate path access
   */
  validatePath(path: string): boolean {
    // Check blocked paths first
    for (const blocked of this.config.blockedPaths) {
      if (path.includes(blocked)) {
        return false;
      }
    }
    
    // Check allowed paths
    return this.config.allowedPaths.some(allowed => path.includes(allowed));
  }

  /**
   * Validate network access
   */
  validateNetworkAccess(host: string): boolean {
    if (!this.config.networkAccess) return false;
    
    if (this.config.allowedHosts) {
      return this.config.allowedHosts.some(allowed => {
        if (allowed.startsWith('*.')) {
          return host.endsWith(allowed.slice(1));
        }
        return host === allowed;
      });
    }
    
    return true;
  }

  /**
   * Create sandbox context
   */
  createSandboxContext(): SandboxContext {
    return {
      workingDirectory: this.config.workingDirectory,
      maxMemoryMB: this.config.maxMemoryMB,
      maxCpuTimeMs: this.config.maxCpuTimeMs,
      networkAccess: this.config.networkAccess,
      allowedHosts: this.config.allowedHosts
    };
  }
}

export interface SandboxContext {
  readonly workingDirectory: string;
  readonly maxMemoryMB: number;
  readonly maxCpuTimeMs: number;
  readonly networkAccess: boolean;
  readonly allowedHosts?: string[];
}

// ---------- Safety Manager ----------

export class SafetyManager {
  public readonly allowlistChecker: AllowlistChecker;
  public readonly idempotencyManager: IdempotencyManager;
  public readonly quotaManager: ResourceQuotaManager;
  public readonly sandboxManager: SandboxManager;

  constructor(private config: SafetyConfig) {
    this.allowlistChecker = new AllowlistChecker(config.allowlists);
    this.idempotencyManager = new IdempotencyManager(config.idempotency);
    this.quotaManager = new ResourceQuotaManager(config.quotas);
    this.sandboxManager = new SandboxManager(config.sandbox);
  }

  /**
   * Validate tool execution against all safety checks
   */
  validateExecution(
    tool: ToolSpec<unknown, unknown>,
    args: unknown
  ): { valid: true } | { valid: false; violations: SafetyViolation[] } {
    const violations: SafetyViolation[] = [];

    // Check allowlists
    violations.push(...this.allowlistChecker.validateTool(tool, args));

    // Check resource quotas
    if (!this.quotaManager.checkQuota('maxConcurrency', 1)) {
      violations.push({
        type: 'quota',
        message: 'Concurrency quota exceeded',
        toolName: tool.name,
        details: { quota: 'maxConcurrency' }
      });
    }

    if (tool.memoryBudgetMB && !this.quotaManager.checkQuota('maxMemoryMB', tool.memoryBudgetMB)) {
      violations.push({
        type: 'quota',
        message: 'Memory quota exceeded',
        toolName: tool.name,
        details: { quota: 'maxMemoryMB', requested: tool.memoryBudgetMB }
      });
    }

    if (tool.timeBudgetMs && !this.quotaManager.checkQuota('maxCpuTimeMs', tool.timeBudgetMs)) {
      violations.push({
        type: 'quota',
        message: 'CPU time quota exceeded',
        toolName: tool.name,
        details: { quota: 'maxCpuTimeMs', requested: tool.timeBudgetMs }
      });
    }

    return violations.length > 0 ? { valid: false, violations } : { valid: true };
  }

  /**
   * Create safe execution context
   */
  createSafeExecutionContext(baseContext: ExecutionContext): ExecutionContext {
    return {
      ...baseContext,
      quotas: this.quotaManager as any,
      approvals: this.createApprovalSystem()
    };
  }

  /**
   * Create approval system
   */
  private createApprovalSystem(): ApprovalSystem {
    return {
      ok: async (toolName: string, args: unknown): Promise<boolean> => {
        // In a real implementation, this would check with an approval service
        // For now, we'll auto-approve based on risk level
        const tool = this.getToolByName(toolName);
        if (!tool) return false;
        
        // Auto-approve low risk tools
        if (tool.risk === 'low') return true;
        
        // For higher risk tools, we'd need actual approval
        // This is a placeholder implementation
        return false;
      }
    };
  }

  /**
   * Get tool by name (placeholder - would come from registry)
   */
  private getToolByName(name: string): ToolSpec<unknown, unknown> | null {
    // This would be implemented with the actual tool registry
    return null;
  }
}

// ---------- Default Safety Configurations ----------

/**
 * Create default safety configuration
 */
export function createDefaultSafetyConfig(): SafetyConfig {
  return {
    allowlists: {
      filePaths: ['/tmp/*', './*'],
      networkHosts: ['api.github.com', '*.openai.com'],
      commands: ['ls', 'cat', 'grep', 'find', 'echo'],
      capabilities: ['fs.read', 'fs.write', 'net.http']
    },
    idempotency: {
      enabled: true,
      ttlMs: 300000 // 5 minutes
    },
    quotas: {
      maxConcurrency: 5,
      maxMemoryMB: 100,
      maxCpuTimeMs: 60000,
      maxNetworkRequests: 10
    },
    sandbox: {
      workingDirectory: '/tmp/fx-sandbox',
      allowedPaths: ['/tmp/*'],
      blockedPaths: ['/etc', '/usr', '/bin', '/sbin'],
      maxMemoryMB: 50,
      maxCpuTimeMs: 30000,
      networkAccess: true,
      allowedHosts: ['api.github.com', '*.openai.com']
    }
  };
}

/**
 * Create strict safety configuration
 */
export function createStrictSafetyConfig(): SafetyConfig {
  return {
    allowlists: {
      filePaths: ['/tmp/fx-sandbox/*'],
      networkHosts: [],
      commands: ['echo'],
      capabilities: ['fs.read']
    },
    idempotency: {
      enabled: true,
      ttlMs: 60000 // 1 minute
    },
    quotas: {
      maxConcurrency: 1,
      maxMemoryMB: 10,
      maxCpuTimeMs: 5000,
      maxNetworkRequests: 0
    },
    sandbox: {
      workingDirectory: '/tmp/fx-sandbox',
      allowedPaths: ['/tmp/fx-sandbox/*'],
      blockedPaths: ['/'],
      maxMemoryMB: 10,
      maxCpuTimeMs: 5000,
      networkAccess: false
    }
  };
}
