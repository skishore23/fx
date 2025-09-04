import { 
  step, 
  sequence, 
  parallel, 
  when,
  tryInOrder,
  retry,
  timeout,
  validate,
  log,
  fail
} from '../index';
import { updateState } from '../lenses';

interface TestState {
  value: number;
  message?: string;
  error?: string;
  memory: any[];
  step1?: boolean;
  step2?: boolean;
  [key: string]: any;
}

describe('Composition Functions - Fixed Implementation', () => {
  describe('sequence', () => {
    it('should validate input is an array', () => {
      expect(() => sequence(null as any)).toThrow('Steps must be an array');
      expect(() => sequence(undefined as any)).toThrow('Steps must be an array');
      expect(() => sequence('not-array' as any)).toThrow('Steps must be an array');
    });

    it('should validate all steps are functions', () => {
      const invalidSteps = [
        step('valid', (state: TestState) => state),
        'not-a-function',
        step('another-valid', (state: TestState) => state)
      ];
      
      expect(() => sequence(invalidSteps as any)).toThrow('Step at index 1 is not a function');
    });

    it('should handle empty array', async () => {
      const workflow = sequence([]);
      const result = await workflow({ value: 5, memory: [] });
      expect(result).toEqual({ value: 5, memory: [] });
    });

    it('should handle single step', async () => {
      const singleStep = step('increment', (state: TestState) => 
        updateState({ value: state.value + 1 })(state)
      );
      const workflow = sequence([singleStep]);
      const result = await workflow({ value: 5, memory: [] });
      expect(result.value).toBe(6);
    });

    it('should execute steps in order', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ step1: true, value: state.value + 1 })(state)
      );
      const step2 = step('step2', (state: TestState) => 
        updateState({ step2: true, value: state.value * 2 })(state)
      );

      const workflow = sequence([step1, step2]);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.step1).toBe(true);
      expect(result.step2).toBe(true);
      expect(result.value).toBe(12); // (5 + 1) * 2
    });
  });

  describe('parallel', () => {
    it('should validate input is an array', () => {
      expect(() => parallel(null as any)).toThrow('Steps must be an array');
      expect(() => parallel(undefined as any)).toThrow('Steps must be an array');
    });

    it('should validate all steps are functions', () => {
      const invalidSteps = [
        step('valid', (state: TestState) => state),
        'not-a-function'
      ];
      
      expect(() => parallel(invalidSteps as any)).toThrow('Step at index 1 is not a function');
    });

    it('should handle empty array', async () => {
      const workflow = parallel([]);
      const result = await workflow({ value: 5, memory: [] });
      expect(result).toEqual({ value: 5, memory: [] });
    });

    it('should execute steps in parallel and merge results', async () => {
      const step1 = step('step1', async (state: TestState) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return updateState({ step1: true, value: state.value + 1 })(state);
      });
      const step2 = step('step2', async (state: TestState) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return updateState({ step2: true, value: state.value * 2 })(state);
      });

      const workflow = parallel([step1, step2]);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.step1).toBe(true);
      expect(result.step2).toBe(true);
      // Both operations should be applied
      expect(result.value).toBe(12); // (5 * 2) + 1 from merging
    });

    it('should fail fast when any step fails', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ step1: true })(state)
      );
      const failingStep = step('failing', (state: TestState) => {
        throw new Error('Step failed');
      });

      const workflow = parallel([step1, failingStep]);
      
      await expect(workflow({ value: 5, memory: [] })).rejects.toThrow('Parallel execution failed: 1 steps failed');
    });

    it('should use custom merge strategy', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ value: 10 })(state)
      );
      const step2 = step('step2', (state: TestState) => 
        updateState({ value: 20 })(state)
      );

      const customMerge = (results: TestState[], originalState: TestState) => {
        return { ...originalState, value: results.reduce((sum, r) => sum + r.value, 0) };
      };

      const workflow = parallel([step1, step2], customMerge);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.value).toBe(30); // 10 + 20
    });
  });

  describe('when', () => {
    it('should validate predicate is a function', () => {
      expect(() => when(null as any, step('test', (s: TestState) => s))).toThrow('Predicate must be a function');
      expect(() => when('not-function' as any, step('test', (s: TestState) => s))).toThrow('Predicate must be a function');
    });

    it('should validate thenStep is a function', () => {
      expect(() => when(() => true, null as any)).toThrow('Then step must be a function');
      expect(() => when(() => true, 'not-function' as any)).toThrow('Then step must be a function');
    });

    it('should validate elseStep is a function when provided', () => {
      expect(() => when(() => true, step('test', (s: TestState) => s), null as any)).toThrow('Else step must be a function');
    });

    it('should execute thenStep when predicate returns true', async () => {
      const thenStep = step('then', (state: TestState) => 
        updateState({ message: 'then executed' })(state)
      );
      const elseStep = step('else', (state: TestState) => 
        updateState({ message: 'else executed' })(state)
      );

      const workflow = when(
        (state: TestState) => state.value > 0,
        thenStep,
        elseStep
      );

      const result = await workflow({ value: 5, memory: [] });
      expect(result.message).toBe('then executed');
    });

    it('should execute elseStep when predicate returns false', async () => {
      const thenStep = step('then', (state: TestState) => 
        updateState({ message: 'then executed' })(state)
      );
      const elseStep = step('else', (state: TestState) => 
        updateState({ message: 'else executed' })(state)
      );

      const workflow = when(
        (state: TestState) => state.value < 0,
        thenStep,
        elseStep
      );

      const result = await workflow({ value: 5, memory: [] });
      expect(result.message).toBe('else executed');
    });

    it('should return unchanged state when no elseStep provided and predicate is false', async () => {
      const thenStep = step('then', (state: TestState) => 
        updateState({ message: 'then executed' })(state)
      );

      const workflow = when(
        (state: TestState) => state.value < 0,
        thenStep
      );

      const result = await workflow({ value: 5, memory: [] });
      expect(result.message).toBeUndefined();
      expect(result.value).toBe(5);
    });
  });

  describe('tryInOrder', () => {
    it('should try steps in order until one succeeds', async () => {
      const failingStep1 = step('failing1', (state: TestState) => {
        throw new Error('First step failed');
      });
      const failingStep2 = step('failing2', (state: TestState) => {
        throw new Error('Second step failed');
      });
      const successStep = step('success', (state: TestState) => 
        updateState({ message: 'success' })(state)
      );

      const workflow = tryInOrder([failingStep1, failingStep2, successStep]);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.message).toBe('success');
    });

    it('should throw error if all steps fail', async () => {
      const failingStep1 = step('failing1', (state: TestState) => {
        throw new Error('First step failed');
      });
      const failingStep2 = step('failing2', (state: TestState) => {
        throw new Error('Second step failed');
      });

      const workflow = tryInOrder([failingStep1, failingStep2]);
      
      await expect(workflow({ value: 5, memory: [] })).rejects.toThrow('All steps failed');
    });
  });

  describe('retry', () => {
    it('should retry failed steps with exponential backoff', async () => {
      let attempts = 0;
      const failingStep = step('failing', (state: TestState) => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Step failed');
        }
        return updateState({ message: 'success after retries' })(state);
      });

      const workflow = retry(failingStep, 3, 10);
      const result = await workflow({ value: 5, memory: [] });

      expect(attempts).toBe(3);
      expect(result.message).toBe('success after retries');
    });

    it('should throw error after max attempts', async () => {
      const failingStep = step('failing', (state: TestState) => {
        throw new Error('Always fails');
      });

      const workflow = retry(failingStep, 2, 10);
      
      await expect(workflow({ value: 5, memory: [] })).rejects.toThrow('Always fails');
    });
  });

  describe('timeout', () => {
    it('should timeout slow steps', async () => {
      const slowStep = step('slow', async (state: TestState) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return updateState({ message: 'completed' })(state);
      });

      const workflow = timeout(slowStep, 50);
      
      await expect(workflow({ value: 5, memory: [] })).rejects.toThrow('Step timed out after 50ms');
    });

    it('should complete fast steps within timeout', async () => {
      const fastStep = step('fast', async (state: TestState) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return updateState({ message: 'completed' })(state);
      });

      const workflow = timeout(fastStep, 100);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.message).toBe('completed');
    });
  });

  describe('validate', () => {
    it('should pass validation when predicate returns true', async () => {
      const workflow = validate(
        (state: TestState) => state.value > 0,
        'Value must be positive'
      );

      const result = await workflow({ value: 5, memory: [] });
      expect(result).toEqual({ value: 5, memory: [] });
    });

    it('should throw error when validation fails', async () => {
      const workflow = validate(
        (state: TestState) => state.value > 0,
        'Value must be positive'
      );

      await expect(workflow({ value: -1, memory: [] })).rejects.toThrow('Value must be positive');
    });

    it('should use default error message', async () => {
      const workflow = validate((state: TestState) => state.value > 0);

      await expect(workflow({ value: -1, memory: [] })).rejects.toThrow('Validation failed');
    });
  });

  describe('log', () => {
    it('should log state and return unchanged', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const workflow = log('Test log');
      const result = await workflow({ value: 5, memory: [] });

      expect(consoleSpy).toHaveBeenCalledWith('Test log', { value: 5, memory: [] });
      expect(result).toEqual({ value: 5, memory: [] });
      
      consoleSpy.mockRestore();
    });

    it('should use default message when none provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const workflow = log();
      const result = await workflow({ value: 5, memory: [] });

      expect(consoleSpy).toHaveBeenCalledWith('State:', { value: 5, memory: [] });
      expect(result).toEqual({ value: 5, memory: [] });
      
      consoleSpy.mockRestore();
    });
  });

  describe('fail', () => {
    it('should always throw error', async () => {
      const workflow = fail('Test error');
      
      await expect(workflow({ value: 5, memory: [] })).rejects.toThrow('Test error');
    });
  });
});
