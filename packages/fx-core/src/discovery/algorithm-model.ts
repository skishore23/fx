import { createHash } from 'crypto';
import { z } from 'zod';
import { JsonValue } from './state';

export type Intrinsic =
  | 'eq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'add'
  | 'sub'
  | 'neg'
  | 'floor'
  | 'and'
  | 'or'
  | 'not'
  | 'length'
  | 'lower'
  | 'contains'
  | 'slice'
  | 'reverse'
  | 'array'
  | 'map'
  | 'has'
  | 'lookup'
  | 'indexOf';
export type Expression =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'get'; readonly object: Expression; readonly key: Expression }
  | { readonly kind: 'call'; readonly op: Intrinsic; readonly args: readonly Expression[] };
export type Statement =
  | { readonly kind: 'set'; readonly name: string; readonly value: Expression }
  | { readonly kind: 'append'; readonly name: string; readonly value: Expression }
  | {
      readonly kind: 'put';
      readonly name: string;
      readonly key: Expression;
      readonly value: Expression;
    }
  | {
      readonly kind: 'if';
      readonly condition: Expression;
      readonly then: readonly Statement[];
      readonly otherwise: readonly Statement[];
    }
  | {
      readonly kind: 'for';
      readonly name: string;
      readonly values: Expression;
      readonly direction: 'forward' | 'reverse';
      readonly body: readonly Statement[];
    }
  | { readonly kind: 'return'; readonly value: Expression }
  | { readonly kind: 'break' };
export interface Algorithm {
  readonly version: 1;
  readonly body: readonly Statement[];
}

const identifier = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  .max(64);
const writable = identifier.refine((name) => name !== 'input', 'input is read-only');
const json: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]),
);
const expression: z.ZodType<Expression> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('literal'), value: json }).strict(),
    z.object({ kind: z.literal('variable'), name: identifier }).strict(),
    z.object({ kind: z.literal('get'), object: expression, key: expression }).strict(),
    z
      .object({
        kind: z.literal('call'),
        op: z.enum([
          'eq',
          'gt',
          'gte',
          'lt',
          'add',
          'sub',
          'neg',
          'floor',
          'and',
          'or',
          'not',
          'length',
          'lower',
          'contains',
          'slice',
          'reverse',
          'array',
          'map',
          'has',
          'lookup',
          'indexOf',
        ]),
        args: z.array(expression).max(3),
      })
      .strict(),
  ]),
);
const statement: z.ZodType<Statement> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('set'), name: writable, value: expression }).strict(),
    z.object({ kind: z.literal('append'), name: writable, value: expression }).strict(),
    z
      .object({ kind: z.literal('put'), name: writable, key: expression, value: expression })
      .strict(),
    z
      .object({
        kind: z.literal('if'),
        condition: expression,
        then: z.array(statement).max(128),
        otherwise: z.array(statement).max(128),
      })
      .strict(),
    z
      .object({
        kind: z.literal('for'),
        name: writable,
        values: expression,
        direction: z.enum(['forward', 'reverse']),
        body: z.array(statement).max(128),
      })
      .strict(),
    z.object({ kind: z.literal('return'), value: expression }).strict(),
    z.object({ kind: z.literal('break') }).strict(),
  ]),
);
const algorithmSchema: z.ZodType<Algorithm> = z
  .object({ version: z.literal(1), body: z.array(statement).max(128) })
  .strict();
const validated = new WeakSet<object>();

/** Bound and copy syntax before recursive schema parsing; callbacks never enter this language. */
export function parseAlgorithm(value: unknown): Algorithm {
  if (value !== null && typeof value === 'object' && validated.has(value))
    return value as Algorithm;
  const active = new Set<object>();
  let nodes = 0;
  let textUnits = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 12_000 || depth > 48)
      throw new Error('Algorithm syntax exceeds size/depth limit');
    if (typeof item === 'string') {
      textUnits += item.length;
      if (textUnits > 1_000_000) throw new Error('Algorithm text exceeds size limit');
      return item;
    }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null) throw new Error('Algorithm must be JSON data');
    if (active.has(item)) throw new Error('Cyclic algorithm syntax');
    active.add(item);
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new Error('Algorithm must use plain JSON objects');
    }
    const copied = Array.isArray(item)
      ? Array.from(item, (child) => visit(child, depth + 1))
      : Object.fromEntries(
          Object.entries(item).map(([key, child]) => [key, visit(child, depth + 1)]),
        );
    active.delete(item);
    return copied;
  };
  const parsed = algorithmSchema.parse(visit(value, 0));
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(parsed);
  validated.add(parsed);
  return parsed;
}

export function algorithmId(value: Algorithm): string {
  return createHash('sha256')
    .update(JSON.stringify(parseAlgorithm(value)))
    .digest('hex');
}

/** Small construction helpers; generated candidates remain ordinary JSON. */
export const expressionBuilder = {
  literal: (value: JsonValue): Expression => ({ kind: 'literal', value }),
  variable: (name: string): Expression => ({ kind: 'variable', name }),
  get: (object: Expression, key: string | number): Expression => ({
    kind: 'get',
    object,
    key: { kind: 'literal', value: key },
  }),
  call: (op: Intrinsic, ...args: Expression[]): Expression => ({ kind: 'call', op, args }),
};
