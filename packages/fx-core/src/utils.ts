import crypto from "crypto";

/**
 * Essential utilities for the Fx framework
 * Simplified and focused on core functionality
 */

/**
 * Generates a new UUID v4 string
 */
export const newId = (): string => {
  return crypto.randomUUID();
};

/**
 * Creates a promise that resolves after the specified number of milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
};

/**
 * Type guard to check if a value is a Promise
 */
export const isPromise = <T>(value: T | Promise<T>): value is Promise<T> => {
  return value instanceof Promise;
};

/**
 * Simple deep clone using JSON (sufficient for most use cases)
 */
export const clone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value));
};

import { Step, BaseContext, Monad, Kleisli, Id, Maybe, Either } from './types';

/**
 * Category Theory Utilities and Helper Functions
 */

// ---------- Morphism Composition ----------

/**
 * Identity morphism - fundamental category theory concept
 */
export const identity = <A extends BaseContext>(): Step<A> => {
  return async (a: A) => a;
};

/**
 * Compose two morphisms (steps) - fundamental composition
 */
export const compose = <A extends BaseContext>(f: Step<A>, g: Step<A>): Step<A> => {
  return async (a: A) => {
    const b = await g(a);
    return f(b);
  };
};

/**
 * Compose multiple morphisms from right to left
 */
export const composeAll = <T extends BaseContext>(...steps: Step<T>[]): Step<T> => {
  return steps.reduce((acc, step) => compose(step, acc), identity<T>());
};

// ---------- Kleisli Category ----------

/**
 * Lift a regular function to work in monadic context (Kleisli arrow)
 */
export const liftM = <M, A, B>(
  monad: Monad<M>,
  f: (a: A) => B
): Kleisli<M, A> => {
  return (a: A) => monad.of(f(a));
};

/**
 * Compose Kleisli arrows (monadic functions)
 */
export const composeK = <M>(
  monad: Monad<M>
) => <A, B, C>(
  f: Kleisli<M, B>,
  g: Kleisli<M, A>
): Kleisli<M, A> => {
  return (a: A) => monad.chain(g(a), f);
};

// ---------- Natural Transformations ----------

/**
 * Natural transformation from Identity to Maybe
 */
export const identityToMaybe = <A>(a: Id<A>): Maybe<A> => ({ tag: 'Just', value: a });

/**
 * Natural transformation from Maybe to Identity
 */
export const maybeToIdentity = <A>(ma: Maybe<A>): Id<A> => {
  if (ma.tag === 'Just') {
    return ma.value;
  }
  throw new Error('Cannot extract value from Nothing');
};

/**
 * Natural transformation from Either to Maybe
 */
export const eitherToMaybe = <E, A>(ea: Either<E, A>): Maybe<A> => {
  if (ea.tag === 'Right') {
    return { tag: 'Just', value: ea.right };
  }
  return { tag: 'Nothing' };
};

/**
 * Natural transformation from Maybe to Either
 */
export const maybeToEither = <E, A>(ma: Maybe<A>, leftValue: E): Either<E, A> => {
  if (ma.tag === 'Just') {
    return { tag: 'Right', right: ma.value };
  }
  return { tag: 'Left', left: leftValue };
};

// ---------- State Operations ----------

/**
 * Safely get a nested value from an object using dot notation
 */
export const getValueAtPath = (obj: unknown, path: string): unknown => {
  const keys = path.split('.');

  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

/**
 * Set a nested value in an object using dot notation
 */
export const setValueAtPath = (obj: unknown, path: string, value: unknown): unknown => {
  const keys = path.split('.');
  const result = clone(obj as Record<string, unknown>);

  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key && (current[key] == null || typeof current[key] !== 'object')) {
      current[key] = {};
    }
    if (key) {
      current = current[key] as Record<string, unknown>;
    }
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
  return result;
};

// ---------- Functor Operations ----------

/**
 * Apply a function to each element of an array (Array functor)
 */
export const arrayMap = <A, B>(as: readonly A[], f: (a: A) => B): readonly B[] => {
  return as.map(f);
};

/**
 * Lift a function to work on Maybe values
 */
export const maybeMap = <A, B>(ma: Maybe<A>, f: (a: A) => B): Maybe<B> => {
  if (ma.tag === 'Just') {
    return { tag: 'Just', value: f(ma.value) };
  }
  return { tag: 'Nothing' };
};

/**
 * Lift a function to work on Either values
 */
export const eitherMap = <A, B>(ma: Either<unknown, A>, f: (a: A) => B): Either<unknown, B> => {
  if (ma.tag === 'Right') {
    return { tag: 'Right', right: f(ma.right) };
  }
  return ma as Either<unknown, B>;
};

// ---------- Monad Operations ----------

/**
 * Apply a function that returns a monad to a monadic value
 */
export const maybeChain = <A, B>(ma: Maybe<A>, f: (a: A) => Maybe<B>): Maybe<B> => {
  if (ma.tag === 'Just') {
    return f(ma.value);
  }
  return { tag: 'Nothing' };
};

/**
 * Apply a function that returns Either to an Either value
 */
export const eitherChain = <A, B>(ma: Either<unknown, A>, f: (a: A) => Either<unknown, B>): Either<unknown, B> => {
  if (ma.tag === 'Right') {
    return f(ma.right);
  }
  return ma as Either<unknown, B>;
};

// ---------- Utility Functions ----------

/**
 * Create a constant function that always returns the same value
 */
export const constant = <A, B>(value: A): ((b: B) => A) => {
  return () => value;
};

/**
 * Flip the order of arguments of a function
 */
export const flip = <A, B, C>(f: (a: A) => (b: B) => C) => (b: B) => (a: A) => f(a)(b);

/**
 * Curry a binary function
 */
export const curry = <A, B, C>(f: (a: A, b: B) => C) => (a: A) => (b: B) => f(a, b);

/**
 * Uncurry a curried function
 */
export const uncurry = <A, B, C>(f: (a: A) => (b: B) => C) => (a: A, b: B) => f(a)(b);
