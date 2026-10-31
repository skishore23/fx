import { Program, parseProgram, positiveInteger, programId } from './model';

export interface Evaluation {
  /** Higher is better; invalid candidates are never eligible for selection. */
  readonly score: number;
  readonly valid: boolean;
  readonly metrics?: Readonly<Record<string, number>>;
}
export interface OptimizationTrial {
  readonly id: string;
  readonly program: Program;
  readonly evaluation?: Evaluation;
  readonly error?: string;
}
export interface OptimizationResult {
  readonly best?: OptimizationTrial;
  readonly archive: readonly OptimizationTrial[];
  readonly evaluations: number;
}
export type CandidateProposer = (
  archive: readonly OptimizationTrial[],
  iteration: number,
) => Program;

/**
 * Evaluator-driven selection, separate from the proposer and execution runtime.
 * This bounds proposal attempts (duplicates count), not arbitrary work inside a
 * trusted evaluator. Programs and scored evidence are frozen before feedback.
 * An evaluator may implement simulation, tests or an independent verification tool.
 */
export function optimizePrograms(
  proposals: Iterable<Program> | CandidateProposer,
  evaluate: (program: Program) => Evaluation,
  maxEvaluations: number,
): OptimizationResult {
  positiveInteger(maxEvaluations, 'maxEvaluations', 1_000_000);
  const archive: OptimizationTrial[] = [];
  const seen = new Set<string>();
  let best: OptimizationTrial | undefined;
  let attempted = 0;
  const candidates =
    typeof proposals === 'function'
      ? (function* () {
          for (let iteration = 0; iteration < maxEvaluations; iteration++) {
            yield proposals(archive.slice(), iteration);
          }
        })()
      : proposals;
  // Count proposals too: an infinite stream of duplicates cannot avoid the limit.
  for (const value of candidates) {
    if (attempted++ >= maxEvaluations) break;
    let program = value;
    let id = '';
    let trial: OptimizationTrial;
    try {
      program = parseProgram(value);
      id = programId(program);
      if (seen.has(id)) continue;
      seen.add(id);
      const result = evaluate(program);
      if (
        typeof result.valid !== 'boolean' ||
        !Number.isFinite(result.score) ||
        Object.values(result.metrics ?? {}).some((metric) => !Number.isFinite(metric))
      ) {
        throw new Error('Evaluator must return a validity flag and finite scores/metrics');
      }
      const evaluation: Evaluation = Object.freeze({
        valid: result.valid,
        score: result.score,
        ...(result.metrics ? { metrics: Object.freeze({ ...result.metrics }) } : {}),
      });
      trial = Object.freeze({ id, program, evaluation });
      if (evaluation.valid && (!best || evaluation.score > (best.evaluation?.score ?? -Infinity)))
        best = trial;
    } catch (error) {
      trial = Object.freeze({
        id,
        program,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    archive.push(trial);
  }
  return { ...(best ? { best } : {}), archive, evaluations: archive.length };
}
