import { createAgent, createPlan } from '../index';
import { Abstraction, Primitive, Program, ProgramRuntime } from '../discovery';

interface State {
  readonly value: number;
  readonly [key: string]: number;
}
const primitives: readonly Primitive<State>[] = [
  {
    name: 'add',
    arity: 1,
    execute: (state, args) => ({ ...state, value: state.value + args[0]! }),
  },
  {
    name: 'scale',
    arity: 1,
    execute: (state, args) => ({ ...state, value: state.value * args[0]! }),
  },
];
const affine: Abstraction = {
  name: 'affine',
  arity: 2,
  body: [
    { op: 'add', args: [{ parameter: 0 }] },
    { op: 'scale', args: [{ parameter: 1 }] },
  ],
};
const program: Program = { version: 1, body: [{ op: 'affine', args: [3, 2] }] };

describe('Inspectable program execution', () => {
  it('round-trips data and executes parameterized composition through an existing FX agent', async () => {
    const runtime = new ProgramRuntime(primitives, [affine]);
    const restored: Program = JSON.parse(JSON.stringify(program));
    expect(runtime.expand(restored)).toEqual([
      { op: 'add', args: [3] },
      { op: 'scale', args: [2] },
    ]);
    expect(runtime.run(restored, { value: 4 })).toEqual({
      state: { value: 14 },
      primitiveCalls: 2,
    });
    const agent = createAgent('discovered', createPlan('plan', [runtime.asStep(restored)]));
    expect(await agent.start({ value: 4 })).toEqual({ value: 14 });
  });

  it('validates the whole program before effects and rejects invalid serialized syntax', () => {
    const execute = jest.fn((state: State) => state);
    const runtime = new ProgramRuntime([{ name: 'touch', arity: 0, execute }]);
    expect(() =>
      runtime.run(
        {
          version: 1,
          body: [
            { op: 'touch', args: [] },
            { op: 'missing', args: [] },
          ],
        },
        { value: 1 },
      ),
    ).toThrow('Unknown');
    expect(execute).not.toHaveBeenCalled();
    expect(() =>
      runtime.expand({ version: 1, body: [{ op: 'touch', args: [{ parameter: 0 }] }] }),
    ).toThrow('Unbound');
    expect(() =>
      runtime.expand({ version: 1, body: [{ op: 'touch', args: [Infinity] }] }),
    ).toThrow();
    expect(() => runtime.expand(JSON.parse('{"version":1,"body":[],"source":"eval()"}'))).toThrow();
    expect(() => new ProgramRuntime(primitives).expand(program)).toThrow('Unknown');
  });

  it('rejects cycles, name collisions, wrong arities and expanded resource overruns', () => {
    expect(
      () =>
        new ProgramRuntime(primitives, [
          { name: 'a', arity: 0, body: [{ op: 'b', args: [] }] },
          { name: 'b', arity: 0, body: [{ op: 'a', args: [] }] },
        ]),
    ).toThrow('Recursive');
    expect(() => new ProgramRuntime(primitives, [{ ...affine, name: 'add' }])).toThrow('Duplicate');
    expect(() => new ProgramRuntime(primitives, [affine], { maxPrimitiveCalls: 1 })).toThrow(
      'primitive call limit',
    );
    expect(() =>
      new ProgramRuntime(primitives, [affine]).expand({
        version: 1,
        body: [{ op: 'affine', args: [2] }],
      }),
    ).toThrow('arity');
    expect(() =>
      new ProgramRuntime(primitives).expand({ version: 1, body: [{ op: 'add', args: [] }] }),
    ).toThrow('arity');
    expect(() => new ProgramRuntime(primitives, [], { maxCallDepth: 0 })).toThrow();
  });

  it('isolates and freezes nested state and rejects non-JSON outputs', () => {
    const input = { value: 1, nested: { values: [2] } };
    const runtime = new ProgramRuntime<typeof input>([
      {
        name: 'mutate',
        arity: 0,
        execute: (state) => {
          state.nested.values.push(3);
          return state;
        },
      },
    ]);
    expect(() => runtime.run({ version: 1, body: [{ op: 'mutate', args: [] }] }, input)).toThrow();
    expect(input.nested.values).toEqual([2]);
    const overflow = new ProgramRuntime<State>([
      { name: 'overflow', arity: 0, execute: () => ({ value: Infinity }) },
    ]);
    expect(() =>
      overflow.run({ version: 1, body: [{ op: 'overflow', args: [] }] }, { value: 0 }),
    ).toThrow('JSON');
  });

  it('snapshots definitions and compiled programs against later caller mutations', async () => {
    const mutable = { name: 'plus', arity: 0, body: [{ op: 'add', args: [2] }] };
    const runtime = new ProgramRuntime(primitives, [mutable]);
    mutable.body[0]!.args[0] = 99;
    const callerProgram = { version: 1 as const, body: [{ op: 'plus', args: [] as number[] }] };
    const step = runtime.asStep(callerProgram);
    callerProgram.body[0]!.op = 'missing';
    expect(await step({ value: 1 })).toEqual({ value: 3 });
  });

  it('rejects excessive nesting, cycles and non-JSON state before execution', () => {
    const runtime = new ProgramRuntime(primitives);
    const cycle: { nested?: unknown } = {};
    cycle.nested = cycle;
    for (const state of [cycle, new Date(), [], { value: undefined }]) {
      expect(() => runtime.run({ version: 1, body: [] }, state as unknown as State)).toThrow();
    }
    expect(
      () =>
        new ProgramRuntime(
          primitives,
          [
            { name: 'outer', arity: 0, body: [{ op: 'inner', args: [] }] },
            { name: 'inner', arity: 0, body: [{ op: 'add', args: [1] }] },
          ],
          { maxCallDepth: 1 },
        ),
    ).toThrow('depth limit');
  });
});
