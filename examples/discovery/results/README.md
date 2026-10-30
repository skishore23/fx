# Initial reproducible results

These are synthetic experiments, not production performance claims. The manifest
records the base revision, exact source/output hashes, Node version and local
check results. Both JSON files can be regenerated from the documented commands
without a model or API key. Runtime and discovery costs are not interchangeable.

## Abstraction transfer

| Method | Verified held-out tasks solved |
| --- | ---: |
| Primitive-only enumeration | 0 / 8 |
| Enumeration with saved training programs | 8 / 8 |
| Enumeration with learned parameterized abstraction | 8 / 8 |

All methods have the same per-task candidate and primitive-call caps. The initial
corpus itself costs 172 candidate trials and 341 primitive calls to discover.
The abstraction has two parameters, eight source programs, and one node of net
description-length savings after its definition is charged.

The positive result is exact factoring and reuse on unseen compositions. The
important negative result is that parameterized learning does not beat saved
snippets in this experiment. It establishes no advantage over a strong coding
agent, no new primitive semantics, and no general intelligence claim.

## Scheduling

One search seed (42), 100 proposals per search method, six training workloads,
four validation workloads, and twelve final workloads across four regimes.
Lower objective is better. Time and price are synthetic units.

| Method | Objective | Mean flow time | Mean tardiness | Mean workload cost |
| --- | ---: | ---: | ---: | ---: |
| FIFO | 100.5154 | 46.6910 | 31.4097 | 574.6500 |
| Shortest duration | 76.6566 | 31.8576 | 19.0625 | 500.4167 |
| Earliest deadline | 112.7492 | 53.9653 | 37.9410 | 616.2333 |
| Model locality | 82.0757 | 37.2118 | 23.2743 | 488.0667 |
| Cheapest placement | 78.1788 | 32.8194 | 19.8160 | 505.0667 |
| Authored cost/locality hybrid | 77.0728 | 32.5278 | 19.3854 | 496.2333 |
| Random search + validation | 77.0728 | 32.5278 | 19.3854 | 496.2333 |
| Adaptive search + validation | 76.3691 | 32.5208 | 19.4306 | 487.3833 |

The selected adaptive policy scores placements as `-4 * setup - cost`. Its
aggregate weighted objective is slightly better than the included baselines.
It has worse flow time and tardiness than shortest-duration scheduling, loses
in some regimes, and executes two scoring primitives per placement comparison.
The random control selects the authored hybrid. Training and validation costs,
as well as per-regime final results, remain in scheduling.json.

The policy grammar expresses linear feature combinations. This is evidence of
working evaluator feedback and policy selection, not discovery of an arbitrary
new scheduling algorithm. Multiple search seeds, stronger optimization baselines
and trace-driven workloads are required before claiming a useful scheduling gain.
