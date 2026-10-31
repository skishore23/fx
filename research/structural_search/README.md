# Structural search experiment

This follow-up lets a learner synthesize bounded executable decision trees over
six exact join kernels. Programs change join direction, indexing and conditional
control flow. A fixed independent evaluator verifies every result. This remains
an authored grammar; it is not unrestricted native-code invention.

The protocol was published before selection in commit
`f3fe58a749f90a5a96adb46e15c8bdaee89cd2fb`. All primary and paired-improver winners
were published before either final test in commit
`ba8fcb15dfc8b1db2a7007ff384f7bfaf1d3b7e9`.

## Results

The primary learning hypothesis failed. The selected primary program is exactly
the saved pairwise baseline: 1.00×. It is approximately 3.60× slower than the
predeclared expert dispatch on larger final problems. A secondary seed achieves
4.42× against the saved baseline, but enters a leaf never exercised during
training in twelve final domains. It remains slower than the strongest tested
fixed kernel; this is not evidence of learned algorithm discovery.

| Finding | Result |
| --- | --- |
| Independent FX reconstruction of native outputs | 236 tasks; 24,808 measured answers checked |
| Primary evolved vs equal-evaluation random | 0.999× [0.990, 1.007] |
| Selected vs original improver, five fresh reruns | 0.813× [0.513, 1.171]; no reliable improvement |
| Fixed forward deduplicated vs pairwise | 9.08× [4.50, 17.56] cold CPU speedup |
| Fixed forward deduplicated vs inverse-fiber hybrid | 3.11× [2.42, 4.03] cold CPU speedup |
| Actual FX memory pipeline application check | 12 tasks; 768 complete API replays |

The fixed-kernel comparisons describe **manual algorithm engineering**, not
learner discovery. Intervals are conditional domain-bootstrap intervals; the
improver interval resamples both search seeds and shared final domains. CPU costs
include the requested lazy indexes/features, with common semantic-bank cost
added equally. A second-test domain yields two of six requested sampled goals;
the shortfall is retained. No production-trace or production speedup claim is made.

See [the manuscript](paper.md), `results/analysis.json`, `results/coverage.json`
and the lossless raw archives. Code and evidence have a separate manifest;
`python3 -m research.structural_search.verify_artifact` checks the pre-test seal.

## What is different from the earlier planner experiment?

- Inverse joins enumerate suffixes and union inverse fibers before intersecting
  compatible prefixes. Forward joins enumerate prefixes and directly constrain
  suffix table coordinates. Both enumerate the same bounded composition relation.
- The forward deduplicated kernel rejects contradictory requirements and collapses
  repeated intermediate coordinates. The forward hybrid adds a bijective-prefix
  inverse hash path. All new kernels are also available as fixed controls.
- Generated branch trees select kernels from bank properties and target semantics.
  Feature and index preparation happen lazily inside measured cold executions.
- Five full discovery reruns compete with independently generated random trees,
  a saved-only library and expert dispatch rules.
- A bounded outer experiment selects one of three authored mutation distributions,
  then compares original and selected procedures in five fresh matched-start
  searches. This cannot establish unrestricted recursive self-improvement.

## Verification and reproduction

```sh
npm ci
npm run build
python3 -m pip install -r research/structural_search/requirements.txt
python3 -m unittest research.structural_search.test_engine -v
node research/structural_search/verify-fx.cjs
node research/structural_search/fx-memory.cjs
```

Native verification checks exact Boolean and ternary function banks, including
impossible goals, against an independently enumerated complete oracle. FX replay
checks the actual words underlying native answers through the public certificate
verifier. The memory application builds transition tables by calling actual FX
`getMemory` functions; a retain adapter feeds filtered results into the next step.
It exhausts every subset of six synthetic entries. It is application-derived
code, not production traces or a production performance claim.

To regenerate measurements (overwriting local raw outputs):

```sh
python3 -m research.structural_search.study select
# Freeze selection before proceeding; final refuses changed selected sources.
python3 -m research.structural_search.study final
python3 -m research.structural_search.analyze
python3 -m research.structural_search.coverage
node research/structural_search/verify-fx.cjs --record
node research/structural_search/fx-memory.cjs --record
python3 -m research.structural_search.package_artifact
```

Lossless gzip archives retain the raw candidate histories and final measurements.
Native text inputs are reconstructed from the protocol, operations and semantic
banks; their hashes are retained separately. Timing, source hashes and ASTs are
recorded so findings can be audited rather than inferred from a success summary.

## Interpretation rules

The primary seed and baseline are fixed before final evaluation. Every other
seed, all regressions, sampled-goal shortfalls and costs must be retained. Seven
repeated measurements do not constitute seven independent discovery runs.
Bank construction cost is common and added equally; native cold measurements
already include the lazy indexes/features used by each program.

The search ceilings match evaluation count and measured kernel CPU, not complete
end-to-end discovery CPU. The complete selection phase records child CPU and wall
time, including process startup, compilation and verification. Per-search total
CPU was not instrumented; this limits matched-total-cost and break-even claims.
Synthetic training banks are smaller than final banks. A branch that was never
exercised in training cannot be presented as evidence of learned behavior just
because its previously unseen path happens to work in a final case.
