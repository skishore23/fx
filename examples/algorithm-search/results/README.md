# Initial algorithm-search results

These results use the deterministic, authored structural grammars, not a live
model. The model proposer has mock tests but no paid/provider run is claimed.
Each selected algorithm passes validation and then one fixed held-out split.
The full reports retain rejected candidates, source contracts and split hashes.

| Target | Selected algorithm | Final cases passing | Baseline steps | Selected steps | Baseline loop visits | Selected loop visits |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| FX `getMemory` contract | Guarded reverse scan; search/type/since predicate order | 10 / 10 | 113,056 | 33,578 | 2,909 | 1,138 |
| Beetle-compatible batch route readers | Index each address's first preferred reader, then probe per query | 3 / 3 | 409,613 | 45,615 | 19,971 | 904 |

The step reductions are approximately 70.3% and 88.9% in the explicit cost model.
They are **not native runtime speedups**. Baselines are authored IR implementations
of the contracts, not timings of the original TypeScript or Rust code. Input
copying/parsing and native VM dispatch costs can dominate execution time.

For FX, expected results come from the actual `getMemory` function. Twelve
incorrect candidates are rejected, including variants with broken early exits
or result order. Separate regression tests compare the winner to the real API
on 60 additional generated cases with Unicode search and unusual finite limits.

For Beetle, expected results come from a synthetic reference model of immutable
batch selection. Nine incorrect candidates are rejected. Separate tests exercise
60 additional batches, nearest-address precedence, converse preference, missing
addresses and repeated queries. This is not native Rust conformance and does not
qualify the complete production router or authorization behavior.

Both searches include preprocessing/index work in their cost. An indexed batch
strategy may lose on small batches, and a reverse scan may lose when no early
exit is possible. The aggregate result is not an all-input performance guarantee.
New algorithms are limited by the proposer grammar and language; no global
algorithmic novelty is claimed.

Reproduce:

```sh
npm ci
npm run algorithm:search -- --target all --out ./algorithm-results
npm run test:experiments
```

Use the `.algorithm.json` files with `executeAlgorithm` or `algorithmStep`. Review,
native implementation, native timing and domain conformance are separate gates
before production integration. No active system was modified by these searches.
