/**
 * Simplified Composition Operators
 * Clean, predictable composition without complex generics
 */

import { Step, BaseContext } from './types';

/**
 * Identity morphism - fundamental categorical construct
 */
export const identity = <T extends BaseContext>(): Step<T> => {
  return async (state: T) => state;
};



/**
 * Kleisli composition for Promise monad
 * This is the proper categorical composition: (f ∘ g)(x) = f(g(x))
 */
const composeKleisli = <T extends BaseContext>(
  f: Step<T>,
  g: Step<T>
): Step<T> => {
  return async (state: T) => {
    const intermediate = await g(state);
    return await f(intermediate);
  };
};

/**
 * Execute steps in sequence using proper Kleisli composition
 * This is the monoidal composition of Kleisli arrows
 */
export const sequence = <T extends BaseContext>(steps: Step<T>[]): Step<T> => {
  if (steps.length === 0) return identity<T>();
  if (steps.length === 1) return steps[0]!;
  
  return steps.reduceRight(composeKleisli);
};

/**
 * Execute steps in parallel with proper result merging
 * This is the correct functional approach - we need a merge strategy
 */
export const parallel = <T extends BaseContext>(
  steps: Step<T>[],
  mergeStrategy: (results: T[], originalState: T) => T = defaultMergeStrategy
): Step<T> => {
  return async (state: T) => {
    const results = await Promise.allSettled(
      steps.map(step => step({ ...state }))
    );

    const successful: T[] = [];
    const failed: unknown[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push(result.reason);
      }
    }

    if (failed.length > 0) {
      console.warn('Some parallel steps failed:', failed);
    }

    // Use merge strategy to combine results
    return mergeStrategy(successful, state);
  };
};

/**
 * Default merge strategy - merges all successful results into original state
 */
const defaultMergeStrategy = <T extends BaseContext>(results: T[], originalState: T): T => {
  if (results.length === 0) {
    return originalState;
  }

  // Merge all results into the original state
  let mergedState = { ...originalState };
  
  for (const result of results) {
    mergedState = { ...mergedState, ...result };
  }
  
  return mergedState;
};

/**
 * Merge strategies for parallel execution
 */
export const mergeStrategies = {
  /**
   * Default: merge all results into original state
   */
  default: defaultMergeStrategy,

  /**
   * Take the first successful result
   */
  first: <T extends BaseContext>(results: T[], originalState: T): T => {
    return results[0] || originalState;
  },

  /**
   * Take the last successful result
   */
  last: <T extends BaseContext>(results: T[], originalState: T): T => {
    return results[results.length - 1] || originalState;
  },

  /**
   * Merge results with custom function
   */
  custom: <T extends BaseContext>(
    mergeFn: (results: T[], originalState: T) => T
  ) => mergeFn,

  /**
   * Collect all results in an array
   */
  collect: <T extends BaseContext>(results: T[], originalState: T): T => {
    return { ...originalState, parallelResults: results } as T;
  },

  /**
   * Merge only specific fields from results
   */
  selective: <T extends BaseContext>(
    fields: (keyof T)[]
  ) => (results: T[], originalState: T): T => {
    const mergedState = { ...originalState };
    
    for (const result of results) {
      for (const field of fields) {
        if (field in result) {
          (mergedState as any)[field] = result[field];
        }
      }
    }
    
    return mergedState;
  }
};

/**
 * Execute steps conditionally - simple conditional composition
 */
export const when = <T extends BaseContext>(
  predicate: (state: T) => boolean,
  thenStep: Step<any>,
  elseStep?: Step<any>
): Step<T> => {
  return async (state: T) => {
    if (predicate(state)) {
      return await thenStep(state) as T;
    } else if (elseStep) {
      return await elseStep(state) as T;
    }
    return state;
  };
};

/**
 * Try steps in order until one succeeds - alternative composition
 */
export const tryInOrder = <T extends BaseContext>(steps: Step<T>[]): Step<T> => {
  return async (state: T) => {
    for (const step of steps) {
      try {
        return await step(state);
      } catch (error) {
        // Continue to next step if this one fails
        continue;
      }
    }
    throw new Error('All steps failed');
  };
};

/**
 * Create a step that does nothing (identity morphism)
 */
export const noop = <T extends BaseContext>(): Step<T> => {
  return identity<T>();
};

/**
 * Create a step that always throws an error
 */
export const fail = <T extends BaseContext>(message: string): Step<T> => {
  return async () => {
    throw new Error(message);
  };
};

/**
 * Create a step that logs the current state
 */
export const log = <T extends BaseContext>(message?: string): Step<T> => {
  return async (state: T) => {
    console.log(message || 'State:', state);
    return state;
  };
};

/**
 * Create a step that validates state (guard morphism)
 */
export const validate = <T extends BaseContext>(
  predicate: (state: T) => boolean,
  errorMessage: string = 'Validation failed'
): Step<T> => {
  return async (state: T) => {
    if (!predicate(state)) {
      throw new Error(errorMessage);
    }
    return state;
  };
};

/**
 * Create a step that performs side effects without changing state
 */
export const tap = <T extends BaseContext>(
  effect: (state: T) => void | Promise<void>
): Step<T> => {
  return async (state: T) => {
    await effect(state);
    return state;
  };
};

/**
 * Delay execution by a specified amount of time
 */
export const delay = <T extends BaseContext>(ms: number): Step<T> => {
  return async (state: T) => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return state;
  };
};

/**
 * Repeat a step a specified number of times
 */
export const repeat = <T extends BaseContext>(count: number, step: Step<T>): Step<T> => {
  return async (state: T) => {
    let currentState = state;
    for (let i = 0; i < count; i++) {
      currentState = await step(currentState);
    }
    return currentState;
  };
};

/**
 * Loop while a condition is true
 */
export const loopWhile = <T extends BaseContext>(
  predicate: (state: T) => boolean,
  body: Step<any>
): Step<T> => {
  return async (state: T) => {
    let currentState: any = state;
    while (predicate(currentState)) {
      currentState = await body(currentState);
    }
    return currentState as T;
  };
};

/**
 * Retry a step with exponential backoff
 */
export const retry = <T extends BaseContext>(
  step: Step<T>,
  maxAttempts: number = 3,
  baseDelay: number = 100
): Step<T> => {
  return async (state: T) => {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await step(state);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxAttempts) {
          break;
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Retry failed');
  };
};

/**
 * Timeout a step execution
 */
export const timeout = <T extends BaseContext>(
  step: Step<T>,
  timeoutMs: number
): Step<T> => {
  return async (state: T) => {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    const stepPromise = step(state);
    
    return Promise.race([stepPromise, timeoutPromise]);
  };
};



/**
 * Create a step that executes a function and returns the result
 */
export const fromFunction = <T extends BaseContext>(
  name: string,
  fn: (state: T) => T | Promise<T> | BaseContext | Promise<BaseContext>
): Step<T> => {
  return async (state: T) => {
    const result = await fn(state);
    return result as T;
  };
};

/**
 * Create a step that sets a value in state
 */
export const setValue = <T extends BaseContext>(
  key: string,
  value: unknown
): Step<T> => {
  return async (state: T) => {
    return { ...state, [key]: value } as T;
  };
};

/**
 * Create a step that gets a value from state
 */
export const getValue = <T extends BaseContext>(
  key: string
): Step<T> => {
  return async (state: T) => {
    return { ...state, [key]: state[key] } as T;
  };
};

/**
 * Create a step that updates a value in state
 */
export const updateValue = <T extends BaseContext>(
  key: string,
  updater: (value: unknown) => unknown
): Step<T> => {
  return async (state: T) => {
    const currentValue = state[key];
    const newValue = updater(currentValue);
    return { ...state, [key]: newValue } as T;
  };
};