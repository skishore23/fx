import {
  Algorithm,
  AlgorithmFailure,
  algorithmStep,
  Statement,
  algorithmId,
  executeAlgorithm,
  expressionBuilder as e,
  parseAlgorithm,
} from '../discovery';
import { createAgent, createPlan } from '../index';

const variable = e.variable;
const literal = e.literal;
const program = (...body: Statement[]): Algorithm => ({ version: 1, body });

describe('Bounded algorithm language', () => {
  it.each([
    ['sub', [5, 2], 3],
    ['neg', [2], -2],
    ['floor', [2.9], 2],
    ['gte', [2, 2], true],
    ['lt', [1, 2], true],
    ['or', [false, true], true],
    ['not', [true], false],
    ['length', [[1, 2]], 2],
    ['lower', ['ÅNGSTRÖM'], 'ångström'],
    ['contains', ['build finished', 'build'], true],
    ['slice', [[1, 2, 3], -2], [2, 3]],
    ['reverse', [[1, 2, 3]], [3, 2, 1]],
    ['indexOf', [[3, 4], 4], 1],
  ] as const)('implements %s with JSON values', (op, args, expected) => {
    const source = program({
      kind: 'return',
      value: e.call(op, ...args.map((value) => literal(value))),
    });
    expect(executeAlgorithm(source, null).output).toEqual(expected);
  });
  it('runs a selected algorithm as a step in an existing FX agent', async () => {
    type State = { value: number; result?: number };
    const algorithm = program({
      kind: 'return',
      value: e.call('add', variable('input'), literal(2)),
    });
    const agent = createAgent(
      'algorithm',
      createPlan('plan', [
        algorithmStep<State>(
          algorithm,
          (state) => state.value,
          (state, output) => ({ ...state, result: output as number }),
        ),
      ]),
    );
    expect(await agent.start({ value: 3 })).toEqual({ value: 3, result: 5 });
  });
  it('executes loops, branches, early exits and stable output order', () => {
    const algorithm = program(
      { kind: 'set', name: 'result', value: e.call('array') },
      {
        kind: 'for',
        name: 'item',
        direction: 'reverse',
        values: variable('input'),
        body: [
          {
            kind: 'if',
            condition: e.call('gt', variable('item'), literal(1)),
            then: [{ kind: 'append', name: 'result', value: variable('item') }, { kind: 'break' }],
            otherwise: [],
          },
        ],
      },
      { kind: 'return', value: variable('result') },
    );
    expect(executeAlgorithm(algorithm, [0, 2, 3]).output).toEqual([3]);
    expect(executeAlgorithm(algorithm, [0, 1]).output).toEqual([]);
    expect(algorithmId(JSON.parse(JSON.stringify(algorithm)))).toBe(algorithmId(algorithm));
    const parsed = parseAlgorithm(algorithm);
    expect(Object.isFrozen(parsed.body)).toBe(true);
    expect(parseAlgorithm(parsed)).toBe(parsed);
  });

  it('builds local indexes and never exposes a native Map as output', () => {
    const algorithm = program(
      { kind: 'set', name: 'index', value: e.call('map') },
      { kind: 'put', name: 'index', key: literal('__proto__'), value: literal(7) },
      { kind: 'return', value: e.call('lookup', variable('index'), literal('__proto__')) },
    );
    const result = executeAlgorithm(algorithm, null);
    expect(result.output).toBe(7);
    expect(result.usage.mapWrites).toBe(1);
    expect(result.usage.mapReads).toBe(1);
    expect(() =>
      executeAlgorithm(
        program(
          { kind: 'set', name: 'index', value: e.call('map') },
          { kind: 'return', value: variable('index') },
        ),
        null,
      ),
    ).toThrow('cannot escape');
  });

  it('restores loop-variable bindings and snapshots iteration bounds', () => {
    const algorithm = program(
      { kind: 'set', name: 'item', value: literal(99) },
      { kind: 'set', name: 'items', value: literal([1]) },
      {
        kind: 'for',
        name: 'item',
        values: variable('items'),
        direction: 'forward',
        body: [{ kind: 'append', name: 'items', value: literal(2) }],
      },
      { kind: 'return', value: variable('item') },
    );
    const result = executeAlgorithm(algorithm, null);
    expect(result.output).toBe(99);
    expect(result.usage.loopVisits).toBe(1);
  });

  it('enforces instruction and allocation budgets and reports failed work', () => {
    const algorithm = program(
      {
        kind: 'for',
        name: 'x',
        values: variable('input'),
        direction: 'forward',
        body: [{ kind: 'set', name: 'last', value: variable('x') }],
      },
      { kind: 'return', value: literal(null) },
    );
    try {
      executeAlgorithm(algorithm, Array(100).fill(1), { maxSteps: 10 });
      throw new Error('Expected bounded failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AlgorithmFailure);
      expect((error as AlgorithmFailure).usage.steps).toBeLessThanOrEqual(10);
    }
    expect(() =>
      executeAlgorithm(program({ kind: 'return', value: literal('x'.repeat(100)) }), null, {
        maxCells: 5,
      }),
    ).toThrow('allocation');
  });

  it('short-circuits conditions and rejects invalid values, arities and missing variables', () => {
    expect(
      executeAlgorithm(
        program({ kind: 'return', value: e.call('and', literal(false), variable('missing')) }),
        null,
      ).output,
    ).toBe(false);
    expect(
      executeAlgorithm(
        program({ kind: 'return', value: e.call('eq', literal({ a: 1 }), literal(null)) }),
        null,
      ).output,
    ).toBe(false);
    for (const value of [
      variable('missing'),
      e.call('add', literal(1)),
      e.call('lower', literal(1)),
      e.call('add', literal(Number.MAX_VALUE), literal(Number.MAX_VALUE)),
      e.call('eq', literal({}), literal({})),
    ]) {
      expect(() => executeAlgorithm(program({ kind: 'return', value }), null)).toThrow();
    }
    expect(() => executeAlgorithm(program({ kind: 'break' }), null)).toThrow('return');
  });

  it('does not mutate input or resolve prototype properties', () => {
    const input = { items: [1] };
    expect(() =>
      executeAlgorithm(
        program(
          { kind: 'set', name: 'items', value: e.get(variable('input'), 'items') },
          { kind: 'append', name: 'items', value: literal(2) },
          { kind: 'return', value: variable('items') },
        ),
        input,
      ),
    ).toThrow();
    expect(input.items).toEqual([1]);
    expect(
      executeAlgorithm(
        program({ kind: 'return', value: e.get(variable('input'), 'constructor') }),
        {},
      ).output,
    ).toBe(null);
  });

  it('rejects native code, recursive syntax, oversized syntax and input reassignment', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const source of [
      cycle,
      { version: 1, body: [{ kind: 'native', source: 'process.exit()' }] },
      { version: 1, body: [{ kind: 'set', name: 'input', value: { kind: 'literal', value: 0 } }] },
      { version: 1, body: [{ kind: 'return', value: { kind: 'literal', value: Infinity } }] },
    ]) {
      expect(() => parseAlgorithm(source)).toThrow();
    }
    expect(() =>
      parseAlgorithm({ version: 1, body: Array(130).fill({ kind: 'break' }) }),
    ).toThrow();
    expect(() =>
      parseAlgorithm(program({ kind: 'return', value: literal('x'.repeat(1_000_001)) })),
    ).toThrow('text');
  });
});
