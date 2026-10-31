import { createHash } from 'crypto';
import { z } from 'zod';

/** A deliberately small, serializable language. No source code or eval. */
export type Argument = number | { readonly parameter: number };
export interface Instruction {
  readonly op: string;
  readonly args: readonly Argument[];
}
export interface Program {
  readonly version: 1;
  readonly body: readonly Instruction[];
}
export interface Abstraction {
  readonly name: string;
  readonly arity: number;
  readonly body: readonly Instruction[];
}
export interface ExpandedInstruction {
  readonly op: string;
  readonly args: readonly number[];
}

const name = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/)
  .max(100);
const argument = z.union([
  z.number().finite(),
  z.object({ parameter: z.number().int().min(0).max(15) }).strict(),
]);
const instruction = z.object({ op: name, args: z.array(argument).max(16) }).strict();
export const programSchema: z.ZodType<Program> = z
  .object({
    version: z.literal(1),
    body: z.array(instruction).max(128),
  })
  .strict();
export const abstractionSchema: z.ZodType<Abstraction> = z
  .object({
    name,
    arity: z.number().int().min(0).max(16),
    body: z.array(instruction).min(1).max(128),
  })
  .strict();

/** Own and freeze the program so a proposer cannot rewrite recorded evidence. */
export function parseProgram(value: unknown): Program {
  const parsed = programSchema.parse(value);
  return Object.freeze({
    version: 1 as const,
    body: Object.freeze(
      parsed.body.map((item) =>
        Object.freeze({
          op: item.op,
          args: Object.freeze(
            item.args.map((arg) => (typeof arg === 'number' ? arg : Object.freeze({ ...arg }))),
          ),
        }),
      ),
    ),
  });
}

/** Canonical for this schema: parsing fixes property order and rejects extra fields. */
export function programId(program: Program): string {
  return createHash('sha256')
    .update(JSON.stringify(parseProgram(program)))
    .digest('hex');
}

/** Description length in instruction/argument nodes, not runtime cost. */
export function programSize(program: Program): number {
  return program.body.reduce((sum, item) => sum + 1 + item.args.length, 0);
}

export function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}
