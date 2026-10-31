# Structural self-optimization of an exact finite synthesizer

Research note and artifact. Authors and venue unset. This follow-up distinguishes
program correctness, useful organization of search, and improvement of the
procedure that produces those changes. Results are reported in `results/analysis.json`.
No claim of unrestricted recursive self-improvement or algorithmic novelty is made.

## Question

Can outcome feedback synthesize an executable search organization that transfers
beyond its development workloads? The earlier FX study selected an existing fixed
hybrid in all three runs. Here the grammar can generate conditional programs over
structurally different joins, including reversing which half-program is enumerated.

## Search structures and correctness

For a complete target table t and two semantic banks P and S, the synthesis relation
is s(p(x)) = t(x) for every input x. Both banks here enumerate unique functions of
words of length at most d, retaining a shortest representative. The full word is
bounded by 2d. Target-generating words are hidden from candidate plans.

The inverse join fixes s and intersects unions of prefixes with p(x) in the inverse
fiber of t(x). The forward join instead fixes p, then intersects suffix sets with
s(p(x)) = t(x). If p(x1) = p(x2) but t(x1) != t(x2), no compatible suffix exists.
Otherwise repeated intermediate coordinates can be collapsed without changing the
accepted set. A bijective prefix permits a hash lookup for t composed with its
inverse; a bijective suffix similarly permits inverse lookup for the prefix.

There are six authored native kernels: pairwise, inverse hash, inverse-fiber
bitsets, forward bitsets, deduplicated forward constraints, and a forward hybrid.
Generated programs contain kernel leaves and bounded conditional nodes. Conditions
use bank size, state count, number of queries, bijective-bank fraction, mean bank
rank and mean target rank. The grammar's maximum branch depth is three. Features,
metadata, hashes and bitsets are created lazily within the timed execution.
The learner can compose these structures but cannot invent arbitrary native code.
Every new kernel is also a fixed baseline; manual kernel engineering cannot be
credited to learned discovery.

All native outputs are checked on the complete finite domain outside the timed
region. An independent Python oracle enumerates every possible pair in Boolean
and randomized ternary banks, including impossible targets. Eight fixed/expert
programs and 80 generated trees produce 59,136 oracle comparisons. A separate FX
verifier replays the words underlying measured native answers through the public
certificate API, using actual primitive tables rather than the native indexes.

## Experimental design

Protocol and evaluator source were published before selection at
`f3fe58a749f90a5a96adb46e15c8bdaee89cd2fb`. All selected programs, source hashes,
procedure choice and fresh winners were sealed before either final test at
`ba8fcb15dfc8b1db2a7007ff384f7bfaf1d3b7e9`.

Training covers three operation families, three seeds each, 32 states, five
primitives and half-depth three. Validation changes seeds, uses 64 states and six
primitives, and retains half-depth three. Final testing adds two held-out-from-
selection families and new seeds, with half-depth five. A second final corpus
uses different seeds for the paired improver study. Both final corpora have 20
domains and request six novel targets each. Queries already in the half-bank are
excluded. Half the requested goals come from random words; the remainder are
sampled distinct functions from 2000 random half-bank pairs. This increases
semantic diversity but does not uniformly enumerate every reachable function.
Shortfalls are retained, never replaced.

Five independent search seeds compare fitness-guided mutation with independently
sampled random trees. Both receive the same eight initial fixed/expert programs,
48-evaluation ceiling and eight seconds of measured native-kernel CPU ceiling.
The best four training programs receive separate validation. The primary search
seed is 5101. A saved-programs-only control selects only among the initial library;
its winner is also the strongest validation-selected fixed/expert baseline.

The outer experiment selects among three authored mutation distributions. Each
is assessed through five inner searches with 16-candidate ceilings using only
training and validation. After freezing the selected procedure, original and
selected procedures each perform five searches from identical initial libraries
on fresh training/validation seeds. Their winners are evaluated on the second
untouched final corpus. This is bounded procedure selection; it is not a system
writing an unrestricted new improver.

The primary objective is cold native CPU cost: one fresh context, only the lazy
features/indexes actually requested by a program, a full query batch, and context
destruction. Common Python semantic-bank construction is added equally in the
reported aggregate costs. Seven final repeats use randomized program order.
Identical ASTs share measurements. Ratios are paired by domain; 20,000 domain
bootstrap resamples give conditional 95% intervals. Timing repeats are not
independent discovery runs. This is one host and a fixed compiler configuration.

## Evidence retained

`selection.json.gz` contains every candidate, per-domain training times, chosen
programs, outer procedure selection and full-phase child CPU/wall costs.
`heldout.json.gz` contains complete final tasks, operation tables, bank words,
all measured native answers, chosen kernels and raw timings. `coverage.json`
records whether test-time leaves were ever exercised during training.
`fx-verification.json` records independent certificate replay. Analysis and
human-readable findings are separate from the raw records.

The application-derived check calls actual FX `getMemory` functions to construct
finite transition tables for retention filters. Its adapter explicitly makes the
filtered output the next step's memory. Over every subset of six fixed synthetic
entries, FX synthesizes twelve previously unbanked pipelines and confirms their
outputs by 768 replays through the real API. This establishes finite-model
composition with application code. It uses no production traces and measures no
production speedup. It is separate from the synthetic plan-learning experiment.

## Results

The primary hypothesis fails. The preselected primary run selects the pairwise
leaf, identical to the validation-selected saved/fixed control: 1.00× by identity.
It is indistinguishable from its paired random control, 0.999× [0.990, 1.007],
and approximately 3.60× slower than the predeclared expert dispatch on the larger
final tasks. Validation ranks the expert dispatch roughly nine times slower than
pairwise under its native cold objective; the final ranking reverses. This is
evidence that this small-bank selection criterion does not transfer, not a causal
demonstration that any particular curriculum change would fix it.

| Search seed | Evolved speedup vs saved/fixed control | Vs paired random control |
| --- | --- | --- |
| 5101 (primary) | 1.000× | 0.999× |
| 5107 | 1.001× | 0.250× |
| 5113 | 1.000× | 1.000× |
| 5119 | 1.012× | 1.009× |
| 5147 | 4.422× | 4.417× |

The apparent 4.42× secondary success is not credited to feedback-driven learning.
That program selects a previously unexercised leaf in twelve final domains. Its
bank-size condition was never false on the training cases; the fast branch was
carried through selection without performance feedback on that path. It is also
slower than the strongest tested fixed kernel. Reporting this seed alone would
misrepresent the five-run evidence.

Procedure selection chooses the third authored mutation distribution, whose
five fresh searches give aggregate 0.813× speedup [0.513, 1.171] relative to the
original. The point estimate favors the original; the interval crosses parity.
The interval independently resamples five discovery seeds and twenty shared
final domains. This supplies no reliable improvement-procedure evidence.

The manually supplied forward deduplicated kernel is nevertheless useful: it is
9.08× [4.50, 17.56] faster than pairwise and 3.11× [2.42, 4.03] faster than the
inverse-fiber hybrid on the primary final corpus, including common bank costs.
Both were declared controls before final testing. These are descriptive kernel
comparisons on synthetic workloads, not algorithmic novelty or learned discovery.

There are 120 primary and 116 second-test tasks. One second-test domain,
`affine:7019`, yields two of six requested goals and is retained. Native checking
and the independent FX replay validate all 24,808 measured answers; caching
identical certificates reduces this to 275 distinct certificate replays. The
separate application-derived memory check validates twelve tasks through 768
actual FX API replays. None of these correctness results establishes production
performance or generalization beyond the supplied finite models.

## Limitations and interpretation

Cold small-bank optimization may favor scanning even if indexed joins dominate
at larger bank sizes. That distribution shift is deliberately exposed by the
final test, not repaired through post-test tuning. A final branch never visited
during learning is extrapolation; its behavior cannot be attributed to feedback
without additional controlled evidence.

The proposal and measured-kernel ceilings match across controls, but complete
end-to-end discovery CPU is not matched exactly. Full selection child CPU/wall
costs are retained, including compilation, startup and verification; per-search
total CPU was not instrumented. Consequently this experiment cannot establish
superiority under exactly matched total discovery cost, nor a per-run full-cost
break-even. This is a protocol limitation rather than a cost silently omitted
from a successful claim.

The grammar, kernels, features, mutation distributions and data generators are
human-authored. Synthesizing a new AST does not establish a new general algorithm.
Correctness is exhaustive only within complete deterministic finite models.
Meta-selection among three existing procedures does not establish unrestricted
recursive improvement. A broader claim needs changes beyond this grammar,
independent replications and application-derived performance workloads.
