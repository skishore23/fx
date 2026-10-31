# Experimental program discovery

For control-flow and indexing algorithm search targeting FX and Beetle, see
[Algorithm search](algorithm-search.md). That extension has a separate bounded
language with loops and branches; the numeric `Program` language below remains unchanged.

FX can now represent a bounded program as JSON, execute it as an ordinary FX
`Step`, search for programs against an external evaluator, and extract
parameterized abstractions from a successful program corpus. This is an
experimental research kernel, not a general self-improving agent.

No model, API key, coding agent, new dependency or production integration is
required for the included experiments. Node 18+ is required for the example
test runner (CI uses Node 20); the library remains compatible with the existing
package's target.

## Run it

From the repository root:

```sh
npm ci
npm run test:experiments
npm run experiment:transfer
npm run experiment:scheduling
```

The experiment commands build the package and print JSON. To save JSON without
build logs, build first and run the example directly:

```sh
npm run build
node examples/discovery/transfer.cjs > transfer.json
node examples/discovery/scheduling-discovery.cjs > scheduling.json
```

## Programs are data

```ts
import { createAgent, createPlan } from '@fx/core';
import { ProgramRuntime, Program, Abstraction } from '@fx/core/discovery';

type Counter = { readonly value: number };
const affine: Abstraction = {
  name: 'affine', arity: 2,
  body: [
    { op: 'add', args: [{ parameter: 0 }] },
    { op: 'scale', args: [{ parameter: 1 }] }
  ]
};
const runtime = new ProgramRuntime<Counter>([
  { name: 'add', arity: 1,
    execute: (state, args) => ({ value: state.value + args[0]! }) },
  { name: 'scale', arity: 1,
    execute: (state, args) => ({ value: state.value * args[0]! }) }
], [affine]);
const program: Program = {
  version: 1, body: [{ op: 'affine', args: [3, 2] }]
};

runtime.expand(program); // add(3), scale(2)
runtime.run(program, { value: 4 }); // { state: { value: 14 }, primitiveCalls: 2 }
const agent = createAgent('discovered', createPlan('plan', [runtime.asStep(program)]));
await agent.start({ value: 4 }); // { value: 14 }
```

Version 1 has sequential calls, finite numeric arguments, and parameterized
abstractions. It deliberately has no arbitrary source evaluation, branches,
loops, general expression language or dynamic creation of native primitives.
It is possible to build other domains by registering trusted primitives.

The runtime validates the whole expanded program before executing a primitive.
Unknown names, incorrect arity, unbound parameters, recursive definitions,
excessive call depth and expanded operation overruns fail before execution.
Defaults: 1,024 expanded primitive calls, 32 abstraction levels, 128 instructions
per serialized body, 16 arguments per call.

States are isolated, deeply frozen JSON snapshots. Non-finite results,
non-JSON values and cycles are rejected. Primitives must be trusted synchronous
functions: the runtime cannot stop their JavaScript from accessing global state,
performing I/O or failing to return. Resource counts bound interpreted operations,
not CPU time or native memory. They are not a security sandbox or proof of purity.

## Abstraction learning

`learnAbstractions(successfulPrograms)`:

1. Deduplicates closed, expanded programs by canonical content hash.
2. Finds repeated contiguous operation structures.
3. Replaces varying literal columns with parameters. Columns that vary together
   share a parameter; fixed constants remain constants.
4. Counts non-overlapping structural replacements.
5. Keeps candidates with positive description-length savings, charging both
   call sites and the new definition (including its parameters).

Each result includes the definition, source program hashes, occurrence count,
compression gain and witnessed argument tuples. Results are independently scored
candidates, not an optimally selected joint library. The current miner is a
bounded contiguous-pattern learner, not Stitch or an e-graph implementation.

`abstractProgram` factors a program without changing its expansion.
`abstractionActions` constructs calls for witnessed argument tuples only.
A caller can supply new tuples after validating them. Structural compression
does not establish utility, semantic novelty, behavioral generalization or
authority to activate a policy. The caller must supply genuinely successful
programs and independently assess learned candidates.

## Search, evaluation and feedback

`enumeratePrograms(actions, maxLength)` is a deterministic proposer.
`searchProgram(runtime, examples, proposals, budgets)` accepts any iterable of
candidate programs, returns the first exact solution, and retains every attempted
candidate with its identity, outcome and expanded operation cost. Both candidate
and primitive-call budgets apply; failing primitive invocations are charged.
It refuses to start an example whose full expansion cannot fit the remaining
budget. Verification cases are kept outside this search API.

`optimizePrograms(proposals, evaluate, maxEvaluations)` selects the highest-scoring
valid candidate from a bounded proposal stream. `proposals` can also be a callback
`(archive, iteration) => program`, enabling outcome-guided mutations or an external
model adapter. A negative finite score is valid; invalid candidates cannot win.
Programs and scored feedback are frozen. Duplicates consume proposal budget but
are not evaluated twice. The budget counts proposals, not arbitrary computation
inside a trusted proposer or evaluator; domain experiments report that work
separately. The library has no built-in model training or automatic policy activation.

## Experiment 1: abstraction transfer

The initial eight arithmetic tasks are actually solved by primitive enumeration.
The resulting corpus supports an inferred two-parameter `add; scale` abstraction.
Eight distinct four-operation functions are withheld from that corpus. Search
receives three I/O examples per task and selected programs are checked against
five additional inputs, including a fractional and negative input.

Three arms receive the same per-task budgets (256 proposals, 1,024 primitive
calls, at most four symbolic instructions):

- Primitive operations only.
- The same operations plus eight saved, opaque training programs.
- The same operations plus calls to the learned parameterized abstraction.

Every macro expansion is checked to use the original primitive action vocabulary.
Learning costs are reported separately. The designed experiment currently gives
0/8, 8/8 and 8/8 solved tasks respectively. This demonstrates bounded search reuse
and correct factoring; it **does not demonstrate an advantage over saved snippets**.
Vocabulary order and the symbolic search horizon affect the result. A stronger
next experiment must show useful new bindings or structures beyond that baseline.

## Experiment 2: GPU scheduling policy discovery

The discrete-event simulator models arrivals, heterogeneous worker speeds,
memory eligibility, per-tick prices, deadlines, and persistent model caches
with a four-tick reload cost. One job occupies one worker slot. Every run checks
for lost or duplicated jobs. Tests independently check overlapping assignments,
memory constraints, arrival ordering and a manually calculated timing/cost witness.

A policy scores eligible job/worker pairs using a program over duration, estimated
cost, waiting time, remaining deadline slack and model-load cost. Policies are
linear weighted feature combinations. They cannot change simulator physics or
the external evaluator. The authored objective, minimized, is:

```text
mean flow time + 0.25 * mean tardiness + 0.08 * total monetary cost
```

The adaptive proposer mutates high-scoring programs from its archive. A separate
random-search control uses the same proposal budget, initial baseline policies
and vocabulary. Both use six training scenarios, then select from a fixed
shortlist on four different validation scenarios. Final evaluation uses twelve
untouched workloads across mixed, burst, long-job and many-model regimes.

Reports retain all six authored heuristics (FIFO, shortest duration, earliest
deadline, locality, cheapest placement and a cost/locality hybrid), the random
control, discovered programs, per-regime results and primitive-call costs.
Do not interpret the best aggregate as winning every metric or workload.
There are no production traces, native conformance tests, network failures,
retries, cancellations or confidence intervals. This experiment demonstrates
evaluator-guided policy search, not abstraction transfer or a production scheduler.

## Next research gates

- Parameterized libraries must outperform saved snippets and a strong program
  search baseline under matched discovery costs on unseen task structures.
- Adding library candidates must improve future search more than their discovery,
  validation, storage and vocabulary-expansion costs.
- Scheduling gains must survive multiple search seeds, stronger optimization
  baselines, new workload distributions and production-trace simulation.
- Effect contracts and semantics-preserving rewrites require explicit semantics;
  the existing `Context -> Context` type does not establish either property.

These gates are experiments to run, not capabilities claimed by this version.
