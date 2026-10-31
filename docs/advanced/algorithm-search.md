# Algorithm search for FX and Beetle

This extension searches executable **control flow**: loops, scan direction,
conditions, early exits and indexes. It complements the numeric program and
abstraction experiments; it does not require an LLM or coding agent to run.

```sh
npm ci
npm run algorithm:search -- --target fx-memory
npm run algorithm:search -- --target beetle-routes
npm run algorithm:search -- --target all --out ./algorithm-results
```

The output directory receives a report and a runnable `.algorithm.json` winner
for each accepted target. A rejected final result sets a nonzero CLI exit code
and writes `null` to the algorithm file, replacing any stale export. The report
retains the failed candidate. No production file, route, authorization, deployment or active
policy is changed. Search results must be inspected before integration.

## Included targets

| Target | Correctness source | Structures searched |
| --- | --- | --- |
| `fx-memory` | The actual `getMemory` implementation in `src/memory.ts` | Predicate ordering, full forward scan, guarded reverse scan with early exit, plus intentionally incorrect variants |
| `beetle-routes` | A synthetic reference model of nearest-address / first-converse selection over a fixed batch | Repeated scans, bucket indexes, precomputed reader indexes, preference and address-order variants |

### FX memory filtering

Each input contains JSON-normalized memory `entries` and a `filter` with explicit
nullable `type`, `since`, `search` and `limit` fields. Entry timestamps are finite
millisecond numbers. The oracle reconstructs Dates, calls the real FX
`getMemory`, and normalizes the complete resulting entries back to JSON.

The candidate must preserve case-insensitive search, type and date filtering,
array order and every entry field. Cases cover empty results, missing/zero limits,
negative and fractional limits, large limits and nonchronological entry arrays.
For a positive integer limit, scanning from the end can stop after enough matches,
then reverse the matches to preserve output order. Other limits need a compatible
fallback. Incorrect early exits and incorrect output order are rejected.

This is a real-function correctness target. Its cost baseline is an authored
forward-scan **IR implementation**, not timing of the native function. Interpreter
speedup must not be represented as a TypeScript performance gain.

### Beetle batch route readers

For each ordered address query, choose the nearest address with any routes. Within
that level return its first converse reader, otherwise its first route, otherwise
null. Keep all route fields and query order. The batch reads one immutable route
snapshot, allowing index construction to be amortized over queries.

The target tests algorithmic selection only. It does not model author authority,
audience visibility, journal recovery, subscription mutation or the rest of the
live router. Its oracle is a small reference port of the selection contract;
**native Rust conformance is still required** before a Beetle implementation.
All fixtures are synthetic and contain no private Slack or organizational data.

## A bounded language instead of arbitrary source execution

An `Algorithm` is serializable JSON with:

- JSON literals, variables, own-property reads and fixed intrinsics;
- assignment, conditionals, forward/reverse `for` loops, `break` and `return`;
- local arrays, append operations, and local string-keyed indexes;
- scalar comparisons, arithmetic, string filtering and array operations.

There is no `eval`, source import, native callback, clock, randomness or ambient
I/O in the candidate language. Loop bounds are snapshotted before iteration.
Inputs are isolated immutable JSON; local indexes cannot escape as output.
Syntax depth/size, interpreted steps and allocated cells are bounded. Costs for
collection/string intrinsics scale with their inputs; index build cost is charged.

The cell/step model is not an exact CPU or byte-memory limit. Parsing, JSON
serialization, oracle setup and host proposer work are outside the interpreted
step count. Proposers, references and integration adapters are trusted host code.
Do not execute externally generated JavaScript just because the IR interpreter
is bounded. A future source-code runner needs its own actual isolation boundary.

## Acceptance protocol

`searchAlgorithms(target, proposer, options)`:

1. Copies fixed training, validation and held-out cases; rejects duplicate inputs.
2. Obtains expected results from the independent reference, outside candidate code.
3. Tests the baseline and proposed candidates against training cases.
4. Gives the proposer only the contract and immutable training feedback.
5. Selects a fixed shortlist plus the baseline fallback and checks validation cases.
6. Chooses by validation work count, then tests that winner once on held-out cases.

A held-out failure sets `accepted: false`; it never triggers reselection. Incorrect
or over-budget candidates cannot win. A correct baseline remains an explicit
fallback. The archive records failed candidates and their work as well as winners.
The total step cap includes baseline, candidate, validation and final executions.
Exhausting that cap can abort the experiment rather than silently dropping checks.

Results are correctness evidence on finite cases, not a proof for all inputs.
Native timing, production distributions and effect-boundary conformance remain
separate verification steps.

## Proposers and additional targets

The built-in targets use authored structural grammars. Search discovers the best
candidate **within those grammars**; it does not establish invention of a globally
new algorithm. A model can propose a wider set of JSON algorithms through the
same interface, without gaining access to held-out cases or changing the evaluator.

```ts
const report = await searchAlgorithms(target, async context => {
  // Supply an enumerator, a structural mutator, or a model adapter here.
  // context contains { iteration, target: { id, contract }, archive }.
  // Return { name, algorithm }, or undefined to finish.
  return myProposer(context);
}, { maxProposals: 64, maxSteps: 1_000_000, maxTotalSteps: 30_000_000 });
```

To evaluate JSON generated by a coding agent or another process:

```sh
npm run algorithm:search -- --target fx-memory --proposals ./candidates.json
```

The file is an array of `{ "name": "candidate", "algorithm": { "version": 1,
"body": [...] } }` records. It is parsed as data, never imported as executable
JavaScript. Register another target by supplying its contract, baseline IR,
reference function and three fixed case splits. A natural-language wish alone
does not establish correctness or a useful optimization objective.

### Optional model-generated search

`createModelAlgorithmProposer(provider, options)` works with FX's existing
`LLMProvider.chat` interface. It supplies the language grammar, input contract,
baseline and bounded training feedback. Invalid responses are retained as
proposer errors; a call cap stops repeated generation. Reported usage includes
provider calls and token counts when supplied by that provider. There is no
monetary cap, and provider-internal retries are outside this call counter.

With an already configured `OPENAI_API_KEY`, the CLI can use the existing FX
chat-completions provider; `OPENAI_BASE_URL` optionally selects a compatible host:

```sh
npm run algorithm:search -- --target fx-memory --model YOUR_CHAT_MODEL --budget 16
```

The model must support the existing provider's chat options. Other providers can
be injected programmatically through `runTarget` or `searchAlgorithms`. This
implementation's provider tests use mocks; the checked-in results use the
deterministic grammar, and no live model run is claimed.

## Use a selected algorithm inside FX

```ts
import { createAgent, createPlan, algorithmStep, JsonValue } from '@fx/core';

type SearchState = { algorithmInput: JsonValue; algorithmResult?: JsonValue };

const agent = createAgent('selected-algorithm', createPlan('plan', [
  algorithmStep<SearchState>(
    report.selected.algorithm,
    state => state.algorithmInput,
    (state, result) => ({ ...state, algorithmResult: result })
  )
]));
```

Supply a typed JSON input adapter appropriate to the target. Memory timestamps
must be normalized and restored by the adapter if the surrounding API uses Dates.
Running through the interpreter may be slower than native code even when the
selected algorithm performs fewer modeled operations. The next deployment gate
is a reviewed native implementation, conformance tests and representative timing.
