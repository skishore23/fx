/**
 * @fx/navigator - Types
 * Autonomous runtime types that extend core functionality
 */

import { BaseContext, Step, PersistenceIO } from '@fx/core';

// ---------- Core Types ----------

/**
 * Guard function - determines if a step should run
 */
export type Guard<TCtx> = (ctx: TCtx) => boolean;

/**
 * Step definition with guard and execution
 */
export interface FxStep<TCtx extends BaseContext> {
  readonly name: string;
  readonly guard: Guard<TCtx>;
  readonly run: Step<TCtx>;
  readonly idempotentKey?: (ctx: TCtx) => string;
  readonly projection?: (ctx: TCtx) => unknown;
}

/**
 * Execution plan view
 */
export interface PlanView {
  readonly layers: string[][];
  readonly blocked: Record<string, string>;
}

/**
 * Run options
 */
export interface RunOpts<TCtx> {
  readonly maxIterations?: number;
  readonly goal?: (ctx: TCtx) => boolean;
  readonly onStep?: (stepName: string, ctx: TCtx) => void;
}

/**
 * Run result
 */
export interface RunResult<TCtx> {
  readonly ctx: TCtx;
  readonly plan: PlanView;
  readonly success: boolean;
  readonly error?: string;
  readonly duration: number;
}


/**
 * Agent interface - functional composition with durable execution
 */
export interface Agent<TCtx extends BaseContext> {
  run: (ctx: TCtx, opts?: RunOpts<TCtx>) => Promise<RunResult<TCtx>>;
  plan: (ctx: TCtx) => Promise<PlanView>;
  react: (cfg: { 
    decide: (ctx: TCtx) => Promise<string>; 
    goal: (ctx: TCtx) => boolean; 
    maxIters?: number 
  }) => Agent<TCtx>;
  policy: {
    retry: (name: string, cfg: { 
      times: number; 
      backoff?: "lin" | "exp"; 
      startMs?: number 
    }) => void;
    timeout: (msPerStep?: number) => void;
    independent: (a: string[] | Guard<TCtx>, b: string[] | Guard<TCtx>) => void;
    compact: (selector: keyof TCtx | ((ctx: TCtx) => boolean), fn: (ctx: TCtx) => TCtx) => void;
    approval: (name: string, cfg: { 
      via: "callback" | "webhook"; 
      meta?: Record<string, unknown>
    }) => void;
    pauseIf: (pred: (ctx: TCtx) => boolean) => void;
  };
  persist: (io: PersistenceIO<TCtx>) => Agent<TCtx>;
}

/**
 * Policy configuration types
 */
export interface RetryConfig {
  readonly times: number;
  readonly backoff?: "lin" | "exp";
  readonly startMs?: number;
}

export interface TimeoutConfig {
  readonly msPerStep?: number;
}

export interface IndependentConfig<TCtx extends BaseContext> {
  readonly a: string[] | Guard<TCtx>;
  readonly b: string[] | Guard<TCtx>;
}

export interface CompactConfig<TCtx extends BaseContext> {
  readonly selector: keyof TCtx | ((ctx: TCtx) => boolean);
  readonly fn: (ctx: TCtx) => TCtx;
}

export interface ApprovalConfig {
  readonly via: "callback" | "webhook";
  readonly meta?: Record<string, unknown>;
}

export interface PauseConfig<TCtx extends BaseContext> {
  readonly pred: (ctx: TCtx) => boolean;
}


export interface ReactConfig<TCtx> {
  readonly decide: (ctx: TCtx) => Promise<string>;
  readonly goal: (ctx: TCtx) => boolean;
  readonly maxIters?: number;
}
