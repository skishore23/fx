/**
 * Policy Decorators for Fx Framework
 * Provides timeouts, retries, backoff, circuit-breaker, sandbox, and approvals
 */

import { ToolSpec, ExecutionContext } from './tool-metadata';

// ---------- Policy Types ----------

export interface Policy {
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly backoff?: 'none' | 'linear' | 'exponential';
  readonly maxBackoffMs?: number;
  readonly requireApproval?: boolean;
  readonly circuitBreaker?: CircuitBreakerConfig;
  readonly sandbox?: SandboxConfig;
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly recoveryTimeoutMs: number;
  readonly halfOpenMaxCalls: number;
}

export interface SandboxConfig {
  readonly workingDirectory?: string;
  readonly allowedPaths?: string[];
  readonly blockedPaths?: string[];
  readonly maxMemoryMB?: number;
  readonly maxCpuTimeMs?: number;
  readonly networkAccess?: boolean;
}

export interface PolicyContext {
  readonly attempt: number;
  readonly startTime: number;
  readonly lastError?: Error;
  readonly circuitBreakerState?: 'closed' | 'open' | 'half-open';
}

// ---------- Circuit Breaker Implementation ----------

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenCalls = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    if (this.state === 'half-open' && this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      throw new Error('Circuit breaker half-open call limit exceeded');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.halfOpenCalls = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.halfOpenCalls++;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }
}

// ---------- Backoff Strategies ----------

function calculateBackoffDelay(
  attempt: number, 
  baseDelay: number, 
  strategy: 'none' | 'linear' | 'exponential',
  maxDelay?: number
): number {
  let delay: number;

  switch (strategy) {
    case 'none':
      delay = baseDelay;
      break;
    case 'linear':
      delay = baseDelay * attempt;
      break;
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt - 1);
      break;
    default:
      delay = baseDelay;
  }

  return maxDelay ? Math.min(delay, maxDelay) : delay;
}

// ---------- Sandbox Implementation ----------

class Sandbox {
  constructor(private config: SandboxConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // In a real implementation, this would:
    // 1. Create a temporary working directory
    // 2. Set up resource limits
    // 3. Restrict file system access
    // 4. Monitor resource usage
    // 5. Clean up after execution

    // For now, just execute the function
    return fn();
  }

  validatePath(path: string): boolean {
    if (this.config.blockedPaths) {
      for (const blocked of this.config.blockedPaths) {
        if (path.includes(blocked)) {
          return false;
        }
      }
    }

    if (this.config.allowedPaths) {
      return this.config.allowedPaths.some(allowed => path.includes(allowed));
    }

    return true;
  }
}

// ---------- Policy Decorator ----------

/**
 * Apply policies to a tool specification
 */
export function withPolicies<I, O>(
  tool: ToolSpec<I, O>, 
  policy: Policy
): ToolSpec<I, O> {
  const circuitBreaker = policy.circuitBreaker ? new CircuitBreaker(policy.circuitBreaker) : null;
  const sandbox = policy.sandbox ? new Sandbox(policy.sandbox) : null;

  return {
    ...tool,
    async exec(input: I, context: ExecutionContext): Promise<O> {
      // Check approval requirement
      if (policy.requireApproval && !(await context.approvals.ok(tool.name, input))) {
        throw new Error(`Approval required for tool: ${tool.name}`);
      }

      // Apply sandbox if configured
      const executeInSandbox = async (): Promise<O> => {
        if (sandbox) {
          return sandbox.execute(() => tool.exec(input, context));
        }
        return tool.exec(input, context);
      };

      // Apply circuit breaker if configured
      const executeWithCircuitBreaker = async (): Promise<O> => {
        if (circuitBreaker) {
          return circuitBreaker.execute(executeInSandbox);
        }
        return executeInSandbox();
      };

      // Apply retry logic
      return retryWithTimeout(executeWithCircuitBreaker, policy);
    }
  };
}

/**
 * Retry with timeout implementation
 */
async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  policy: Policy
): Promise<T> {
  const maxAttempts = (policy.retries || 0) + 1;
  const timeoutMs = policy.timeoutMs || 30000;
  const backoffStrategy = policy.backoff || 'exponential';
  const maxBackoffMs = policy.maxBackoffMs || 10000;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      // Race between execution and timeout
      const result = await Promise.race([fn(), timeoutPromise]);
      return result;

    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (isNonRetryableError(error)) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate backoff delay
      const delay = calculateBackoffDelay(attempt, 1000, backoffStrategy, maxBackoffMs);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Check if an error should not be retried
 */
function isNonRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Don't retry on validation errors, permission errors, or circuit breaker errors
    return (
      message.includes('validation') ||
      message.includes('permission') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('circuit breaker') ||
      message.includes('approval required')
    );
  }
  
  return false;
}

// ---------- Policy Factories ----------

/**
 * Create a timeout policy
 */
export function timeoutPolicy(timeoutMs: number): Policy {
  return { timeoutMs };
}

/**
 * Create a retry policy
 */
export function retryPolicy(
  retries: number,
  backoff: 'none' | 'linear' | 'exponential' = 'exponential',
  maxBackoffMs?: number
): Policy {
  return { retries, backoff, maxBackoffMs };
}

/**
 * Create an approval policy
 */
export function approvalPolicy(): Policy {
  return { requireApproval: true };
}

/**
 * Create a circuit breaker policy
 */
export function circuitBreakerPolicy(
  failureThreshold: number = 5,
  recoveryTimeoutMs: number = 60000,
  halfOpenMaxCalls: number = 3
): Policy {
  return {
    circuitBreaker: {
      failureThreshold,
      recoveryTimeoutMs,
      halfOpenMaxCalls
    }
  };
}

/**
 * Create a sandbox policy
 */
export function sandboxPolicy(config: SandboxConfig): Policy {
  return { sandbox: config };
}

/**
 * Create a comprehensive policy combining multiple policies
 */
export function comprehensivePolicy(options: {
  timeoutMs?: number;
  retries?: number;
  backoff?: 'none' | 'linear' | 'exponential';
  maxBackoffMs?: number;
  requireApproval?: boolean;
  circuitBreaker?: CircuitBreakerConfig;
  sandbox?: SandboxConfig;
}): Policy {
  return {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    backoff: options.backoff,
    maxBackoffMs: options.maxBackoffMs,
    requireApproval: options.requireApproval,
    circuitBreaker: options.circuitBreaker,
    sandbox: options.sandbox
  };
}

// ---------- Policy Utilities ----------

/**
 * Get default policy for a tool based on its risk level
 */
export function getDefaultPolicyForRisk(risk: 'low' | 'medium' | 'high' | 'critical'): Policy {
  switch (risk) {
    case 'low':
      return {
        timeoutMs: 5000,
        retries: 1,
        backoff: 'linear'
      };
    case 'medium':
      return {
        timeoutMs: 10000,
        retries: 2,
        backoff: 'exponential',
        maxBackoffMs: 5000
      };
    case 'high':
      return {
        timeoutMs: 30000,
        retries: 3,
        backoff: 'exponential',
        maxBackoffMs: 10000,
        requireApproval: true,
        circuitBreaker: {
          failureThreshold: 3,
          recoveryTimeoutMs: 30000,
          halfOpenMaxCalls: 2
        }
      };
    case 'critical':
      return {
        timeoutMs: 60000,
        retries: 5,
        backoff: 'exponential',
        maxBackoffMs: 30000,
        requireApproval: true,
        circuitBreaker: {
          failureThreshold: 2,
          recoveryTimeoutMs: 60000,
          halfOpenMaxCalls: 1
        },
        sandbox: {
          maxMemoryMB: 100,
          maxCpuTimeMs: 30000,
          networkAccess: false
        }
      };
  }
}

/**
 * Merge multiple policies
 */
export function mergePolicies(...policies: Policy[]): Policy {
  return policies.reduce((merged, policy) => ({
    ...merged,
    ...policy,
    circuitBreaker: policy.circuitBreaker || merged.circuitBreaker,
    sandbox: policy.sandbox || merged.sandbox
  }), {} as Policy);
}
