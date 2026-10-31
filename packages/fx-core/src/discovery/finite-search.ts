import {
  FiniteCertificate,
  FiniteProblem,
  FiniteSearchOptions,
  FiniteSearchResult,
  finiteInteger,
  finiteProblemId,
  parseFiniteProblem,
  verifyFiniteCertificate,
} from './finite-model';
import { FiniteBudget, FiniteRow, finiteBank, finiteIndex, finiteKey } from './finite-index';

/** Exact bounded synthesis over opaque finite functions, including irreversible ones. */
export function synthesizeFiniteComposition(
  value: FiniteProblem,
  options: FiniteSearchOptions = {},
): FiniteSearchResult {
  const problem = parseFiniteProblem(value);
  const maxLength = finiteInteger(options.maxLength ?? 6, 'maxLength', 0, 64);
  const maxBank = finiteInteger(options.maxBank ?? 2048, 'maxBank', 1, 16384);
  const maxWork = finiteInteger(options.maxWork ?? 10_000_000, 'maxWork', 1, 1_000_000_000);
  const verifyAt = finiteInteger(options.verifyAt ?? 4, 'verifyAt', 0, 8192);
  const strategy = options.strategy ?? 'inverse-fibers';
  if (strategy !== 'pairwise' && strategy !== 'inverse-fibers')
    throw new Error('Unknown finite strategy');
  let work = 0;
  let bankSize = 0;
  let coordinateProbes = 0;
  let fullComparisons = 0;
  const charge = (n = 1): void => {
    if (work + n > maxWork) throw new FiniteBudget('Finite search work budget exhausted');
    work += n;
  };
  const usage = () => Object.freeze({ work, bankSize, coordinateProbes, fullComparisons });
  const matches = (prefix: FiniteRow, suffix: FiniteRow): boolean => {
    fullComparisons++;
    for (let x = 0; x < problem.states; x++) {
      charge();
      if (suffix.table[prefix.table[x]!] !== problem.target[x]) return false;
    }
    return true;
  };
  const solved = (prefix: FiniteRow, suffix: FiniteRow): FiniteSearchResult => {
    // Full independent replay is mandatory even after an exact inverse hash hit.
    const certificate: FiniteCertificate = Object.freeze({
      version: 1,
      problemId: finiteProblemId(problem),
      program: Object.freeze([...prefix.word, ...suffix.word]),
      output: Object.freeze([...problem.target]),
    });
    charge(problem.states * (certificate.program.length + 1));
    if (!verifyFiniteCertificate(problem, certificate))
      throw new Error('Internal finite proof failure');
    return Object.freeze({ status: 'solved', certificate, usage: usage() });
  };
  try {
    const suffixes = finiteBank(problem, Math.ceil(maxLength / 2), maxBank, charge);
    bankSize = suffixes.length;
    const prefixes = suffixes.filter((row) => row.word.length <= Math.floor(maxLength / 2));
    if (strategy === 'pairwise') {
      for (const suffix of suffixes)
        for (const prefix of prefixes)
          if (matches(prefix, suffix)) return solved(prefix, suffix);
    } else {
      const index = finiteIndex(prefixes, problem.states, charge);
      const rowByBit = new Map<bigint, number>();
      for (let i = 0; i < prefixes.length; i++) {
        charge();
        rowByBit.set(1n << BigInt(i), i);
      }
      for (const suffix of suffixes) {
        const fibers: number[][] = Array.from({ length: problem.states }, () => []);
        for (let x = 0; x < problem.states; x++) {
          charge();
          fibers[suffix.table[x]!]!.push(x);
        }
        if (fibers.every((xs) => xs.length === 1)) {
          charge(problem.states);
          const required = problem.target.map((y) => fibers[y]![0]!);
          const i = index.exact.get(finiteKey(required));
          if (i !== undefined) return solved(prefixes[i]!, suffix);
          continue;
        }
        let remaining = index.all;
        for (const x of index.order) {
          // Bounded popcount stops as soon as the survivor threshold is exceeded.
          let sample = remaining;
          let count = 0;
          while (sample && count <= verifyAt) {
            charge();
            sample &= sample - 1n;
            count++;
          }
          if (count <= verifyAt) break;
          let allowed = 0n;
          coordinateProbes++;
          charge();
          for (const v of fibers[problem.target[x]!]!) {
            charge();
            allowed |= index.bits[x]![v]!;
          }
          remaining &= allowed;
          if (!remaining) break;
        }
        while (remaining) {
          charge();
          const bit = remaining & -remaining;
          const prefix = prefixes[rowByBit.get(bit)!]!;
          if (matches(prefix, suffix)) return solved(prefix, suffix);
          remaining ^= bit;
        }
      }
    }
    return Object.freeze({ status: 'unsatisfiable', usage: usage() });
  } catch (error) {
    if (!(error instanceof FiniteBudget)) throw error;
    return Object.freeze({
      status: 'budget_exhausted',
      reason: error.message,
      usage: usage(),
    });
  }
}
