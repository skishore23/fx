import { Step, BaseContext } from './types';
import { sleep } from './utils';
import { getConfig } from './config';

/**
 * Simple resilience features for the Fx framework
 * Basic retry mechanism with minimal complexity
 */

/**
 * Retry a step on failure
 */
export const retry = <T extends BaseContext>(
  step: Step<T>,
  options: { attempts?: number; delay?: number } = {}
): Step<T> => {
  const config = getConfig();
  const attempts = options.attempts || config.maxRetries || 3;
  const delay = options.delay || config.retryDelay || 1000;

  return async (state: T) => {
    let lastError: Error | null = null;

    for (let i = 0; i < attempts; i++) {
      try {
        return await step(state);
      } catch (error) {
        lastError = error as Error;

        if (i === attempts - 1) {
          throw lastError;
        }

        await sleep(delay);
      }
    }

    throw lastError || new Error('Retry failed');
  };
};