import { Algorithm, AlgorithmTarget, expressionBuilder as e, searchAlgorithms } from '../discovery';

const identity: Algorithm = { version: 1, body: [{ kind: 'return', value: e.variable('input') }] };
const target = (): AlgorithmTarget => ({
  id: 'identity',
  contract: 'Return input unchanged',
  baseline: identity,
  reference: (input) => input,
  training: [{ name: 'train', input: 0 }],
  validation: [{ name: 'validation', input: 1 }],
  heldOut: [{ name: 'test', input: 2 }],
});

describe('Algorithm search and independent acceptance', () => {
  it('keeps the baseline fallback even when the ranked shortlist overfits', async () => {
    const slow: Algorithm = {
      version: 1,
      body: [
        {
          kind: 'for',
          name: 'x',
          direction: 'forward',
          values: e.literal([1, 2, 3, 4]),
          body: [{ kind: 'set', name: 'last', value: e.variable('x') }],
        },
        ...identity.body,
      ],
    };
    const result = await searchAlgorithms(
      { ...target(), baseline: slow },
      (context) =>
        context.iteration === 0
          ? {
              name: 'overfit',
              algorithm: { version: 1, body: [{ kind: 'return', value: e.literal(0) }] },
            }
          : undefined,
      { shortlist: 1 },
    );
    expect(result.accepted).toBe(true);
    expect(result.selected.name).toBe('baseline');
  });
  it('rejects training overfits, retains failures and prevents validation feedback leakage', async () => {
    const proposals = [
      {
        name: 'overfit',
        algorithm: {
          version: 1 as const,
          body: [{ kind: 'return' as const, value: e.literal(0) }],
        },
      },
      { name: 'identity', algorithm: identity },
    ];
    const result = await searchAlgorithms(target(), (context) => {
      expect(Object.keys(context.target)).toEqual(['id', 'contract']);
      expect(Object.isFrozen(context.archive)).toBe(true);
      if (context.archive[0]) expect(Object.isFrozen(context.archive[0].training)).toBe(true);
      return proposals[context.iteration];
    });
    expect(result.accepted).toBe(true);
    expect(result.selected.heldOut.passed).toBe(1);
    expect(result.archive).toHaveLength(2);
    expect(result.cost.totalSteps).toBeGreaterThan(0);
    expect(new Set(Object.values(result.splitDigests).flat()).size).toBe(3);
  });

  it('never reselects a different winner after observing final-case failure', async () => {
    const slow: Algorithm = {
      version: 1,
      body: [
        {
          kind: 'for',
          name: 'x',
          direction: 'forward',
          values: e.literal([1, 2, 3, 4, 5]),
          body: [{ kind: 'set', name: 'last', value: e.variable('x') }],
        },
        ...identity.body,
      ],
    };
    const cheat: Algorithm = {
      version: 1,
      body: [
        {
          kind: 'if',
          condition: e.call('eq', e.variable('input'), e.literal(2)),
          then: [{ kind: 'return', value: e.literal(0) }],
          otherwise: identity.body,
        },
      ],
    };
    const t = { ...target(), baseline: slow };
    const result = await searchAlgorithms(t, (context) =>
      context.iteration === 0 ? { name: 'cheat', algorithm: cheat } : undefined,
    );
    expect(result.selected.name).toBe('cheat');
    expect(result.accepted).toBe(false);
    expect(result.selected.heldOut.failures[0]?.name).toBe('test');
  });

  it('rejects split overlap and an incorrect baseline', async () => {
    const t = target();
    await expect(searchAlgorithms({ ...t, heldOut: t.training }, () => undefined)).rejects.toThrow(
      'Duplicate',
    );
    await expect(searchAlgorithms({ ...t, reference: () => 99 }, () => undefined)).rejects.toThrow(
      'Baseline',
    );
  });

  it('bounds duplicate proposals and records malformed candidates without running source', async () => {
    let calls = 0;
    const result = await searchAlgorithms(
      target(),
      () => {
        calls++;
        return { name: 'duplicate', algorithm: identity };
      },
      { maxProposals: 3 },
    );
    expect(calls).toBe(3);
    expect(result.archive).toHaveLength(1);
    const malformed = await searchAlgorithms(target(), (context) =>
      context.iteration === 0
        ? {
            name: 'invalid',
            algorithm: { version: 1, body: [{ kind: 'native' }] } as unknown as Algorithm,
          }
        : undefined,
    );
    expect(malformed.archive[0]?.error).toBeDefined();
    expect(malformed.accepted).toBe(true);
    await expect(
      searchAlgorithms(target(), () => undefined, { maxTotalSteps: 1 }),
    ).rejects.toThrow();
  });
});
