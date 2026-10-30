const { optimizePrograms } = require('../../packages/fx-core/dist');
const { assess, baselines, features, random, workload } = require('./scheduling.cjs');

function runScheduling(options = {}) {
  const budget = options.budget ?? 100;
  const training = [1, 2, 3, 4, 5, 6].map((seed) => workload(seed));
  const validation = [101, 102, 103, 104].map((seed) => workload(seed));
  const test = ['mixed', 'burst', 'long', 'many-models'].flatMap((regime, i) =>
    [201, 202, 203].map((seed) => workload(seed + i * 10, 24, regime)),
  );
  const seeds = Object.values(baselines);
  const proposer = (feedback) => {
    const rng = random(options.seed ?? 42);
    const pick = (values) => values[Math.floor(rng() * values.length)];
    const atom = () => ({ op: pick(features), args: [pick([-4, -1, 1, 4])] });
    return (archive, iteration) => {
      if (iteration < seeds.length) return seeds[iteration];
      if (!feedback)
        return { version: 1, body: Array.from({ length: 1 + Math.floor(rng() * 5) }, atom) };
      const elite = archive
        .filter((trial) => trial.evaluation?.valid)
        .sort((a, b) => b.evaluation.score - a.evaluation.score)
        .slice(0, 8);
      const parent =
        elite.length && rng() < 0.8 ? pick(elite).program : { version: 1, body: [atom()] };
      const body = parent.body.map((item) => ({ op: item.op, args: [...item.args] }));
      const mutation = rng();
      if (mutation < 0.35 && body.length < 5)
        body.splice(Math.floor(rng() * (body.length + 1)), 0, atom());
      else if (mutation < 0.5 && body.length > 1) body.splice(Math.floor(rng() * body.length), 1);
      else body[Math.floor(rng() * body.length)] = atom();
      return { version: 1, body };
    };
  };
  const search = (feedback) => {
    let trainingCalls = 0;
    const optimization = optimizePrograms(
      proposer(feedback),
      (program) => {
        const result = assess(program, training);
        trainingCalls += result.metrics.primitiveCalls;
        return result;
      },
      budget,
    );
    // Validation selects from a fixed shortlist. Test workloads are not consulted.
    const shortlist = optimization.archive
      .filter((trial) => trial.evaluation?.valid)
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .slice(0, 8);
    const validated = shortlist
      .map((trial) => ({ ...trial, validation: assess(trial.program, validation) }))
      .sort((a, b) => b.validation.score - a.validation.score);
    const selected = validated[0];
    if (!selected) throw new Error('No valid policy');
    return {
      optimization,
      selected,
      trainingCalls,
      validationCalls: validated.reduce(
        (sum, item) => sum + item.validation.metrics.primitiveCalls,
        0,
      ),
    };
  };
  const adaptive = search(true);
  const randomSearch = search(false);
  const { optimization, selected } = adaptive;
  const policies = {
    ...baselines,
    randomSearch: randomSearch.selected.program,
    discovered: selected.program,
  };
  const heldOut = Object.fromEntries(
    Object.entries(policies).map(([name, program]) => [name, assess(program, test)]),
  );
  return {
    experiment: 'gpu-scheduling-policy-discovery',
    version: 1,
    seed: options.seed ?? 42,
    proposalBudget: budget,
    evaluatedCandidates: optimization.evaluations,
    trainingSeeds: training.map((row) => row.seed),
    validationSeeds: validation.map((row) => row.seed),
    testScenarios: test.map((row) => ({ seed: row.seed, regime: row.regime })),
    selected: {
      program: selected.program,
      training: selected.evaluation,
      validation: selected.validation,
    },
    randomSearch: {
      program: randomSearch.selected.program,
      evaluatedCandidates: randomSearch.optimization.evaluations,
      training: randomSearch.selected.evaluation,
      validation: randomSearch.selected.validation,
    },
    learningCost: {
      trainingPrimitiveCalls: adaptive.trainingCalls,
      validationPrimitiveCalls: adaptive.validationCalls,
      randomSearchTrainingPrimitiveCalls: randomSearch.trainingCalls,
      randomSearchValidationPrimitiveCalls: randomSearch.validationCalls,
    },
    heldOut,
    byRegime: Object.fromEntries(
      ['mixed', 'burst', 'long', 'many-models'].map((regime) => [
        regime,
        Object.fromEntries(
          Object.entries(policies).map(([name, program]) => [
            name,
            assess(
              program,
              test.filter((row) => row.regime === regime),
            ),
          ]),
        ),
      ]),
    ),
    limitations: [
      'Synthetic, single-slot workers with deterministic durations and a four-tick model-load cost.',
      'No production traces, cancellations, retries, network effects, or simulator/native conformance.',
      'Objective is meanFlow + 0.25*meanTardiness + 0.08*totalCost; weights are authored.',
      'This experiment evolves policies using evaluator feedback; abstraction transfer is tested separately.',
      'The policy language is linear feature scoring, not arbitrary algorithm synthesis.',
      'Evaluation count is bounded; actual primitive calls and validation cost are reported separately.',
      'A negative result on a baseline or regime is retained, not hidden.',
    ],
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runScheduling(), null, 2)}\n`);
module.exports = { runScheduling };
