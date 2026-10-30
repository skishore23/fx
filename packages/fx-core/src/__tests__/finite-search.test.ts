import {
  FiniteProblem,
  synthesizeFiniteComposition,
  verifyFiniteCertificate,
} from '../discovery';

const table = (n: number, fn: (x: number) => number): number[] =>
  Array.from({ length: n }, (_, x) => fn(x));

/** Independent exhaustive words, without semantic deduplication or meet in the middle. */
const brute = (problem: FiniteProblem, maxLength: number): boolean => {
  let frontier = [table(problem.states, (x) => x)];
  for (let depth = 0; depth <= maxLength; depth++) {
    if (frontier.some((t) => t.every((y, x) => y === problem.target[x]))) return true;
    frontier = frontier.flatMap((t) =>
      problem.operations.map((op) => t.map((x) => op.table[x]!)),
    );
  }
  return false;
};

describe('exact finite composition synthesis', () => {
  test('both joins agree with independent enumeration on every Boolean operation set', () => {
    const functions = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ];
    for (let subset = 0; subset < 16; subset++)
      for (const target of functions) {
        const problem: FiniteProblem = {
          states: 2,
          target,
          operations: functions
            .filter((_, i) => subset & (1 << i))
            .map((t, i) => ({ name: `${i}`, table: t })),
        };
        for (let maxLength = 0; maxLength <= 5; maxLength++) {
          const expected = brute(problem, maxLength);
          for (const strategy of ['pairwise', 'inverse-fibers'] as const) {
            const result = synthesizeFiniteComposition(problem, {
              maxLength,
              strategy,
            });
            expect(result.status).toBe(expected ? 'solved' : 'unsatisfiable');
            if (result.status === 'solved') {
              expect(result.certificate.program.length).toBeLessThanOrEqual(maxLength);
              expect(verifyFiniteCertificate(problem, result.certificate)).toBe(true);
            }
          }
        }
      }
  });

  test('discovers a universal 16-action reset and rules out every word of length at most 15', () => {
    const problem: FiniteProblem = {
      states: 5,
      target: [0, 0, 0, 0, 0],
      operations: [
        { name: 'advance', table: [1, 2, 3, 4, 0] },
        { name: 'merge', table: [0, 1, 2, 3, 0] },
      ],
    };
    expect(synthesizeFiniteComposition(problem, { maxLength: 15 }).status).toBe(
      'unsatisfiable',
    );
    const result = synthesizeFiniteComposition(problem, { maxLength: 16 });
    expect(result.status).toBe('solved');
    if (result.status !== 'solved') throw new Error(result.status);
    expect(result.certificate.program).toHaveLength(16);
    expect(verifyFiniteCertificate(problem, result.certificate)).toBe(true);
    expect(verifyFiniteCertificate(problem, { ...result.certificate, program: [] })).toBe(
      false,
    );
    expect(
      verifyFiniteCertificate({ ...problem, target: [1, 1, 1, 1, 1] }, result.certificate),
    ).toBe(false);
  });

  test('budgets cannot be confused with a proof of impossibility', () => {
    const problem = {
      states: 3,
      target: [0, 0, 0],
      operations: [
        { name: 'rotate', table: [1, 2, 0] },
        { name: 'merge', table: [0, 1, 0] },
      ],
    };
    expect(synthesizeFiniteComposition(problem, { maxBank: 1 }).status).toBe(
      'budget_exhausted',
    );
    const limited = synthesizeFiniteComposition(problem, { maxWork: 1 });
    expect(limited.status).toBe('budget_exhausted');
    expect(limited.usage.work).toBeLessThanOrEqual(1);
    expect(() => synthesizeFiniteComposition(problem, { maxLength: -1 })).toThrow();
    expect(() => synthesizeFiniteComposition({ ...problem, target: [0, 1, 3] })).toThrow();
    expect(() => synthesizeFiniteComposition({ ...problem, target: [0] })).toThrow();
  });

  test('certificates are immutable data and reject invalid operation indices', () => {
    const problem = {
      states: 2,
      target: [0, 0],
      operations: [{ name: 'reset', table: [0, 0] }],
    };
    const result = synthesizeFiniteComposition(problem);
    if (result.status !== 'solved') throw new Error(result.status);
    expect(Object.isFrozen(result.certificate.program)).toBe(true);
    expect(
      verifyFiniteCertificate(problem, {
        ...result.certificate,
        program: [10],
      }),
    ).toBe(false);
    expect(
      verifyFiniteCertificate(problem, {
        ...result.certificate,
        output: [0, 1],
      }),
    ).toBe(false);
    problem.operations[0]!.table[0] = 1;
    expect(verifyFiniteCertificate(problem, result.certificate)).toBe(false);
  });
});
