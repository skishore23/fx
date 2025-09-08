/**
 * Navigator API Tests
 * Test the functional composition API
 */

import { createAgent, when, step } from '../navigator';
import { BaseContext } from '@fx/core';

// ---------- Test Context ----------
interface TestContext extends BaseContext {
  value?: number;
  processed?: boolean;
  error?: string;
  [key: string]: unknown;
}

// ---------- Test Steps ----------
const incrementStep = step<TestContext>('increment',
  when(ctx => !ctx.processed),
  async (ctx: TestContext) => {
    return { ...ctx, value: (ctx.value || 0) + 1 };
  }
);

const processStep = step<TestContext>('process',
  when(ctx => ctx.value !== undefined && !ctx.processed),
  async (ctx: TestContext) => {
    return { ...ctx, processed: true };
  }
);

const failingStep = step<TestContext>('failing',
  when(_ctx => true),
  async (_ctx: TestContext) => {
    throw new Error('Step failed');
  }
);

// ---------- Tests ----------

describe('Navigator API', () => {
  test('should create agent with functional composition', () => {
    const agent = createAgent<TestContext>([incrementStep, processStep]);
    
    expect(agent).toBeDefined();
    expect((agent as any).steps).toHaveLength(2);
  });

  test('should execute steps in sequence', async () => {
    const agent = createAgent<TestContext>([incrementStep, processStep]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(true);
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });

  test('should handle step failures', async () => {
    const agent = createAgent<TestContext>([incrementStep, failingStep]);

    const result = await agent.run({ value: 0 });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should create execution plan', async () => {
    const agent = createAgent<TestContext>([incrementStep, processStep]);

    const plan = await agent.plan({ value: 0 });

    expect(plan.layers).toBeDefined();
    expect(plan.layers.length).toBeGreaterThan(0);
  });

  test('should configure retry policy', () => {
    const agent = createAgent<TestContext>([incrementStep]);
    agent.policy.retry('increment', { times: 3, backoff: 'exp' });

    expect(agent).toBeDefined();
  });

  test('should configure timeout policy', () => {
    const agent = createAgent<TestContext>([incrementStep]);
    agent.policy.timeout(5000);

    expect(agent).toBeDefined();
  });

  test('should configure independence policy', () => {
    const agent = createAgent<TestContext>([incrementStep, processStep]);
    agent.policy.independent(['increment'], ['process']);

    expect(agent).toBeDefined();
  });

  test('should configure ReAct pattern', () => {
    const reactAgent = createAgent<TestContext>([incrementStep]).react({
      decide: async (_ctx) => 'increment',
      goal: (ctx) => ctx.processed === true
    });

    expect(reactAgent).toBeDefined();
  });

  test('should create agent with policies', () => {
    const agent = createAgent<TestContext>([incrementStep]);
    agent.policy.retry('increment', { times: 3, backoff: 'exp' });

    expect(agent).toBeDefined();
  });

  test('should handle empty context', async () => {
    const agent = createAgent<TestContext>([incrementStep, processStep]);

    const result = await agent.run({});

    expect(result.success).toBe(true);
    // The increment step will run and set value to 1
    expect(result.ctx.value).toBe(1);
    expect(result.ctx.processed).toBe(true);
  });
});

describe('Guard Functions', () => {
  test('should create guard with when', () => {
    const guard = when<TestContext>(ctx => ctx.value !== undefined);
    
    expect(guard({ value: 1 })).toBe(true);
    expect(guard({})).toBe(false);
  });

  test('should create step with guard', () => {
    const testStep = step<TestContext>(
      'test',
      when(ctx => ctx.value !== undefined),
      async (ctx) => ctx
    );

    expect(testStep.name).toBe('test');
    expect(testStep.guard({ value: 1 })).toBe(true);
    expect(testStep.guard({})).toBe(false);
  });
});