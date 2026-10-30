import { FiniteProblem } from './finite-model';

export interface FiniteRow {
  readonly table: readonly number[];
  readonly word: readonly number[];
}
export class FiniteBudget extends Error {}
export const finiteKey = (table: readonly number[]): string => table.join(',');

/** BFS semantic deduplication keeps the shortest representative of each function. */
export function finiteBank(
  problem: FiniteProblem,
  depth: number,
  maxBank: number,
  charge: (n?: number) => void,
): FiniteRow[] {
  const identity = Array.from({ length: problem.states }, (_, i) => i);
  const rows: FiniteRow[] = [{ table: identity, word: [] }];
  const seen = new Set([finiteKey(identity)]);
  for (let cursor = 0; cursor < rows.length; cursor++) {
    const row = rows[cursor]!;
    if (row.word.length === depth) continue;
    for (let action = 0; action < problem.operations.length; action++) {
      charge(problem.states);
      const next = row.table.map((value) => problem.operations[action]!.table[value]!);
      const key = finiteKey(next);
      if (seen.has(key)) continue;
      if (rows.length === maxBank) throw new FiniteBudget('Semantic bank capacity exhausted');
      seen.add(key);
      rows.push({ table: next, word: [...row.word, action] });
    }
  }
  return rows;
}

export function finiteIndex(
  rows: readonly FiniteRow[],
  states: number,
  charge: (n?: number) => void,
) {
  const bits: bigint[][] = Array.from({ length: states }, () => Array<bigint>(states).fill(0n));
  const exact = new Map<string, number>();
  const counts = Array.from({ length: states }, () => Array<number>(states).fill(0));
  for (let i = 0; i < rows.length; i++) {
    const bit = 1n << BigInt(i);
    const table = rows[i]!.table;
    exact.set(finiteKey(table), i);
    for (let x = 0; x < states; x++) {
      charge();
      bits[x]![table[x]!]! |= bit;
      counts[x]![table[x]!]!++;
    }
  }
  const entropy = counts.map(
    (column) =>
      -column.reduce((sum, n) => {
        charge();
        return n ? sum + (n / rows.length) * Math.log2(n / rows.length) : sum;
      }, 0),
  );
  const order = Array.from({ length: states }, (_, x) => x).sort(
    (a, b) => entropy[b]! - entropy[a]!,
  );
  return { bits, exact, order, all: (1n << BigInt(rows.length)) - 1n };
}
