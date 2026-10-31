import { createHash } from 'crypto';
import {
  Abstraction,
  Argument,
  Instruction,
  Program,
  abstractionSchema,
  positiveInteger,
  programId,
  programSchema,
  programSize,
} from './model';

export interface LearnedAbstraction {
  readonly abstraction: Abstraction;
  readonly compressionGain: number;
  readonly occurrences: number;
  readonly sources: readonly string[];
  /** Observed argument tuples, useful as a conservative search vocabulary. */
  readonly bindings: readonly (readonly number[])[];
}
export interface LearningOptions {
  readonly maxLength?: number;
  readonly minOccurrences?: number;
  readonly maxParameters?: number;
}
interface Occurrence {
  readonly body: readonly Instruction[];
}

function numeric(arg: Argument): number {
  if (typeof arg !== 'number') throw new Error('Learning requires expanded, closed programs');
  return arg;
}

/** Match a template with consistent parameter bindings; constants stay constants. */
function match(
  template: Abstraction,
  body: readonly Instruction[],
  offset: number,
): readonly number[] | undefined {
  const args: number[] = [];
  for (let i = 0; i < template.body.length; i++) {
    const expected = template.body[i];
    const actual = body[offset + i];
    if (
      !expected ||
      !actual ||
      expected.op !== actual.op ||
      expected.args.length !== actual.args.length
    )
      return undefined;
    for (let j = 0; j < expected.args.length; j++) {
      const pattern = expected.args[j];
      const value = actual.args[j];
      if (pattern === undefined || typeof value !== 'number') return undefined;
      if (typeof pattern === 'number') {
        if (pattern !== value) return undefined;
      } else {
        const prior = args[pattern.parameter];
        if (prior !== undefined && prior !== value) return undefined;
        args[pattern.parameter] = value;
      }
    }
  }
  if (Array.from({ length: template.arity }, (_, i) => args[i]).some((arg) => arg === undefined))
    return undefined;
  return args;
}

/** Exact structural factoring, with non-overlapping replacements. */
export function abstractProgram(
  value: Program,
  valueTemplate: Abstraction,
): {
  readonly program: Program;
  readonly bindings: readonly (readonly number[])[];
} {
  const program = programSchema.parse(value);
  const template = abstractionSchema.parse(valueTemplate);
  // Inferred templates always have dense parameters, but public callers may not.
  const used = new Set(
    template.body.flatMap((item) =>
      item.args.flatMap((arg) => (typeof arg === 'number' ? [] : [arg.parameter])),
    ),
  );
  if (used.size !== template.arity || [...used].some((index) => index >= template.arity)) {
    throw new Error('Abstraction parameters must be dense and all used');
  }
  const body: Instruction[] = [];
  const bindings: (readonly number[])[] = [];
  for (let offset = 0; offset < program.body.length; ) {
    const args = match(template, program.body, offset);
    if (args) {
      body.push({ op: template.name, args });
      bindings.push(args);
      offset += template.body.length;
    } else {
      const item = program.body[offset++];
      if (item) body.push(item);
    }
  }
  return { program: { version: 1, body }, bindings };
}

function inferTemplate(occurrences: readonly Occurrence[]): Abstraction {
  const exemplar = occurrences[0];
  if (!exemplar) throw new Error('No occurrences');
  const parameters = new Map<string, number>();
  const body = exemplar.body.map(
    (item, i): Instruction => ({
      op: item.op,
      args: item.args.map((_, j): Argument => {
        const values = occurrences.map((occurrence) => {
          const value = occurrence.body[i]?.args[j];
          if (value === undefined) throw new Error('Incompatible occurrences');
          return numeric(value);
        });
        const first = values[0];
        if (first === undefined) throw new Error('No argument values');
        if (values.every((value) => value === first)) return first;
        // Equal value vectors preserve parameter equality across positions.
        const key = JSON.stringify(values);
        let index = parameters.get(key);
        if (index === undefined) {
          index = parameters.size;
          parameters.set(key, index);
        }
        return { parameter: index };
      }),
    }),
  );
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { name: `learned_${digest}`, arity: parameters.size, body };
}

/**
 * Anti-unify repeated contiguous structures from successful programs supplied by
 * the caller. No evaluator or task outcome is inferred from the program itself.
 * Each returned candidate is scored independently, not as a joint library.
 */
export function learnAbstractions(
  successfulPrograms: readonly Program[],
  options: LearningOptions = {},
): readonly LearnedAbstraction[] {
  const maxLength = positiveInteger(options.maxLength ?? 6, 'maxLength', 32);
  const minOccurrences = positiveInteger(options.minOccurrences ?? 3, 'minOccurrences', 100_000);
  const maxParameters = positiveInteger(options.maxParameters ?? 8, 'maxParameters', 16);
  if (successfulPrograms.length > 1000) throw new Error('Learning corpus exceeds 1000 programs');
  const unique = new Map(
    successfulPrograms.map((value) => {
      const program = programSchema.parse(value);
      program.body.forEach((item) => item.args.forEach(numeric));
      return [programId(program), program] as const;
    }),
  );
  const corpus = [...unique].sort(([a], [b]) => a.localeCompare(b));
  const groups = new Map<string, Occurrence[]>();
  for (const [, program] of corpus) {
    for (let length = 2; length <= Math.min(maxLength, program.body.length); length++) {
      for (let start = 0; start + length <= program.body.length; start++) {
        const body = program.body.slice(start, start + length);
        const signature = JSON.stringify(body.map((item) => [item.op, item.args.length]));
        const group = groups.get(signature) ?? [];
        group.push({ body });
        groups.set(signature, group);
      }
    }
  }
  const learned: LearnedAbstraction[] = [];
  for (const occurrences of groups.values()) {
    if (occurrences.length < minOccurrences) continue;
    const abstraction = inferTemplate(occurrences);
    if (abstraction.arity > maxParameters) continue;
    const sources: string[] = [];
    const bindings = new Map<string, readonly number[]>();
    let count = 0;
    let savings = 0;
    for (const [id, original] of corpus) {
      const rewritten = abstractProgram(original, abstraction);
      if (rewritten.bindings.length === 0) continue;
      sources.push(id);
      count += rewritten.bindings.length;
      savings += programSize(original) - programSize(rewritten.program);
      rewritten.bindings.forEach((args) => bindings.set(JSON.stringify(args), args));
    }
    const definitionCost =
      programSize({ version: 1, body: abstraction.body }) + abstraction.arity + 1;
    const compressionGain = savings - definitionCost;
    if (count >= minOccurrences && sources.length >= 2 && compressionGain > 0) {
      learned.push({
        abstraction,
        compressionGain,
        occurrences: count,
        sources,
        bindings: [...bindings].sort(([a], [b]) => a.localeCompare(b)).map(([, args]) => args),
      });
    }
  }
  return learned.sort(
    (a, b) =>
      b.compressionGain - a.compressionGain || a.abstraction.name.localeCompare(b.abstraction.name),
  );
}

/** Calls only bindings witnessed in the training corpus; no new constants. */
export function abstractionActions(learned: readonly LearnedAbstraction[]): readonly Instruction[] {
  return learned.flatMap((item) =>
    item.bindings.map((args) => ({ op: item.abstraction.name, args })),
  );
}
