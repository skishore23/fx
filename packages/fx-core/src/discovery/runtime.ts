import type { Step } from '../types';
import {
  Abstraction,
  Argument,
  ExpandedInstruction,
  Instruction,
  Program,
  abstractionSchema,
  positiveInteger,
  programSchema,
} from './model';
import { ProgramState, snapshot } from './state';

/** Trusted synchronous primitives. The interpreter does not sandbox JavaScript. */
export interface Primitive<S extends ProgramState> {
  readonly name: string;
  readonly arity: number;
  readonly execute: (state: S, args: readonly number[]) => S;
}
export interface RuntimeLimits {
  readonly maxPrimitiveCalls?: number;
  readonly maxCallDepth?: number;
}
export interface Execution<S extends ProgramState> {
  readonly state: S;
  readonly primitiveCalls: number;
}
export class ProgramExecutionError extends Error {
  constructor(
    message: string,
    public readonly primitiveCalls: number,
  ) {
    super(message);
    this.name = 'ProgramExecutionError';
  }
}

export class ProgramRuntime<S extends ProgramState> {
  private readonly primitives = new Map<string, Primitive<S>>();
  private readonly library = new Map<string, Abstraction>();
  private readonly maxPrimitiveCalls: number;
  private readonly maxCallDepth: number;

  constructor(
    primitives: readonly Primitive<S>[],
    abstractions: readonly Abstraction[] = [],
    limits: RuntimeLimits = {},
  ) {
    this.maxPrimitiveCalls = positiveInteger(
      limits.maxPrimitiveCalls ?? 1024,
      'maxPrimitiveCalls',
      100_000,
    );
    this.maxCallDepth = positiveInteger(limits.maxCallDepth ?? 32, 'maxCallDepth', 128);
    for (const primitive of primitives) {
      // Reuse the language's name/arity validation without executing a primitive.
      abstractionSchema.parse({
        name: primitive.name,
        arity: primitive.arity,
        body: [{ op: primitive.name, args: [] }],
      });
      if (this.primitives.has(primitive.name))
        throw new Error(`Duplicate operation: ${primitive.name}`);
      if (typeof primitive.execute !== 'function')
        throw new Error(`Missing implementation: ${primitive.name}`);
      this.primitives.set(primitive.name, Object.freeze({ ...primitive }));
    }
    for (const value of abstractions) {
      const abstraction = abstractionSchema.parse(value);
      if (this.primitives.has(abstraction.name) || this.library.has(abstraction.name)) {
        throw new Error(`Duplicate operation: ${abstraction.name}`);
      }
      this.library.set(abstraction.name, abstraction);
    }
    // Check even unused definitions, including forward references and cycles.
    for (const abstraction of this.library.values()) {
      this.expand({
        version: 1,
        body: [{ op: abstraction.name, args: Array(abstraction.arity).fill(0) as number[] }],
      });
    }
  }

  /** Validate the entire program before any primitive executes. */
  expand(value: Program): readonly ExpandedInstruction[] {
    const program = programSchema.parse(value);
    const result: ExpandedInstruction[] = [];
    let visits = 0;
    const resolve = (arg: Argument, parameters: readonly number[]): number => {
      if (typeof arg === 'number') return arg;
      const bound = parameters[arg.parameter];
      if (bound === undefined) throw new Error(`Unbound parameter: ${arg.parameter}`);
      return bound;
    };
    const visit = (
      body: readonly Instruction[],
      parameters: readonly number[],
      stack: readonly string[],
    ): void => {
      for (const item of body) {
        if (++visits > 100_000) throw new Error('Program expansion exceeds 100000 visits');
        const args = Object.freeze(item.args.map((arg) => resolve(arg, parameters)));
        const primitive = this.primitives.get(item.op);
        if (primitive) {
          if (args.length !== primitive.arity) throw new Error(`Wrong arity for ${item.op}`);
          if (result.length >= this.maxPrimitiveCalls)
            throw new Error('Program exceeds primitive call limit');
          result.push(Object.freeze({ op: item.op, args }));
          continue;
        }
        const abstraction = this.library.get(item.op);
        if (!abstraction) throw new Error(`Unknown operation: ${item.op}`);
        if (args.length !== abstraction.arity) throw new Error(`Wrong arity for ${item.op}`);
        if (stack.includes(item.op)) throw new Error(`Recursive abstraction: ${item.op}`);
        if (stack.length >= this.maxCallDepth)
          throw new Error('Program exceeds abstraction depth limit');
        visit(abstraction.body, args, [...stack, item.op]);
      }
    };
    visit(program.body, [], []);
    return Object.freeze(result);
  }

  private execute(body: readonly ExpandedInstruction[], initialState: S): Execution<S> {
    let state = snapshot(initialState);
    let primitiveCalls = 0;
    for (const item of body) {
      try {
        primitiveCalls++;
        const primitive = this.primitives.get(item.op);
        if (!primitive) throw new Error(`Unknown primitive: ${item.op}`);
        state = snapshot(primitive.execute(state, item.args));
      } catch (error) {
        throw new ProgramExecutionError(
          error instanceof Error ? error.message : String(error),
          primitiveCalls,
        );
      }
    }
    return { state, primitiveCalls };
  }

  run(program: Program, initialState: S): Execution<S> {
    return this.execute(this.expand(program), initialState);
  }

  /** Existing FX agents can execute an inspected program as an ordinary Step. */
  asStep(program: Program): Step<S> {
    const body = this.expand(program);
    return async (state) => this.execute(body, state).state;
  }
}
