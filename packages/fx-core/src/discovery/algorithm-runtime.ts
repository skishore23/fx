import { Algorithm, Expression, Statement, parseAlgorithm } from './algorithm-model';
import {
  AlgorithmValue,
  arrayValue,
  booleanValue,
  invokeIntrinsic,
  mapValue,
  stringValue,
} from './algorithm-values';
import { positiveInteger } from './model';
import { JsonValue, snapshot } from './state';
import type { BaseContext, Step } from '../types';

export interface AlgorithmLimits {
  readonly maxSteps?: number;
  readonly maxCells?: number;
}
export interface AlgorithmUsage {
  readonly steps: number;
  readonly cells: number;
  readonly loopVisits: number;
  readonly mapReads: number;
  readonly mapWrites: number;
}
export interface AlgorithmExecution {
  readonly output: JsonValue;
  readonly usage: AlgorithmUsage;
}
export class AlgorithmFailure extends Error {
  constructor(
    message: string,
    public readonly usage: AlgorithmUsage,
  ) {
    super(message);
    this.name = 'AlgorithmFailure';
  }
}
type Signal =
  | { readonly kind: 'return'; readonly value: AlgorithmValue }
  | { readonly kind: 'break' };

/** No eval, Function, native callback, module access, clock or ambient I/O. */
export function executeAlgorithm(
  source: Algorithm,
  input: JsonValue,
  limits: AlgorithmLimits = {},
): AlgorithmExecution {
  const program = parseAlgorithm(source);
  const maxSteps = positiveInteger(limits.maxSteps ?? 100_000, 'maxSteps', 100_000_000);
  const maxCells = positiveInteger(limits.maxCells ?? 100_000, 'maxCells', 10_000_000);
  let steps = 0;
  let cells = 0;
  let loopVisits = 0;
  const usage = (): AlgorithmUsage => ({
    steps,
    cells,
    loopVisits,
    mapReads: meter.mapReads,
    mapWrites: meter.mapWrites,
  });
  const meter = {
    mapReads: 0,
    mapWrites: 0,
    step: (amount = 1): void => {
      if (steps + amount > maxSteps) throw new Error('Algorithm step budget exceeded');
      steps += amount;
    },
    allocate: (amount = 1): void => {
      if (cells + amount > maxCells) throw new Error('Algorithm allocation budget exceeded');
      cells += amount;
    },
  };
  const count = (value: unknown, depth = 0): void => {
    meter.allocate();
    if (depth > 64) throw new Error('Value nesting limit exceeded');
    if (typeof value === 'string') meter.allocate(value.length);
    if (value !== null && typeof value === 'object')
      Object.values(value).forEach((child) => count(child, depth + 1));
  };
  const variables = new Map<string, AlgorithmValue>();
  const read = (name: string): AlgorithmValue => {
    if (!variables.has(name)) throw new Error(`Unbound variable: ${name}`);
    return variables.get(name) ?? null;
  };
  const expr = (value: Expression): AlgorithmValue => {
    meter.step();
    switch (value.kind) {
      case 'literal':
        count(value.value);
        return JSON.parse(JSON.stringify(value.value)) as JsonValue;
      case 'variable':
        return read(value.name);
      case 'get': {
        const object = expr(value.object);
        const key = expr(value.key);
        if (object === null || typeof object !== 'object' || object instanceof Map)
          throw new Error('Property read requires JSON collection');
        if (Array.isArray(object)) {
          if (typeof key !== 'number' || !Number.isInteger(key))
            throw new Error('Array key must be an integer');
          return object[key] ?? null;
        }
        const name = stringValue(key);
        return Object.prototype.hasOwnProperty.call(object, name)
          ? ((object as Record<string, JsonValue>)[name] ?? null)
          : null;
      }
      case 'call': {
        if (value.op === 'and' || value.op === 'or') {
          if (value.args.length !== 2) throw new Error(`Wrong arity for ${value.op}`);
          const first = booleanValue(expr(value.args[0]!));
          if ((value.op === 'and' && !first) || (value.op === 'or' && first)) return first;
          return booleanValue(expr(value.args[1]!));
        }
        const result = invokeIntrinsic(value.op, value.args.map(expr), meter);
        if (typeof result === 'number' && !Number.isFinite(result))
          throw new Error('Non-finite arithmetic result');
        return result;
      }
    }
  };
  const block = (body: readonly Statement[]): Signal | undefined => {
    for (const statement of body) {
      meter.step();
      switch (statement.kind) {
        case 'set':
          if (!variables.has(statement.name)) meter.allocate();
          variables.set(statement.name, expr(statement.value));
          break;
        case 'append': {
          const list = arrayValue(read(statement.name));
          const value = expr(statement.value);
          if (value instanceof Map) throw new Error('Indexes cannot be appended to JSON arrays');
          meter.allocate();
          (list as JsonValue[]).push(value);
          break;
        }
        case 'put': {
          const map = mapValue(read(statement.name));
          const key = stringValue(expr(statement.key));
          const value = expr(statement.value);
          meter.step(key.length);
          if (!map.has(key)) meter.allocate(2);
          map.set(key, value);
          meter.mapWrites++;
          break;
        }
        case 'if': {
          const signal = block(
            booleanValue(expr(statement.condition)) ? statement.then : statement.otherwise,
          );
          if (signal) return signal;
          break;
        }
        case 'for': {
          const values = arrayValue(expr(statement.values));
          // Snapshot iteration bounds, so appending cannot create an unbounded loop.
          const length = values.length;
          const had = variables.has(statement.name);
          const previous = variables.get(statement.name);
          if (!had) meter.allocate();
          try {
            for (let i = 0; i < length; i++) {
              meter.step();
              loopVisits++;
              variables.set(
                statement.name,
                values[statement.direction === 'forward' ? i : length - i - 1] ?? null,
              );
              const signal = block(statement.body);
              if (signal?.kind === 'return') return signal;
              if (signal?.kind === 'break') break;
            }
          } finally {
            if (had) variables.set(statement.name, previous ?? null);
            else variables.delete(statement.name);
          }
          break;
        }
        case 'return':
          return { kind: 'return', value: expr(statement.value) };
        case 'break':
          return { kind: 'break' };
      }
    }
    return undefined;
  };
  try {
    count(input);
    variables.set('input', snapshot({ value: input }).value!);
    const result = block(program.body);
    if (!result || result.kind !== 'return') throw new Error('Algorithm must return a JSON value');
    if (result.value instanceof Map) throw new Error('Local indexes cannot escape as output');
    count(result.value);
    return { output: snapshot({ value: result.value }).value!, usage: usage() };
  } catch (error) {
    throw new AlgorithmFailure(error instanceof Error ? error.message : String(error), usage());
  }
}

/** Explicit integration into an existing FX agent; adapters stay trusted host code. */
export function algorithmStep<S extends BaseContext>(
  source: Algorithm,
  selectInput: (state: S) => JsonValue,
  mergeOutput: (state: S, output: JsonValue) => S,
  limits: AlgorithmLimits = {},
): Step<S> {
  const algorithm = parseAlgorithm(source);
  return async (state) =>
    mergeOutput(state, executeAlgorithm(algorithm, selectInput(state), limits).output);
}
