import {
  Algorithm,
  AlgorithmTarget,
  createModelAlgorithmProposer,
  expressionBuilder as e,
  searchAlgorithms,
} from '../discovery';
const identity: Algorithm = { version: 1, body: [{ kind: 'return', value: e.variable('input') }] };
const target: AlgorithmTarget = {
  id: 'identity',
  contract: 'Return JSON input unchanged',
  baseline: identity,
  reference: (x) => x,
  training: [{ name: 'train', input: 0 }],
  validation: [{ name: 'validation', input: 1 }],
  heldOut: [{ name: 'final', input: 2 }],
};

describe('Model-proposed bounded algorithms', () => {
  it('uses the existing FX provider, records failures, and caps model calls', async () => {
    const chat = jest
      .fn()
      .mockResolvedValueOnce({
        content: 'not json',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValue({
        content: JSON.stringify({ name: 'identity', algorithm: identity }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });
    const propose = createModelAlgorithmProposer({ chat }, { model: 'test-model', maxCalls: 2 });
    const result = await searchAlgorithms(target, propose, { maxProposals: 5 });
    expect(result.accepted).toBe(true);
    expect(result.archive[0]?.name).toBe('proposer-error-0');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(propose.usage()).toEqual({ calls: 2, promptTokens: 20, completionTokens: 10 });
    expect(chat.mock.calls[0]![1].model).toBe('test-model');
    const prompt = JSON.parse(chat.mock.calls[0]![0][1].content);
    expect(Object.keys(prompt)).toEqual(['target', 'iteration', 'feedback']);
    expect(prompt.feedback[0].name).toBe('baseline');
    expect(prompt.feedback[0].heldOut).toBeUndefined();
    expect(prompt.feedback[0].validation).toBeUndefined();
  });

  it('parses model output only as data and rejects native-source proposals', async () => {
    const chat = jest
      .fn()
      .mockResolvedValue({
        content: JSON.stringify({
          name: 'native',
          algorithm: { version: 1, body: [{ kind: 'native', source: 'process.exit()' }] },
        }),
      });
    const result = await searchAlgorithms(
      target,
      createModelAlgorithmProposer({ chat }, { maxCalls: 1 }),
    );
    expect(result.accepted).toBe(true);
    expect(result.archive[0]?.error).toBeDefined();
    expect(result.selected.name).toBe('baseline');
  });

  it('bounds response size and feedback, and stops after exhausted calls', async () => {
    const chat = jest.fn().mockResolvedValue({ content: 'x'.repeat(100) });
    const propose = createModelAlgorithmProposer(
      { chat },
      { maxCalls: 1, maxResponseChars: 20, maxFeedbackChars: 10 },
    );
    const context = { iteration: 0, target: { id: 'test', contract: 'test' }, archive: [] };
    await expect(propose(context)).rejects.toThrow('character');
    expect(await propose(context)).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(() => createModelAlgorithmProposer({ chat }, { maxCalls: 0 })).toThrow();
  });
});
