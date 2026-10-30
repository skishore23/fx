import { z } from 'zod';
import type { LLMOptions, LLMProvider } from '../llm';
import { AlgorithmProposer, AlgorithmTrial } from './algorithm-search';
import { positiveInteger } from './model';

export interface ModelAlgorithmOptions {
  readonly model?: string;
  readonly maxCalls?: number;
  readonly maxResponseChars?: number;
  readonly maxFeedbackChars?: number;
  readonly maxTokens?: number;
}
export interface ModelAlgorithmUsage {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

const grammar = `Return only JSON: {"name":"short-name","algorithm":{"version":1,"body":[statements]}}.
Expressions:
{"kind":"literal","value":JSON}, {"kind":"variable","name":"x"},
{"kind":"get","object":expression,"key":expression},
{"kind":"call","op":intrinsic,"args":[expressions]}.
Intrinsics: eq,gt,gte,lt,add,sub,neg,floor,and,or,not,length,lower,contains,slice,reverse,array,map,has,lookup,indexOf.
array/map take 0 args; neg/floor/not/length/lower/reverse take 1; all others take 2.
and/or short-circuit. eq supports scalars and null checks, not object equality.
slice(array,start) uses JavaScript slice semantics. map creates a local string-keyed index.
Statements:
{"kind":"set","name":"x","value":expression},
{"kind":"append","name":"array-variable","value":expression},
{"kind":"put","name":"map-variable","key":expression,"value":expression},
{"kind":"if","condition":expression,"then":[statements],"otherwise":[statements]},
{"kind":"for","name":"item","values":expression,"direction":"forward","body":[statements]} (direction may also be "reverse"),
{"kind":"break"}, {"kind":"return","value":expression}.
input is a read-only variable holding the target input. No native source, functions, imports or I/O.
Preserve the contract on all inputs; optimize work without hardcoding examples.
Loops have snapshotted bounds; arrays from input are immutable; create local arrays/indexes as needed.
Feedback contains training results only. Validation and final cases are unavailable.`;
const response = z.object({ name: z.string().min(1).max(120), algorithm: z.unknown() }).strict();

/** Uses FX's existing provider interface; tests can supply a mock without credentials. */
export function createModelAlgorithmProposer(
  provider: Pick<LLMProvider, 'chat'>,
  options: ModelAlgorithmOptions = {},
): AlgorithmProposer & { readonly usage: () => ModelAlgorithmUsage } {
  const maxCalls = positiveInteger(options.maxCalls ?? 16, 'maxCalls', 10_000);
  const maxResponseChars = positiveInteger(
    options.maxResponseChars ?? 100_000,
    'maxResponseChars',
    1_000_000,
  );
  const maxFeedbackChars = positiveInteger(
    options.maxFeedbackChars ?? 24_000,
    'maxFeedbackChars',
    1_000_000,
  );
  const maxTokens = positiveInteger(options.maxTokens ?? 4096, 'maxTokens', 100_000);
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const propose: AlgorithmProposer = async (context) => {
    if (calls >= maxCalls) return undefined;
    const best = context.archive
      .filter((trial) => trial.training?.passed === trial.training?.total && trial.training)
      .sort((a, b) => a.training!.steps - b.training!.steps)[0];
    const feedback: AlgorithmTrial[] = [];
    const ordered = [best, ...context.archive.slice(-3)].filter((trial): trial is AlgorithmTrial =>
      Boolean(trial),
    );
    for (const trial of ordered) {
      if (feedback.includes(trial)) continue;
      if (JSON.stringify([...feedback, trial]).length <= maxFeedbackChars) feedback.push(trial);
    }
    const request: LLMOptions = {
      ...(options.model ? { model: options.model } : {}),
      temperature: 0.4,
      maxTokens,
    };
    calls++;
    const result = await provider.chat(
      [
        { role: 'system', content: grammar },
        {
          role: 'user',
          content: JSON.stringify({
            target: context.target,
            iteration: context.iteration,
            feedback,
          }),
        },
      ],
      request,
    );
    promptTokens += result.usage?.promptTokens ?? 0;
    completionTokens += result.usage?.completionTokens ?? 0;
    if (result.content.length > maxResponseChars)
      throw new Error('Model response exceeds character limit');
    const parsed = response.parse(JSON.parse(result.content));
    if (!Object.prototype.hasOwnProperty.call(parsed, 'algorithm'))
      throw new Error('Model response is missing algorithm');
    return { name: parsed.name, algorithm: parsed.algorithm };
  };
  return Object.assign(propose, {
    usage: () => Object.freeze({ calls, promptTokens, completionTokens }),
  });
}
