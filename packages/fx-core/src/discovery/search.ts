import { Instruction, Program, parseProgram, positiveInteger, programId } from './model';
import { ProgramExecutionError, ProgramRuntime } from './runtime';
import { ProgramState, sameState } from './state';

export interface Example<S extends ProgramState> {
  readonly input: S;
  readonly expected: S;
}
export interface SearchOptions {
  readonly maxCandidates: number;
  readonly maxPrimitiveCalls: number;
  readonly maxLength: number;
}
export interface Trial {
  readonly id: string;
  readonly program: Program;
  readonly status: 'passed' | 'rejected' | 'error' | 'budget_exhausted';
  readonly passedExamples: number;
  readonly primitiveCalls: number;
  readonly error?: string;
}
export interface SearchResult {
  readonly program?: Program;
  readonly trials: readonly Trial[];
  readonly candidates: number;
  readonly primitiveCalls: number;
  readonly exhausted: boolean;
}

/** Deterministic proposer; callers may replace it with model-generated programs. */
export function* enumeratePrograms(
  actions: readonly Instruction[],
  maxLength: number,
): Generator<Program> {
  positiveInteger(maxLength, 'maxLength', 16);
  if (actions.length > 128) throw new Error('Search vocabulary exceeds 128 actions');
  yield { version: 1, body: [] };
  function* bodies(prefix: readonly Instruction[], remaining: number): Generator<Program> {
    if (remaining === 0) {
      yield { version: 1, body: prefix };
      return;
    }
    for (const action of actions) yield* bodies([...prefix, action], remaining - 1);
  }
  for (let length = 1; length <= maxLength; length++) yield* bodies([], length);
}

/**
 * Bounded synthesis from input/output examples. The proposer sees no verification
 * split: verification belongs to the caller after selection. Costs include failed
 * candidates, repeated examples and failing primitive invocations.
 */
export function searchProgram<S extends ProgramState>(
  runtime: ProgramRuntime<S>,
  examples: readonly Example<S>[],
  proposals: Iterable<Program>,
  options: SearchOptions,
): SearchResult {
  positiveInteger(options.maxCandidates, 'maxCandidates', 1_000_000);
  positiveInteger(options.maxPrimitiveCalls, 'maxPrimitiveCalls', 100_000_000);
  positiveInteger(options.maxLength, 'maxLength', 128);
  if (examples.length === 0) throw new Error('Search requires at least one example');
  const trials: Trial[] = [];
  let primitiveCalls = 0;
  const finish = (exhausted: boolean, program?: Program): SearchResult => ({
    ...(program ? { program } : {}),
    trials,
    candidates: trials.length,
    primitiveCalls,
    exhausted,
  });
  for (const value of proposals) {
    if (trials.length >= options.maxCandidates) return finish(true);
    let passedExamples = 0;
    let calls = 0;
    let status: Trial['status'] = 'rejected';
    let error: string | undefined;
    let id = '';
    let program = value;
    try {
      program = parseProgram(value);
      id = programId(program);
      if (program.body.length > options.maxLength)
        throw new Error('Candidate exceeds symbolic length limit');
      const expanded = runtime.expand(program);
      for (const example of examples) {
        if (primitiveCalls + expanded.length > options.maxPrimitiveCalls) {
          status = 'budget_exhausted';
          break;
        }
        let actual: S;
        try {
          const result = runtime.run(program, example.input);
          calls += result.primitiveCalls;
          primitiveCalls += result.primitiveCalls;
          actual = result.state;
        } catch (failure) {
          const spent = failure instanceof ProgramExecutionError ? failure.primitiveCalls : 0;
          calls += spent;
          primitiveCalls += spent;
          throw failure;
        }
        if (!sameState(actual, example.expected)) break;
        passedExamples++;
      }
      if (passedExamples === examples.length) status = 'passed';
    } catch (failure) {
      status = 'error';
      error = failure instanceof Error ? failure.message : String(failure);
    }
    trials.push({
      id,
      program,
      status,
      passedExamples,
      primitiveCalls: calls,
      ...(error ? { error } : {}),
    });
    if (status === 'passed') return finish(false, program);
    if (status === 'budget_exhausted') return finish(true);
  }
  return finish(false);
}
