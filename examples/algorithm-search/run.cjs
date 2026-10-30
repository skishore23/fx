const fs = require('node:fs');
const path = require('node:path');
const {
  searchAlgorithms,
  createModelAlgorithmProposer,
} = require('../../packages/fx-core/dist/discovery');
const { createOpenAIProvider } = require('../../packages/fx-core/dist');
const { memoryTarget, memoryCandidates } = require('./memory.cjs');
const { routeTarget, routeCandidates } = require('./routes.cjs');

const targets = {
  'fx-memory': [memoryTarget, memoryCandidates],
  'beetle-routes': [routeTarget, routeCandidates],
};

async function runTarget(name, options = {}) {
  if (!targets[name]) throw new Error(`Unknown target: ${name}`);
  const [makeTarget, makeCandidates] = targets[name];
  const proposals = options.proposals ?? makeCandidates();
  let next = 0;
  const proposer = options.provider
    ? createModelAlgorithmProposer(options.provider, {
        model: options.model,
        maxCalls: options.budget ?? 16,
      })
    : () => proposals[next++];
  const result = await searchAlgorithms(makeTarget(), proposer, {
    maxProposals: options.budget ?? 64,
    maxSteps: 1_000_000,
    maxTotalSteps: 30_000_000,
  });
  return {
    ...result,
    archive: result.archive.map(({ algorithm, ...trial }) => trial),
    proposalSource: options.provider
      ? 'model-generated-IR'
      : options.proposals
        ? 'external-JSON'
        : 'authored-structural-grammar',
    ...(proposer.usage ? { modelUsage: proposer.usage() } : {}),
    interpretation: {
      rejectedCandidates: result.archive.filter(
        (trial) => trial.error || trial.training?.passed !== trial.training?.total,
      ).length,
      heldOutStepReduction: 1 - result.selected.heldOut.steps / result.baseline.heldOut.steps,
      limitations: [
        'Search is bounded by its proposal grammar; it does not claim globally novel algorithms.',
        'Cost is interpreter steps, loop visits and allocated cells, not measured native speed.',
        'Cost baselines are explicit IR implementations, not timings of the original FX or Rust code.',
        'Memory correctness uses the actual FX getMemory function as its oracle.',
        'The Beetle target is a synthetic batch reference model; native Rust conformance is still required.',
        'The winner is exported as data and is never automatically deployed.',
      ],
    },
  };
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--target', '--out', '--budget', '--proposals', '--model'].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        'Expected --target, --out, --budget, --proposals or --model followed by a value',
      );
    options[args[i].slice(2)] = args[i + 1];
  }
  const names =
    !options.target || options.target === 'all' ? Object.keys(targets) : [options.target];
  if (options.proposals && names.length !== 1)
    throw new Error('External proposals require one explicit target');
  if (options.proposals && options.model)
    throw new Error('Choose a model or an external proposals file');
  const provider = options.model
    ? createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
      })
    : undefined;
  const proposals = options.proposals
    ? JSON.parse(fs.readFileSync(options.proposals, 'utf8'))
    : undefined;
  if (proposals && !Array.isArray(proposals))
    throw new Error('Proposals must be an array of {name,algorithm}');
  const reports = [];
  for (const name of names) {
    const report = await runTarget(name, {
      budget: options.budget ? Number(options.budget) : options.model ? 16 : 64,
      proposals,
      provider,
      model: options.model,
    });
    reports.push(report);
    if (options.out) {
      fs.mkdirSync(options.out, { recursive: true });
      fs.writeFileSync(
        path.join(options.out, `${name}.json`),
        JSON.stringify(report, null, 2) + '\n',
      );
      fs.writeFileSync(
        path.join(options.out, `${name}.algorithm.json`),
        JSON.stringify(report.accepted ? report.selected.algorithm : null, null, 2) + '\n',
      );
    }
    if (!report.accepted) process.exitCode = 1;
  }
  process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
}
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { runTarget };
