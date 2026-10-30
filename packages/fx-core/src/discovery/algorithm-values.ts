import { JsonValue } from './state';

export type AlgorithmValue = JsonValue | Map<string, AlgorithmValue>;
export interface AlgorithmMeter {
  step(amount?: number): void;
  allocate(amount?: number): void;
  mapReads: number;
  mapWrites: number;
}
export function numberValue(value: AlgorithmValue): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Expected finite number');
  return value;
}
export function stringValue(value: AlgorithmValue): string {
  if (typeof value !== 'string') throw new Error('Expected string');
  return value;
}
export function booleanValue(value: AlgorithmValue): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected boolean');
  return value;
}
export function arrayValue(value: AlgorithmValue): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}
export function mapValue(value: AlgorithmValue): Map<string, AlgorithmValue> {
  if (!(value instanceof Map)) throw new Error('Expected local index');
  return value;
}

export function invokeIntrinsic(
  op: string,
  values: readonly AlgorithmValue[],
  meter: AlgorithmMeter,
): AlgorithmValue {
  const arity = ['array', 'map'].includes(op)
    ? 0
    : ['neg', 'floor', 'not', 'length', 'lower', 'reverse'].includes(op)
      ? 1
      : 2;
  if (values.length !== arity) throw new Error(`Wrong arity for ${op}`);
  const a = values[0] ?? null;
  const b = values[1] ?? null;
  switch (op) {
    case 'array':
      meter.allocate();
      return [];
    case 'map':
      meter.allocate();
      return new Map();
    case 'eq':
      if (a === null || b === null) return a === b;
      if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object'))
        throw new Error('Equality requires scalar values');
      if (typeof a === 'string' && typeof b === 'string') meter.step(Math.max(a.length, b.length));
      return a === b;
    case 'gt':
      return numberValue(a) > numberValue(b);
    case 'gte':
      return numberValue(a) >= numberValue(b);
    case 'lt':
      return numberValue(a) < numberValue(b);
    case 'add':
      return numberValue(a) + numberValue(b);
    case 'sub':
      return numberValue(a) - numberValue(b);
    case 'neg':
      return -numberValue(a);
    case 'floor':
      return Math.floor(numberValue(a));
    case 'not':
      return !booleanValue(a);
    case 'length':
      if (typeof a !== 'string' && !Array.isArray(a))
        throw new Error('Length requires string or array');
      return a.length;
    case 'lower': {
      const text = stringValue(a);
      meter.step(text.length);
      meter.allocate(text.length);
      return text.toLowerCase();
    }
    case 'contains': {
      const text = stringValue(a);
      const needle = stringValue(b);
      meter.step(text.length + needle.length);
      return text.includes(needle);
    }
    case 'slice': {
      const array = arrayValue(a);
      const start = numberValue(b);
      const offset = Math.trunc(start);
      const begin =
        offset < 0 ? Math.max(array.length + offset, 0) : Math.min(offset, array.length);
      meter.step(array.length - begin);
      meter.allocate(array.length - begin);
      return array.slice(start);
    }
    case 'reverse': {
      const array = arrayValue(a);
      meter.step(array.length);
      meter.allocate(array.length);
      return [...array].reverse();
    }
    case 'has':
      meter.mapReads++;
      meter.step(stringValue(b).length);
      return mapValue(a).has(stringValue(b));
    case 'lookup':
      meter.mapReads++;
      meter.step(stringValue(b).length);
      return mapValue(a).get(stringValue(b)) ?? null;
    case 'indexOf': {
      const array = arrayValue(a);
      meter.step(array.length);
      return array.indexOf(b as JsonValue);
    }
    default:
      throw new Error(`Unsupported intrinsic: ${op}`);
  }
}
