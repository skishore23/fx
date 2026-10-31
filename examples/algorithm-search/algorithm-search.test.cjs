const assert = require('node:assert/strict');
const { test } = require('node:test');
const { executeAlgorithm } = require('../../packages/fx-core/dist/discovery');
const { runTarget } = require('./run.cjs');
const { memoryTarget } = require('./memory.cjs');
const { routeTarget, routeReference } = require('./routes.cjs');

test('a model adapter can propose runnable FX algorithms without live credentials', async () => {
  const baseline = memoryTarget().baseline;
  let calls = 0;
  const provider = {
    chat: async () => {
      calls++;
      return {
        content: JSON.stringify({ name: 'model-candidate', algorithm: baseline }),
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      };
    },
  };
  const result = await runTarget('fx-memory', { provider, model: 'mock', budget: 2 });
  assert.equal(result.accepted, true);
  assert.equal(result.proposalSource, 'model-generated-IR');
  assert.equal(calls, 2);
  assert.deepEqual(result.modelUsage, { calls: 2, promptTokens: 20, completionTokens: 4 });
});

test('algorithm search finds a correct FX scan variant and rejects broken early exits', async () => {
  const result = await runTarget('fx-memory');
  assert.equal(result.accepted, true);
  assert.ok(result.selected.heldOut.steps < result.baseline.heldOut.steps);
  assert.ok(result.interpretation.rejectedCandidates > 0);
  const reference = memoryTarget().reference;
  for (let seed = 0; seed < 60; seed++) {
    const input = {
      entries: Array.from({ length: seed % 23 }, (_, i) => ({
        id: `${seed}-${i}`,
        type: i % 2 ? 'action' : 'error',
        content: i % 3 ? 'normal' : 'ÅNGSTRÖM build',
        timestamp: (i % 5) * 1000,
      })),
      filter: {
        type: seed % 3 ? 'error' : null,
        since: seed % 2 ? 1000 : null,
        search: seed % 4 ? 'build' : null,
        limit: [null, 0, 1, -2, 2.5, 0.5, 9999][seed % 7],
      },
    };
    assert.deepEqual(
      executeAlgorithm(result.selected.algorithm, input).output,
      await reference(input),
    );
  }
});

test('indexed batch routing preserves precedence, first-converse order and missing routes', async () => {
  const result = await runTarget('beetle-routes');
  assert.equal(result.accepted, true);
  assert.ok(result.selected.heldOut.steps < result.baseline.heldOut.steps);
  assert.ok(result.selected.heldOut.loopVisits < result.baseline.heldOut.loopVisits);
  for (let seed = 0; seed < 60; seed++) {
    const input = {
      routes: Array.from({ length: seed }, (_, i) => ({
        id: i,
        address: `a${i % 7}`,
        policy: i % 4 ? 'observe' : 'converse',
      })),
      queries: [['a1', 'a2'], ['missing'], ['a2', 'a1'], [], ['a1', 'a1']],
    };
    assert.deepEqual(
      executeAlgorithm(result.selected.algorithm, input).output,
      routeReference(input),
    );
  }
  assert.equal(routeTarget().id, 'beetle.route.batch-most-specific');
});
