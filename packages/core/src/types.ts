/**
 * Fx - Type System
 * Clean, predictable types without complex generics or recursion
 */

// No imports needed for basic types

// ---------- Core Types ----------

/**
 * Base context type - simple, extensible record
 */
export interface BaseContext {
  readonly [key: string]: unknown;
}

/**
 * State type - alias for BaseContext
 */
export type State = BaseContext;

/**
 * Step type - Kleisli arrow that transforms state in monadic context
 * This is the fundamental Kleisli arrow: A -> M<B> where M is the Promise monad
 */
export type Step<T extends BaseContext = BaseContext> = (state: T) => Promise<T>;



/**
 * Plan type - named collection of steps
 */
export interface Plan<T extends BaseContext = BaseContext> {
  readonly name: string;
  readonly execute: Step<T>;
}

// ---------- Error Types ----------

export interface FxError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: Date;
}

// ---------- Event Types ----------

export interface Event {
  readonly id: string;
  readonly name: string;
  readonly timestamp: Date;
  readonly data?: unknown;
}

// ---------- Configuration Types ----------

export interface FxConfig {
  readonly enableLogging?: boolean;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ---------- Simple Category Theory Types ----------

/**
 * Maybe type for optional values
 */
export type Maybe<T> = { readonly tag: 'Just'; readonly value: T } | { readonly tag: 'Nothing' };

/**
 * Either type for error handling
 */
export type Either<L, R> = { readonly tag: 'Left'; readonly left: L } | { readonly tag: 'Right'; readonly right: R };

/**
 * Identity type
 */
export type Id<T> = T;

// ---------- Utility Types ----------

/**
 * Path type for state access
 */
export type Path = string;

/**
 * Workflow type - alias for Step
 */
export type Workflow<T extends BaseContext = BaseContext> = Step<T>;

// ---------- Simple Functor Interface ----------

export interface Functor<F> {
  readonly map: <A, B>(fa: F, f: (a: A) => B) => F;
}

// ---------- Simple Monad Interface ----------

export interface Monad<M> extends Functor<M> {
  readonly of: <A>(a: A) => M;
  readonly chain: <A>(ma: M, f: (a: A) => M) => M;
}

// ---------- Kleisli Arrow Type ----------

export type Kleisli<M, A> = (a: A) => M;

// ---------- Natural Transformation Type ----------

export type NaturalTransformation<F, G> = (fa: F) => G;

// ---------- Applicative Interface ----------

export interface Applicative<F> extends Functor<F> {
  readonly of: <A>(a: A) => F;
  readonly ap: (fab: F, fa: F) => F;
}

// ---------- Profunctor Interface ----------

export interface Profunctor<P> {
  readonly dimap: <A, B, C, D>(
    pab: P,
    f: (c: C) => A,
    g: (b: B) => D
  ) => P;
}

// ---------- Context Extension Utility ----------

export type ExtendContext<C extends BaseContext, E extends Record<string, unknown>> = C & E;

// ---------- Task Context Type ----------

export type TaskContext = BaseContext;

// ---------- Kleisli Workflow Type ----------

export type KleisliWorkflow<M, T extends BaseContext = BaseContext> = (state: T) => M;

// ---------- Simple Category Theory Implementations ----------

/**
 * Maybe monad implementation
 */
export const Maybe: Monad<Maybe<unknown>> = {
  map: <A, B>(ma: Maybe<unknown>, f: (a: A) => B): Maybe<unknown> => {
    if (ma.tag === 'Just') {
      return { tag: 'Just', value: f(ma.value as A) };
    }
    return { tag: 'Nothing' };
  },

  of: <A>(a: A): Maybe<unknown> => ({ tag: 'Just', value: a }),

  chain: <A>(ma: Maybe<unknown>, f: (a: A) => Maybe<unknown>): Maybe<unknown> => {
    if (ma.tag === 'Just') {
      return f(ma.value as A);
    }
    return { tag: 'Nothing' };
  }
};

/**
 * Either monad implementation with complete functional interface
 */
export const Either = {
  // Constructors
  left: <L, R>(value: L): Either<L, R> => ({ tag: 'Left', left: value }),
  right: <L, R>(value: R): Either<L, R> => ({ tag: 'Right', right: value }),
  
  // Functor map
  map: <L, A, B>(ma: Either<L, A>, f: (a: A) => B): Either<L, B> => {
    if (ma.tag === 'Right') {
      return { tag: 'Right', right: f(ma.right) };
    }
    return ma;
  },

  // Applicative of
  of: <A>(a: A): Either<never, A> => ({ tag: 'Right', right: a }),

  // Monad chain
  chain: <L, A, B>(ma: Either<L, A>, f: (a: A) => Either<L, B>): Either<L, B> => {
    if (ma.tag === 'Right') {
      return f(ma.right);
    }
    return ma;
  },

  // Fold - essential for pattern matching
  fold: <L, R, T>(
    ma: Either<L, R>,
    onLeft: (left: L) => T,
    onRight: (right: R) => T
  ): T => {
    if (ma.tag === 'Left') {
      return onLeft(ma.left);
    }
    return onRight(ma.right);
  },

  // Utility methods
  isLeft: <L, R>(ma: Either<L, R>): ma is { tag: 'Left'; left: L } => ma.tag === 'Left',
  isRight: <L, R>(ma: Either<L, R>): ma is { tag: 'Right'; right: R } => ma.tag === 'Right',
  
  // Get value or throw (use with caution)
  getOrElse: <L, R>(ma: Either<L, R>, defaultValue: R): R => {
    if (ma.tag === 'Right') {
      return ma.right;
    }
    return defaultValue;
  },

  // Get value or throw error
  getOrThrow: <L, R>(ma: Either<L, R>): R => {
    if (ma.tag === 'Right') {
      return ma.right;
    }
    throw new Error(`Either.getOrThrow called on Left: ${ma.left}`);
  },

  // Map over left side
  mapLeft: <L1, L2, R>(ma: Either<L1, R>, f: (left: L1) => L2): Either<L2, R> => {
    if (ma.tag === 'Left') {
      return { tag: 'Left', left: f(ma.left) };
    }
    return ma;
  },

  // Swap left and right
  swap: <L, R>(ma: Either<L, R>): Either<R, L> => {
    if (ma.tag === 'Left') {
      return { tag: 'Right', right: ma.left };
    }
    return { tag: 'Left', left: ma.right };
  },

  // Helper for common state transformation patterns
  foldState: <T extends BaseContext, L, R>(
    either: Either<L, R>,
    onError: (error: L) => (state: T) => T,
    onSuccess: (value: R) => (state: T) => T
  ) => {
    return (state: T): T => {
      return Either.fold(
        either,
        (error) => onError(error)(state),
        (value) => onSuccess(value)(state)
      ) as T;
    };
  }
};

/**
 * Identity functor implementation
 */
export const Identity: Functor<unknown> = {
  map: <A, B>(fa: unknown, f: (a: A) => B): unknown => f(fa as A)
};