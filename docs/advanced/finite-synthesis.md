# Exact finite composition search

FX can synthesize a sequence of operations from their complete finite transition
tables. This is useful for small protocol models, abstract recovery workflows,
bit transformations, and deterministic simulation controllers. Operations may
merge states: they do not have to be invertible. Search and verification use data
tables and never invoke the live operations.

```ts
import { synthesizeFiniteComposition, verifyFiniteCertificate } from '@fx/core/discovery';

const problem = {
  states: 5,
  operations: [
    { name: 'advance', table: [1, 2, 3, 4, 0] },
    { name: 'merge', table: [0, 1, 2, 3, 0] },
  ],
  target: [0, 0, 0, 0, 0],
};
const result = synthesizeFiniteComposition(problem, { maxLength: 16 });
if (result.status === 'solved' && verifyFiniteCertificate(problem, result.certificate)) {
  console.log(result.certificate.program.map(i => problem.operations[i]!.name));
}
```

The resulting 16-action sequence resets **every** modeled initial state to state
0. Searching with `maxLength: 15` returns `unsatisfiable`. This is a known Černý
automaton used as a reproducible correctness example, not a new mathematical result.

`synthesizeFiniteComposition` returns one of three distinct statuses:

| Status | Meaning |
| --- | --- |
| `solved` | Complete replay verified the certificate on every modeled state. |
| `unsatisfiable` | No word within `maxLength` implements the complete target table. |
| `budget_exhausted` | Work or semantic-bank capacity ran out; impossibility is unknown. |

Search uses BFS semantic deduplication and an exact meet-in-the-middle join.
Bijective suffixes use inverse hash lookup. For a non-invertible suffix, bitsets
intersect the prefixes compatible with each target output's full inverse image.
High-entropy coordinates are tried first; small survivor sets get full replay.
An independent verifier recomputes the whole word without those indexes. Certificates
bind the complete problem through SHA-256 and contain immutable JSON data.

Defaults are `maxLength: 6`, `maxBank: 2048`, `maxWork: 10000000`,
`strategy: 'inverse-fibers'`, `verifyAt: 4`. The alternate `pairwise` strategy
provides an exact control. Hard input bounds are 256 states, 64 operations,
64 actions per program, and 16384 semantic bank rows. `maxWork` charges table
cells and join constraints; it is not a millisecond deadline. A synchronous call
can occupy its thread within these bounds; use a worker for interactive workloads.

Correctness applies to the supplied finite model. A certificate does not establish
that the model covers a production bot's actual state, timeouts, external effects,
or nondeterminism. Beetle integration requires a faithful transition model and a
separate application adapter. This API does not run generated recovery actions.

Run the retained study with `npm run research:verify`. See
[`research/exact_join/README.md`](../../research/exact_join/README.md) for measured
results, full protocols, negative findings, and the research manuscript draft.
