import {
  Abstraction,
  Program,
  ProgramRuntime,
  abstractProgram,
  abstractionActions,
  enumeratePrograms,
  learnAbstractions,
  optimizePrograms,
  searchProgram,
} from '../discovery';

const corpus: Program[] = Array.from({ length: 4 }, (_, i) =>
  [2, 3].map((scale) => ({
    version: 1 as const,
    body: [
      { op: 'add', args: [i + 1] },
      { op: 'scale', args: [scale] },
    ],
  })),
).flat();
const runtime = new ProgramRuntime([
  {
    name: 'add',
    arity: 1,
    execute: (state: { value: number }, args) => ({ value: state.value + args[0]! }),
  },
  {
    name: 'scale',
    arity: 1,
    execute: (state: { value: number }, args) => ({ value: state.value * args[0]! }),
  },
]);
const actions = [1, 2, 3, 4]
  .map((value) => ({ op: 'add', args: [value] }))
  .concat([2, 3].map((value) => ({ op: 'scale', args: [value] })));

describe('Learning and bounded discovery', () => {
  it('infers shared parameters and fixed constants, including an unseen binding', () => {
    const programs: Program[] = Array.from({ length: 8 }, (_, i) => ({
      version: 1,
      body: [
        { op: 'add', args: [i + 1] },
        { op: 'scale', args: [i + 1] },
        { op: 'add', args: [10] },
      ],
    }));
    const learned = learnAbstractions(programs)[0]!;
    expect(learned.abstraction.body).toEqual([
      { op: 'add', args: [{ parameter: 0 }] },
      { op: 'scale', args: [{ parameter: 0 }] },
      { op: 'add', args: [10] },
    ]);
    const expanded = new ProgramRuntime(
      [
        {
          name: 'add',
          arity: 1,
          execute: (state: { value: number }, args) => ({ value: state.value + args[0]! }),
        },
        {
          name: 'scale',
          arity: 1,
          execute: (state: { value: number }, args) => ({ value: state.value * args[0]! }),
        },
      ],
      [learned.abstraction],
    );
    expect(
      expanded.run(
        { version: 1, body: [{ op: learned.abstraction.name, args: [9] }] },
        { value: 2 },
      ).state.value,
    ).toBe(109);
    expect(learnAbstractions(corpus, { maxParameters: 1 })).toEqual([]);
  });
  it('learns parameters from varied programs and preserves expansion exactly', () => {
    const learned = learnAbstractions(corpus);
    expect(learned).toHaveLength(1);
    const candidate = learned[0]!;
    expect(candidate.abstraction.arity).toBe(2);
    expect(candidate.compressionGain).toBeGreaterThan(0);
    expect(candidate.sources).toHaveLength(8);
    const withLibrary = new ProgramRuntime(
      [
        {
          name: 'add',
          arity: 1,
          execute: (state: { value: number }, args) => ({ value: state.value + args[0]! }),
        },
        {
          name: 'scale',
          arity: 1,
          execute: (state: { value: number }, args) => ({ value: state.value * args[0]! }),
        },
      ],
      [candidate.abstraction],
    );
    for (const original of corpus) {
      const rewritten = abstractProgram(original, candidate.abstraction).program;
      expect(rewritten.body).toHaveLength(1);
      expect(withLibrary.expand(rewritten)).toEqual(runtime.expand(original));
      for (const value of [-9, 0, 0.25, 13]) {
        expect(withLibrary.run(rewritten, { value })).toEqual(runtime.run(original, { value }));
      }
    }
    expect(abstractionActions(learned)).toHaveLength(8);
    expect(learnAbstractions([...corpus, ...corpus])).toEqual(learned);
  });

  it('preserves tied parameters/constants and never matches inconsistent bindings', () => {
    const template: Abstraction = {
      name: 'paired',
      arity: 1,
      body: [
        { op: 'add', args: [{ parameter: 0 }] },
        { op: 'scale', args: [{ parameter: 0 }] },
      ],
    };
    const consistent: Program = {
      version: 1,
      body: [
        { op: 'add', args: [2] },
        { op: 'scale', args: [2] },
      ],
    };
    expect(abstractProgram(consistent, template).bindings).toEqual([[2]]);
    expect(abstractProgram(corpus[0]!, template).bindings).toEqual([]);
    expect(learnAbstractions([consistent, consistent, consistent])).toEqual([]);
    expect(() =>
      learnAbstractions([{ version: 1, body: [{ op: 'add', args: [{ parameter: 0 }] }] }]),
    ).toThrow('closed');
    expect(() => abstractProgram(consistent, { ...template, arity: 2 })).toThrow('dense');
  });

  it('counts non-overlapping occurrences and charges library definition cost', () => {
    const repeat: Program = {
      version: 1,
      body: Array.from({ length: 4 }, () => ({ op: 'add', args: [1] })),
    };
    const other: Program = { version: 1, body: [...repeat.body, { op: 'scale', args: [2] }] };
    const learned = learnAbstractions([repeat, other], { maxLength: 2 });
    expect(learned[0]!.occurrences).toBe(4);
    expect(learned[0]!.compressionGain).toBe(7);
    expect(learnAbstractions(corpus.slice(0, 2))).toEqual([]);
  });

  it('searches under both budgets and returns replayable evidence including errors', () => {
    const cases = [
      { input: { value: 2 }, expected: { value: 6 } },
      { input: { value: 5 }, expected: { value: 12 } },
    ];
    const result = searchProgram(runtime, cases, enumeratePrograms(actions, 3), {
      maxCandidates: 100,
      maxPrimitiveCalls: 200,
      maxLength: 3,
    });
    expect(result.program).toBeDefined();
    expect(runtime.run(result.program!, { value: 7 }).state).toEqual({ value: 16 });
    expect(result.trials.at(-1)?.status).toBe('passed');
    expect(result.primitiveCalls).toBe(
      result.trials.reduce((sum, trial) => sum + trial.primitiveCalls, 0),
    );
    const bounded = searchProgram(runtime, cases, enumeratePrograms(actions, 4), {
      maxCandidates: 2,
      maxPrimitiveCalls: 2,
      maxLength: 4,
    });
    expect(bounded.exhausted).toBe(true);
    expect(bounded.candidates).toBeLessThanOrEqual(2);
    expect(bounded.primitiveCalls).toBeLessThanOrEqual(2);
    const errors = searchProgram(
      runtime,
      cases,
      [{ version: 1, body: [{ op: 'missing', args: [] }] }],
      {
        maxCandidates: 1,
        maxPrimitiveCalls: 10,
        maxLength: 4,
      },
    );
    expect(errors.trials[0]?.status).toBe('error');
  });

  it('charges failing primitive invocations and refuses a run that cannot fit', () => {
    const failing = new ProgramRuntime([
      {
        name: 'fail',
        arity: 0,
        execute: (_state: { value: number }) => {
          throw new Error('failure');
        },
      },
    ]);
    const result = searchProgram(
      failing,
      [{ input: { value: 0 }, expected: { value: 1 } }],
      [{ version: 1, body: [{ op: 'fail', args: [] }] }],
      { maxCandidates: 1, maxPrimitiveCalls: 1, maxLength: 2 },
    );
    expect(result.primitiveCalls).toBe(1);
    const capped = searchProgram(
      runtime,
      [{ input: { value: 0 }, expected: { value: 9 } }],
      [{ version: 1, body: actions.slice(0, 2) }],
      { maxCandidates: 1, maxPrimitiveCalls: 1, maxLength: 2 },
    );
    expect(capped.trials[0]?.status).toBe('budget_exhausted');
    expect(capped.primitiveCalls).toBe(0);
  });

  it('selects only valid finite scores, retains failures and bounds duplicate proposals', () => {
    const proposals: Program[] = [{ version: 1, body: [] }, ...corpus];
    const result = optimizePrograms(
      proposals,
      (program) => ({ valid: program.body.length > 0, score: 100 - program.body.length }),
      3,
    );
    expect(result.best?.program.body).toHaveLength(2);
    expect(result.evaluations).toBe(3);
    expect(optimizePrograms(corpus, () => ({ valid: true, score: NaN }), 2).best).toBeUndefined();
    const duplicates = function* (): Generator<Program> {
      while (true) yield corpus[0]!;
    };
    expect(optimizePrograms(duplicates(), () => ({ valid: true, score: 1 }), 3).evaluations).toBe(
      1,
    );
  });

  it('feeds immutable, independently scored outcomes back to the next proposer', () => {
    const observations: number[] = [];
    const result = optimizePrograms(
      (archive, iteration) => {
        if (archive[0]) {
          observations.push(archive[0].evaluation!.score);
          expect(Object.isFrozen(archive[0].evaluation)).toBe(true);
          expect(() => Object.assign(archive[0]!.evaluation!, { score: 999 })).toThrow();
          expect(Object.isFrozen(archive[0].program.body)).toBe(true);
          expect(Object.isFrozen(archive[0].program.body[0]?.args)).toBe(true);
        }
        return corpus[iteration]!;
      },
      (program) => ({ valid: true, score: program.body[0]!.args[0] as number }),
      3,
    );
    expect(observations).toEqual([1, 1]);
    expect(result.best?.evaluation?.score).toBe(2);
  });
});
