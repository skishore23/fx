const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runTransfer } = require('./transfer.cjs');
const { runScheduling } = require('./scheduling-discovery.cjs');
const { simulate, workload, baselines } = require('./scheduling.cjs');

test('abstraction transfer is reproducible and includes the saved-program control', () => {
  const result = runTransfer();
  assert.deepEqual(runTransfer(), result);
  assert.equal(result.result.learnedSolved, 8);
  assert.equal(result.result.savedProgramsSolved, 8);
  assert.equal(result.result.baselineSolved, 0);
  assert.ok(result.learning.primitiveCalls > 0);
  for (const row of result.rows) {
    for (const method of [row.baseline, row.savedPrograms, row.learned]) {
      assert.ok(method.candidates <= result.budgets.maxCandidates);
      assert.ok(method.primitiveCalls <= result.budgets.maxPrimitiveCalls);
    }
    // Prevent claiming an advantage caused solely by hiding expanded work.
    assert.equal(row.learned.primitiveCalls, row.savedPrograms.primitiveCalls);
  }
});

test('scheduler never double-books workers, starts early, violates memory, or loses jobs', () => {
  for (const regime of ['mixed', 'burst', 'long', 'many-models']) {
    const scenario = workload(911, 60, regime);
    const result = simulate(baselines.hybrid, scenario);
    assert.equal(result.jobs, scenario.jobs.length);
    assert.deepEqual(simulate(baselines.hybrid, scenario), result);
    for (const execution of result.assignments) {
      const worker = scenario.workers.find((item) => item.id === execution.worker);
      assert.ok(execution.start >= execution.arrival);
      assert.ok(execution.memory <= worker.memory);
      assert.ok(execution.finish > execution.start);
    }
    for (const worker of scenario.workers) {
      const assigned = result.assignments
        .filter((item) => item.worker === worker.id)
        .sort((a, b) => a.start - b.start);
      assigned.slice(1).forEach((item, i) => assert.ok(item.start >= assigned[i].finish));
    }
  }
});

test('simulator has an independently calculated witness for duration, setup, flow and price', () => {
  const scenario = {
    workers: [{ id: 0, memory: 8, speed: 2, price: 3, model: -1 }],
    jobs: [
      { id: 0, arrival: 0, work: 4, memory: 4, model: 0, deadline: 4 },
      { id: 1, arrival: 1, work: 6, memory: 4, model: 0, deadline: 10 },
    ],
  };
  const result = simulate(baselines.fifo, scenario);
  assert.deepEqual(
    result.assignments.map((item) => [item.start, item.finish, item.cost]),
    [
      [0, 6, 18],
      [6, 9, 9],
    ],
  );
  assert.equal(result.meanFlow, 7);
  assert.equal(result.meanTardiness, 1);
  assert.equal(result.cost, 27);
  assert.equal(result.score, -(7 + 0.25 + 0.08 * 27));
  assert.throws(() => simulate(baselines.fifo, { ...scenario, workers: [] }), /infeasible/);
  assert.equal(simulate(baselines.fifo, { ...scenario, jobs: [] }).jobs, 0);
});

test('policy search uses separate training, selection and final workloads, and retains all regimes', () => {
  const result = runScheduling({ budget: 24, seed: 7 });
  assert.deepEqual(runScheduling({ budget: 24, seed: 7 }), result);
  const seen = new Set([...result.trainingSeeds, ...result.validationSeeds]);
  assert.equal(seen.size, result.trainingSeeds.length + result.validationSeeds.length);
  assert.ok(result.testScenarios.every((item) => !seen.has(item.seed)));
  assert.ok(result.evaluatedCandidates <= result.proposalBudget);
  assert.ok(result.learningCost.trainingPrimitiveCalls > 0);
  assert.deepEqual(Object.keys(result.byRegime), ['mixed', 'burst', 'long', 'many-models']);
  for (const method of [
    'fifo',
    'shortest',
    'deadline',
    'locality',
    'cheapest',
    'hybrid',
    'randomSearch',
    'discovered',
  ]) {
    assert.ok(Number.isFinite(result.heldOut[method].score));
  }
});
