import { Algorithm, algorithmId, parseAlgorithm } from './algorithm-model';
import { AlgorithmFailure, AlgorithmLimits, executeAlgorithm } from './algorithm-runtime';
import { positiveInteger } from './model';
import { JsonValue, snapshot } from './state';
import { createHash } from 'crypto';

export interface AlgorithmCase {
  readonly name: string;
  readonly input: JsonValue;
}
export interface AlgorithmTarget {
  readonly id: string;
  readonly contract: string;
  readonly baseline: Algorithm;
  readonly reference: (input: JsonValue) => JsonValue | Promise<JsonValue>;
  readonly training: readonly AlgorithmCase[];
  readonly validation: readonly AlgorithmCase[];
  readonly heldOut: readonly AlgorithmCase[];
}
export interface CaseAssessment {
  readonly passed: number;
  readonly total: number;
  readonly steps: number;
  readonly loopVisits: number;
  readonly maxCells: number;
  readonly failures: readonly { readonly name: string; readonly error: string }[];
}
export interface AlgorithmTrial {
  readonly id: string;
  readonly name: string;
  readonly algorithm?: Algorithm;
  readonly training?: CaseAssessment;
  readonly error?: string;
}
export interface AlgorithmProposal {
  readonly name: string;
  readonly algorithm: unknown;
}
export type AlgorithmProposer = (context: {
  readonly iteration: number;
  readonly target: { readonly id: string; readonly contract: string };
  readonly archive: readonly AlgorithmTrial[];
}) => AlgorithmProposal | undefined | Promise<AlgorithmProposal | undefined>;
export interface AlgorithmSearchOptions extends AlgorithmLimits {
  readonly maxProposals?: number;
  readonly maxTotalSteps?: number;
  readonly shortlist?: number;
}
interface PreparedCase extends AlgorithmCase {
  readonly expected: JsonValue;
}
const canonical = (value: JsonValue): string => JSON.stringify(snapshot({ value }).value);
const digest = (value: JsonValue): string =>
  createHash('sha256').update(canonical(value)).digest('hex');

/** Offline algorithm search: oracle, search feedback, selection and final test are separate. */
export async function searchAlgorithms(
  target: AlgorithmTarget,
  propose: AlgorithmProposer,
  options: AlgorithmSearchOptions = {},
) {
  const maxProposals = positiveInteger(options.maxProposals ?? 64, 'maxProposals', 10_000);
  const maxTotalSteps = positiveInteger(
    options.maxTotalSteps ?? 20_000_000,
    'maxTotalSteps',
    1_000_000_000,
  );
  const maxSteps = positiveInteger(options.maxSteps ?? 200_000, 'maxSteps', 100_000_000);
  const maxCells = positiveInteger(options.maxCells ?? 200_000, 'maxCells', 10_000_000);
  const shortlist = positiveInteger(options.shortlist ?? 5, 'shortlist', 100);
  const seenInputs = new Set<string>();
  const splitDigests: Record<string, string[]> = {};
  const prepare = async (
    cases: readonly AlgorithmCase[],
    split: string,
  ): Promise<PreparedCase[]> => {
    if (!cases.length || cases.length > 128) throw new Error('Each split requires 1..128 cases');
    splitDigests[split] = [];
    const prepared: PreparedCase[] = [];
    for (const item of cases) {
      const input = snapshot({ value: item.input }).value!;
      const hash = digest(input);
      if (seenInputs.has(hash))
        throw new Error('Duplicate inputs across algorithm experiment cases');
      seenInputs.add(hash);
      splitDigests[split]!.push(hash);
      const expected = snapshot({ value: await target.reference(input) }).value!;
      prepared.push({ name: item.name, input, expected });
    }
    return prepared;
  };
  const training = await prepare(target.training, 'training');
  const validation = await prepare(target.validation, 'validation');
  const heldOut = await prepare(target.heldOut, 'heldOut');
  let totalSteps = 0;
  const assess = (algorithm: Algorithm, cases: readonly PreparedCase[]): CaseAssessment => {
    let passed = 0;
    let steps = 0;
    let loopVisits = 0;
    let cells = 0;
    const failures: { name: string; error: string }[] = [];
    for (const item of cases) {
      const remaining = maxTotalSteps - totalSteps;
      if (remaining <= 0) throw new Error('Algorithm search total step budget exhausted');
      try {
        const result = executeAlgorithm(algorithm, item.input, {
          maxSteps: Math.min(maxSteps, remaining),
          maxCells,
        });
        steps += result.usage.steps;
        totalSteps += result.usage.steps;
        loopVisits += result.usage.loopVisits;
        cells = Math.max(cells, result.usage.cells);
        if (canonical(result.output) === canonical(item.expected)) passed++;
        else failures.push({ name: item.name, error: 'Output differs from independent reference' });
      } catch (error) {
        if (error instanceof AlgorithmFailure) {
          steps += error.usage.steps;
          totalSteps += error.usage.steps;
          loopVisits += error.usage.loopVisits;
          cells = Math.max(cells, error.usage.cells);
        }
        failures.push({
          name: item.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return Object.freeze({
      passed,
      total: cases.length,
      steps,
      loopVisits,
      maxCells: cells,
      failures: Object.freeze(failures.map((item) => Object.freeze(item))),
    });
  };
  const baseline = parseAlgorithm(target.baseline);
  const baselineTraining = assess(baseline, training);
  if (baselineTraining.passed !== baselineTraining.total)
    throw new Error('Baseline violates the target reference');
  const baselineTrial: AlgorithmTrial = Object.freeze({
    id: algorithmId(baseline),
    name: 'baseline',
    algorithm: baseline,
    training: baselineTraining,
  });
  const archive: AlgorithmTrial[] = [];
  const seen = new Set<string>();
  for (let iteration = 0; iteration < maxProposals; iteration++) {
    let proposal: AlgorithmProposal | undefined;
    try {
      proposal = await propose(
        Object.freeze({
          iteration,
          target: Object.freeze({ id: target.id, contract: target.contract }),
          archive: Object.freeze([baselineTrial, ...archive]),
        }),
      );
    } catch (error) {
      archive.push(
        Object.freeze({
          id: '',
          name: `proposer-error-${iteration}`,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      continue;
    }
    if (!proposal) break;
    let trial: AlgorithmTrial;
    try {
      const algorithm = parseAlgorithm(proposal.algorithm);
      const id = algorithmId(algorithm);
      if (seen.has(id)) continue;
      seen.add(id);
      trial = { id, name: proposal.name, algorithm, training: assess(algorithm, training) };
    } catch (error) {
      trial = {
        id: '',
        name: proposal.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    archive.push(Object.freeze(trial));
  }
  // The baseline is always a selectable fallback, never an implicit passing candidate.
  const candidates = [baselineTrial, ...archive]
    .filter((trial) => trial.algorithm && trial.training?.passed === training.length)
    .sort((a, b) => a.training!.steps - b.training!.steps || a.id.localeCompare(b.id));
  const distinct = [...new Map(candidates.map((trial) => [trial.id, trial])).values()].slice(
    0,
    shortlist,
  );
  if (!distinct.some((trial) => trial.id === baselineTrial.id)) distinct.push(baselineTrial);
  const validated = distinct
    .map((trial) => ({ trial, validation: assess(trial.algorithm!, validation) }))
    .filter((item) => item.validation.passed === validation.length)
    .sort(
      (a, b) => a.validation.steps - b.validation.steps || a.trial.id.localeCompare(b.trial.id),
    );
  const selected = validated[0];
  if (!selected) throw new Error('No candidate passes independent validation');
  const baselineTest = assess(baseline, heldOut);
  if (baselineTest.passed !== heldOut.length)
    throw new Error('Baseline violates held-out reference');
  // Final cases are consulted exactly once after selection; failure never triggers reselection.
  const finalTest = assess(selected.trial.algorithm!, heldOut);
  return {
    version: 1 as const,
    target: { id: target.id, contract: target.contract },
    accepted: finalTest.passed === finalTest.total,
    selected: {
      ...selected.trial,
      algorithm: selected.trial.algorithm!,
      training: selected.trial.training!,
      validation: selected.validation,
      heldOut: finalTest,
    },
    baseline: { algorithm: baseline, training: baselineTraining, heldOut: baselineTest },
    archive: Object.freeze(archive),
    splitDigests,
    cost: {
      totalSteps,
      maxTotalSteps,
      maxProposals,
      maxStepsPerCase: maxSteps,
      maxCellsPerCase: maxCells,
    },
    note: 'Steps are deterministic interpreter work units, not native time. No production activation.',
  };
}
