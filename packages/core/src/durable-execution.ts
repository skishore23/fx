/**
 * @fx/core - Durable Execution
 * Functional composition for pause/resume/checkpoint patterns
 */

import { BaseContext, Step, sequence, log, safe, safeAsync, Either } from './index';
import { enableLogging, logEvent, getEvents } from './ledger';

// ---------- Types ----------

export interface Checkpoint<T extends BaseContext> {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly ctx: T;
  readonly time: Date;
  readonly lastTask?: string;
  readonly logs: unknown[];
}

export interface PersistenceIO<T extends BaseContext> {
  readonly save: (checkpoint: Checkpoint<T>) => Promise<string>;
  readonly load: (id: string) => Promise<Checkpoint<T>>;
}

export interface DurableExecutionConfig<T extends BaseContext> {
  readonly checkpointInterval?: number;
  readonly persistence?: PersistenceIO<T>;
  readonly enableLedger?: boolean;
}

export interface DurableExecutionResult<T extends BaseContext> {
  readonly ctx: T;
  readonly success: boolean;
  readonly error?: string;
  readonly duration: number;
  readonly checkpointId?: string;
}

// ---------- Durable Execution Functions ----------

/**
 * Create a step that saves a checkpoint
 */
export function checkpoint<T extends BaseContext>(
  persistence: PersistenceIO<T>,
  reason?: string
): Step<T> {
  return async (ctx: T): Promise<T> => {
    const checkpoint: Checkpoint<T> = {
      id: `checkpoint_${Date.now()}`,
      runId: `run_${Date.now()}`,
      seq: 0, // Will be set by caller
      ctx,
      time: new Date(),
      lastTask: reason,
      logs: getEvents(100) // Get recent events from ledger
    };

    await persistence.save(checkpoint);
    logEvent('checkpoint_saved', { checkpointId: checkpoint.id, reason });
    
    return ctx;
  };
}

/**
 * Create a step that loads from a checkpoint
 */
export function resumeFromCheckpoint<T extends BaseContext>(
  persistence: PersistenceIO<T>,
  checkpointId: string,
  extras?: Partial<T>
): Step<T> {
  return async (ctx: T): Promise<T> => {
    const checkpoint = await persistence.load(checkpointId);
    const resumedCtx = { ...checkpoint.ctx, ...extras };
    
    logEvent('checkpoint_resumed', { checkpointId, extras });
    
    return resumedCtx;
  };
}

/**
 * Create a step that pauses execution
 */
export function pause<T extends BaseContext>(
  persistence: PersistenceIO<T>,
  reason?: string
): Step<T> {
  return sequence([
    log(`Pausing execution: ${reason || 'user_requested'}`),
    checkpoint(persistence, reason)
  ]);
}

/**
 * Create a step that enables automatic checkpointing
 */
export function withAutoCheckpointing<T extends BaseContext>(
  step: Step<T>,
  config: DurableExecutionConfig<T>
): Step<T> {
  if (!config.persistence || !config.checkpointInterval) {
    return step;
  }

  return async (ctx: T): Promise<T> => {
    const startTime = Date.now();
    let lastCheckpoint = startTime;
    
    // Wrap the step with checkpointing
    const checkpointingStep = sequence([
      log('durable_execution_start'),
      step,
      log('durable_execution_complete')
    ]);

    const result = await checkpointingStep(ctx);
    
      // Auto-checkpoint if interval has passed
      if (config.persistence && Date.now() - lastCheckpoint > (config.checkpointInterval || 1000)) {
        await checkpoint(config.persistence, 'auto_checkpoint')(result);
        lastCheckpoint = Date.now();
      }
    
    return result;
  };
}

/**
 * Execute with durable execution patterns
 */
export async function executeDurable<T extends BaseContext>(
  step: Step<T>,
  ctx: T,
  config: DurableExecutionConfig<T>
): Promise<DurableExecutionResult<T>> {
  const startTime = Date.now();
  
  // Enable ledger if configured
  if (config.enableLedger) {
    enableLogging();
  }
  
  // Create safe execution with Either monad
  const safeExecution = safeAsync(async (inputCtx: T) => {
    const executionStep = config.persistence 
      ? withAutoCheckpointing(step, config)
      : step;
    
    return await executionStep(inputCtx);
  });

  const executionResult = await safeExecution(ctx);
  
  if (executionResult.tag === 'Left') {
    return {
      ctx,
      success: false,
      error: executionResult.left.message,
      duration: Date.now() - startTime
    };
  } else {
    return {
      ctx: executionResult.right,
      success: true,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Create a durable execution step that can be paused and resumed
 */
export function createDurableStep<T extends BaseContext>(
  step: Step<T>,
  config: DurableExecutionConfig<T>
): Step<T> {
  if (!config.persistence) {
    return step;
  }

  return async (ctx: T): Promise<T> => {
    return await executeDurable(step, ctx, config).then(result => {
      if (!result.success) {
        throw new Error(result.error || 'Durable execution failed');
      }
      return result.ctx;
    });
  };
}

/**
 * Create a step that can be paused at any point
 */
export function createPausableStep<T extends BaseContext>(
  step: Step<T>,
  persistence: PersistenceIO<T>,
  pauseCondition?: (ctx: T) => boolean
): Step<T> {
  return async (ctx: T): Promise<T> => {
    // Check if we should pause
    if (pauseCondition && pauseCondition(ctx)) {
      await pause(persistence, 'condition_met')(ctx);
      return ctx;
    }
    
    return await step(ctx);
  };
}

/**
 * Create a step that resumes from the last checkpoint
 */
export function createResumableStep<T extends BaseContext>(
  step: Step<T>,
  persistence: PersistenceIO<T>,
  checkpointId: string,
  extras?: Partial<T>
): Step<T> {
  return sequence([
    resumeFromCheckpoint(persistence, checkpointId, extras),
    step
  ]);
}

// ---------- Utility Functions ----------

/**
 * Create a simple in-memory persistence for testing
 */
export function createMemoryPersistence<T extends BaseContext>(): PersistenceIO<T> {
  const checkpoints = new Map<string, Checkpoint<T>>();
  
  return {
    save: async (checkpoint: Checkpoint<T>): Promise<string> => {
      checkpoints.set(checkpoint.id, checkpoint);
      return checkpoint.id;
    },
    load: async (id: string): Promise<Checkpoint<T>> => {
      const checkpoint = checkpoints.get(id);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${id}`);
      }
      return checkpoint;
    }
  };
}

/**
 * Create a file-based persistence
 */
export function createFilePersistence<T extends BaseContext>(
  basePath: string
): PersistenceIO<T> {
  return {
    save: async (checkpoint: Checkpoint<T>): Promise<string> => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const filePath = path.join(basePath, `${checkpoint.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
      
      return checkpoint.id;
    },
    load: async (id: string): Promise<Checkpoint<T>> => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const filePath = path.join(basePath, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      
      return JSON.parse(data) as Checkpoint<T>;
    }
  };
}
