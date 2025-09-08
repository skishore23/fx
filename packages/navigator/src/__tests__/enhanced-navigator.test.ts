/**
 * Enhanced Navigator Tests
 * Test the improved navigator API using core functions
 */

import { createAgent, composeAgent, when, step } from '../navigator';
import { sequence, parallel, updateState, compose, retry, timeout, validate, log } from '@fx/core';

// ---------- Test Context ----------
interface TestContext {
  value?: number;
  processed?: boolean;
  error?: string;
  [key: string]: unknown;
}

// ---------- Test Steps ----------
const incrementStep = step<TestContext>('increment', 
  when((ctx: TestContext) => !ctx.processed),
  async (ctx: TestContext) => {
    return { ...ctx, value: (ctx.value || 0) + 1 };
  }
);

const processStep = step<TestContext>('process',
  when((ctx: TestContext) => ctx.value !== undefined && !ctx.processed),
  async (ctx: TestContext) => {
    return { ...ctx, processed: true };
  }
);

const validateStep = step<TestContext>('validate',
  when((ctx: TestContext) => !!ctx.processed),
  validate((ctx: TestContext) => ctx.value !== undefined && ctx.processed === true)
);

// ---------- Tests ----------

describe('Enhanced Navigator API', () => {
  test('should create agent with functional composition', async () => {
    // Proper functional composition - no .add() builder pattern
    const agent = createAgent<TestContext>([incrementStep, processStep, validateStep]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use composeAgent for functional composition', async () => {
    // Even more functional - compose steps directly
    const agent = composeAgent<TestContext>(incrementStep, processStep, validateStep);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use core sequence for step composition', async () => {
    // Direct functional composition using core's sequence
    const sequenceStep = sequence([incrementStep.run, processStep.run]);
    
    const agent = createAgent<TestContext>([
      step('sequence', when(() => true), sequenceStep)
    ]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use core parallel for parallel execution', async () => {
    // Direct functional composition using core's parallel
    const parallelStep = parallel([incrementStep.run, processStep.run]);
    
    const agent = createAgent<TestContext>([
      step('parallel', when(() => true), parallelStep)
    ]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx).toBeDefined();
  });

  test('should use compose for functional composition', async () => {
    // Show proper functional composition with compose
    const composedStep = compose(
      incrementStep.run,
      processStep.run
    );
    
    const agent = createAgent<TestContext>([
      step('composed', when(() => true), composedStep)
    ]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use lenses for state transformation', async () => {
    // Show proper use of lenses for state management
    const lensStep = step<TestContext>('lensStep',
      when((ctx: TestContext) => !ctx.processed),
      async (ctx: TestContext) => {
        return updateState({
          value: (ctx.value || 0) + 1,
          processed: true
        })(ctx as any);
      }
    );
    
    const agent = createAgent<TestContext>([lensStep]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use core retry and timeout functions', async () => {
    // Use core functions directly with step wrapper
    const retryStepInstance = step<TestContext>('retryIncrement', 
      when((ctx: TestContext) => !ctx.processed),
      retry(async (ctx: TestContext) => {
        return { ...ctx, value: (ctx.value || 0) + 1 } as TestContext;
      }, 3, 100)
    );

    const timeoutStepInstance = step<TestContext>('timeoutProcess',
      when((ctx: TestContext) => ctx.value !== undefined && !ctx.processed),
      timeout(async (ctx: TestContext) => {
        return { ...ctx, processed: true } as TestContext;
      }, 5000)
    );

    const agent = createAgent<TestContext>([retryStepInstance, timeoutStepInstance]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use core log function', async () => {
    // Use core's log function directly
    const logStep = step<TestContext>('logStep',
      when((ctx: TestContext) => !ctx.processed),
      log('Processing step')
    );

    const agent = createAgent<TestContext>([logStep, processStep]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.processed).toBe(true);
  });

  test('should use composeAgent for direct composition', async () => {
    // This test shows direct step composition
    const agent = composeAgent<TestContext>(incrementStep, processStep);
    
    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });
});
