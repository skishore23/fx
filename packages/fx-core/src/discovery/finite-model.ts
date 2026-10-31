import { createHash } from 'crypto';

export interface FiniteOperation {
  readonly name: string;
  /** Complete deterministic semantics: table[inputState] = outputState. */
  readonly table: readonly number[];
}
export interface FiniteProblem {
  readonly states: number;
  readonly operations: readonly FiniteOperation[];
  readonly target: readonly number[];
}
export interface FiniteCertificate {
  readonly version: 1;
  readonly problemId: string;
  /** Operation indices; these are data, never executable source. */
  readonly program: readonly number[];
  readonly output: readonly number[];
}
export interface FiniteSearchOptions {
  /** Search all words of length at most this bound, including identity. */
  readonly maxLength?: number;
  readonly maxBank?: number;
  /** Charges table cells, index insertions and join constraints. */
  readonly maxWork?: number;
  readonly strategy?: 'pairwise' | 'inverse-fibers';
  /** Switch from indexed constraints to complete replay at this survivor count. */
  readonly verifyAt?: number;
}
export interface FiniteSearchUsage {
  readonly work: number;
  readonly bankSize: number;
  readonly coordinateProbes: number;
  readonly fullComparisons: number;
}
export type FiniteSearchResult = {
  readonly usage: FiniteSearchUsage;
} & (
  | { readonly status: 'solved'; readonly certificate: FiniteCertificate }
  | { readonly status: 'unsatisfiable' }
  | { readonly status: 'budget_exhausted'; readonly reason: string }
);

export function finiteInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer in [${min},${max}]`);
  return value;
}

/** Snapshot before synthesis so later caller mutations cannot alter the contract. */
export function parseFiniteProblem(problem: FiniteProblem): FiniteProblem {
  const states = finiteInteger(problem.states, 'states', 1, 256);
  finiteInteger(problem.operations.length, 'operations.length', 0, 64);
  const table = (value: readonly number[]): readonly number[] => {
    if (!Array.isArray(value) || value.length !== states)
      throw new Error('A finite table must cover every state');
    return Object.freeze(Array.from(value, (v) => finiteInteger(v, 'state', 0, states - 1)));
  };
  const operations = Object.freeze(
    problem.operations.map((op) => {
      if (typeof op.name !== 'string' || !op.name.length || op.name.length > 128)
        throw new Error('Operation names require 1..128 characters');
      return Object.freeze({ name: op.name, table: table(op.table) });
    }),
  );
  return Object.freeze({ states, operations, target: table(problem.target) });
}

export function finiteProblemId(problem: FiniteProblem): string {
  return createHash('sha256')
    .update(JSON.stringify(parseFiniteProblem(problem)))
    .digest('hex');
}

/** Independent complete replay, without the searcher's indexes or pruning rules. */
export function verifyFiniteCertificate(
  problem: FiniteProblem,
  proof: FiniteCertificate,
): boolean {
  try {
    const p = parseFiniteProblem(problem);
    if (
      proof.version !== 1 ||
      proof.problemId !== finiteProblemId(p) ||
      !Array.isArray(proof.program) ||
      proof.program.length > 64 ||
      !Array.isArray(proof.output) ||
      proof.output.length !== p.states
    )
      return false;
    for (const action of proof.program)
      finiteInteger(action, 'action', 0, p.operations.length - 1);
    for (let x = 0; x < p.states; x++) {
      let value = x;
      for (const action of proof.program) value = p.operations[action]!.table[value]!;
      if (value !== p.target[x] || value !== proof.output[x]) return false;
    }
    return true;
  } catch {
    return false;
  }
}
