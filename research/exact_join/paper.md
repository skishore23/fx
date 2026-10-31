# Exact Function Joins for Finite-State Synthesis: Native Scaling and the Limits of Planner Search

**Research manuscript draft — 30 October 2026.** Authors and venue are unset.
This is a measured artifact and an initial research note, not a claim of established
algorithmic novelty or a submission-ready moonshot result.

## Abstract

Can an execution framework improve the organization of its own program search?
We investigate this question in a bounded, exactly verifiable setting. Programs
are compositions of opaque deterministic functions over finite states. A semantic
meet-in-the-middle bank supports an exact join that combines inverse hash lookup
for bijective suffixes with inverse-image bitset intersections for irreversible
suffixes. We search an authored planner configuration space using native CPU
feedback, separate validation, and frozen held-out tasks. All three independent
96-candidate searches select an existing hand-designed hybrid: the study provides
no evidence of learned improvement beyond the strongest fixed planner. The fixed
join nevertheless has a measurable systems advantage. An optimized C++ audit
gives a 1.93× geometric warm-query speedup over compiled pairwise search on 320
length-at-most-six tasks. A separately sealed scaling study gives 14.97×
[10.43, 21.87] on 76 length-at-most-ten tasks; charging common bank construction
and the full shared index to hybrid reduces the estimate to 2.75× [1.73, 4.11].
An independent FX TypeScript implementation synthesizes and verifies all 396
tasks. Known synchronizing automata demonstrate universal recovery sequences
with bounded minimality checks. The findings distinguish an effective exact
search implementation from the stronger, currently unsupported claim that the
framework discovered a better search algorithm.

## 1. Research question and scope

The intended long-term system learns useful execution structure from outcomes,
changes its own search procedure, and carries evidence that a proposed change
preserves its contract. A first falsifiable question is narrower: does native
performance feedback find a planner that outperforms strong fixed planners on
independent tasks and different operation families?

The present artifact supplies complete finite semantics, exact verification,
repeated planner search and controlled runtime measurements. It does not run
an LLM or coding agent. Its candidate grammar is authored. This setting makes
correctness decidable within explicit limits but does not establish correctness
for arbitrary agent programs or a deployed Beetle bot.

## 2. Exact inverse-image joining

Let the state set be \(X=\{0,\ldots,N-1\}\). Each primitive is a total function
\(f:X\to X\), represented by its entire table. The target is another complete
table \(t\). A solution is a word of primitive indices whose full semantics equal
\(t\). The generating word is never supplied to the solver.

Breadth-first enumeration builds a bank of semantic functions. Exact table
deduplication preserves the shortest representative. For maximum program length
\(L\), let \(P\) contain words of length at most \(\lfloor L/2\rfloor\), and
\(S\) contain words of length at most \(\lceil L/2\rceil\). The query asks for
\(p\in P,s\in S\) such that \(s\circ p=t\).

For each input coordinate and intermediate value, define the indexed prefix set
\(I_{x,v}=\{p\in P:p(x)=v\}\). For a fixed suffix, the exact compatible set is

\[
C_{s,t}=\bigcap_{x\in X}\;\bigcup_{v\in s^{-1}(t(x))} I_{x,v}.
\]

**Soundness.** A surviving prefix lies in the union at every coordinate, hence
\(s(p(x))=t(x)\) for all \(x\). Complete replay additionally checks every returned
composition independently of the join indexes.

**Bounded completeness.** Every word of length at most \(L\) admits the stated
prefix/suffix split. Replacing either half with its shortest semantic
representative preserves its semantics and cannot increase its length. A valid
prefix is retained by every coordinate constraint. An early switch to full
verification enumerates all remaining prefixes. Thus a completed search finds
a solution whenever one exists within the length bound. Resource exhaustion is
reported separately and never interpreted as impossibility.

If \(s\) is bijective, a hash lookup for \(s^{-1}\circ t\) replaces the intersection.
Otherwise, inverse fibers can contain multiple intermediate values; discarding
this ambiguity would be unsound. The implementation represents prefix sets as
bitsets, orders coordinates by global prefix entropy, and switches to full
table replay when at most four prefixes remain. Rank and image filters, dynamic
minimum-remaining-values ordering, memoization, and probe caps are available to
the planner search. These change cost, not the accepted semantic relation.

## 3. Protocol and implementation

The primary experiment uses three training families: permutations, modular affine
maps and bitvector operations. Four seeds per family give 12 training domains,
32 states, five primitives, and half-depth three. One affine training domain yields
only two sampled eligible targets; the remaining domains have six, giving 68 training
queries. Validation uses three different seeds per family, giving 54 queries.

Final testing uses eight new seeds in each of five families, 64 states, six
primitives and half-depth three: 320 queries across 40 domains. Random high-rank
non-bijective automata and sparse local transitions are excluded from planner
training and validation. Their seed-11 engineering pilots were inspected before
selection, so these families are held out from *the learner*, not unknown to
the researcher. Targets already in the half-bank are excluded in all splits.

Each of three search seeds evaluates 96 planner configurations, including eight
fixed starting planners. Candidate generation mutates successful configurations
with occasional random restarts. The at-most-8640-configuration grammar is
disclosed in `learn.py`; some configurations are behaviorally equivalent.
Training fitness is geometric native CPU cost relative to fixed `hybrid_rank`,
with equal weight per eligible domain and three repeats. The best eight training
candidates are evaluated on validation with seven repeats. Seed 42817 is the
preselected primary run. Validation also chooses the strongest fixed baseline.
No final test feedback enters candidate selection.

Controls include pairwise semantic-bank joining, NumPy joining, inverse hash with
exact pairwise fallback, fixed-coordinate bitsets, entropy bitsets, selectivity
bitsets, dynamic bitsets, hybrid joining and rank-filtered hybrid joining. Solver
outputs are checked outside timed sections on every state. Exhaustive Boolean
banks and randomized ternary banks additionally compare impossible targets with
the independent pairwise oracle. TypeScript tests compare both joins with direct
word enumeration, including odd and even length bounds.

The selected source/protocol/winner hashes were published in commit
`34bc147d5874a45acefcba99d583f62228ededef` before the final run. A later C++17
audit was added after the primary test; it is explicitly supplemental. A new
scaling protocol was sealed in commit
`7f4a6dc9ccd5dee4e4fdde7480044780a7397816` before deeper-domain timings.
This study uses new seeds, 64 states, six primitives, half-depth five and four
queries per domain. Nineteen of twenty domains yield all four requested targets;
the random sampler exhausts its attempts on `affine:2011`, retained with zero
targets. This is sampler exhaustion, not proven semantic saturation. A depth-five semantic
bank reaches 9331 entries; the unconstrained primitive word space at length ten
contains \(6^{10}=60,466,176\) words. Semantic deduplication and indexed joining
avoid explicit enumeration of that full word space.

Native CPU timing uses `process_time_ns` in Python and
`CLOCK_PROCESS_CPUTIME_ID` in C++, seven repeats and randomized method order.
Medians are paired by domain; geometric means and 20,000-resample domain-bootstrap
intervals summarize ratios. The retained host reports AMD EPYC 9V74, nine logical
CPUs, Linux, Python 3.12.14 and NumPy 2.3.5. Compiler version and flags are in
`native-audit.json`; C++ uses `-O3 -DNDEBUG -std=c++17`. Independent FX verification
uses Node v24.22.1. These are single-host results, not cross-machine replication.

## 4. Results

### 4.1 Planner learning does not beat the strongest fixed baseline

All three independent searches select `hybrid`: entropy ordering, four-survivor
full verification and inverse lookup, without rank filtering, memoization,
image guards or a second ordering phase. Validation independently selects the
same `hybrid` as the strongest fixed baseline. These are identical programs,
not a small measured improvement. Identical methods share measurements in the
final report to prevent timing noise from manufacturing an apparent advantage.

Total search and validation cost is 6.344 CPU seconds. Because selected and
baseline query costs are identical by construction, there is no finite discovery
break-even against that baseline in this experiment. The result is specific to
this candidate space, objective, workload and search budget. It does not refute
all possible approaches to learning a search algorithm.

### 4.2 Runtime improvements depend strongly on the host and amortization

| Comparison | Tasks / eligible domains | Warm geometric speedup | 95% interval |
| --- | --- | --- | --- |
| Python hybrid vs Python pairwise | 320 / 40 | 47.94× | 38.79–60.20× |
| Python hybrid vs NumPy | 320 / 40 | 43.84× | 35.75–54.57× |
| C++ hybrid vs C++ pairwise, length ≤6 | 320 / 40 | 1.93× | 1.78–2.10× |
| C++ hybrid vs C++ pairwise, length ≤10 | 76 / 19 | 14.97× | 10.43–21.87× |
| C++ hybrid vs C++ inverse hash, length ≤10 | 76 / 19 | 4.18× | 2.52–6.76× |

The compiled audit shows why the initial 47.94× Python result is insufficient
as a broad algorithmic speed claim. Pairwise joining can reject at the first
mismatching coordinate in optimized native code. On the deeper tasks, indexed
joining still wins against compiled pairwise search in all 19 eligible domains.
These are comparisons against our implementations, not against external
state-of-the-art synthesizers.

Warm queries reuse semantic banks and indexes. A conservative cold estimate
adds Python semantic-bank construction equally to both methods, then charges
the entire shared C++ index union only to hybrid. It gives 2.75× [1.73, 4.11]
versus pairwise, with 15 domain wins and four losses. These attributed CPU values
are not independently measured fresh-process latency. The deeper affine family
loses under this estimate: 0.49× [0.36, 0.87]. Preprocessing cannot be omitted
when deciding whether the method helps a one-off synthesis request.

![Runtime by family](figures/native-results.png)

*Figure 1. Paired native CPU ratios by family. Higher favors hybrid. Error bars
are domain-bootstrap 95% intervals. The deeper study has only three eligible
affine domains and four in every other family. Cold estimates include common
bank construction and conservatively charge all C++ preparation to hybrid.*

### 4.3 Independent FX reconstruction and universal recovery

The separately implemented public FX API reconstructs all 396 retained targets
and verifies their certificates through complete replay. Every task uses all 64
states as its specification; verification is exhaustive within that model.
The TypeScript implementation uses a fresh bounded bank per call; the C++ warm
timings are **not** TypeScript or production-bot performance measurements.

For five-, six- and seven-state Černý examples, FX finds reset sequences of
length 16, 25 and 36, respectively, and completes searches proving no solution
within lengths 15, 24 and 35. The seven-state run has 2878 semantic bank rows.
Each reset word maps every initial state to state 0. This reproduces a known
family and shows the kind of universal recovery plan that could be synthesized
for a small faithful protocol abstraction. It neither proves the Černý conjecture
nor establishes recovery for an actual deployed bot.

### 4.4 Random word sampling misses rare semantic behaviors

A post hoc exact-length frontier audit finds 1088 reachable length-ten functions
for `affine:2011`, including **405 outside the half-bank**, although the random
word sampler found none in 400 attempts. Likewise, the shortfall training domain
`affine:53` has ten reachable novel length-six functions, of which the sampler
found two. The historical `saturated_domains` fields report sampler exhaustion;
they must not be interpreted as proof of semantic saturation. Uniform sampling
of primitive words is not uniform sampling of their semantic functions. All
original timing and selection data remain unchanged; the audit and concrete
witness words are retained separately. This exposes a benchmark-coverage limit
and motivates semantic or counterexample-directed curricula.

## 5. Related work and novelty boundary

FlashMeta [1] develops synthesis from inverse-semantics witness functions,
including relational constraints when operators are not bijective. Thus
non-invertible inverse reasoning is established prior work. DreamCoder [2]
jointly learns program libraries and neural search policies, so learning search
organization is also not a new general idea. Alford et al. [3] combine inverse
semantics with neural-guided bidirectional program search. Synchronizing words
and their length bounds have a substantial automata literature; [4] provides a
peer-reviewed reference on reset-word bounds.

The present artifact contributes a small exact implementation, disclosed
host/amortization comparisons, retained negative planner-selection results and
independently replayable FX certificates. This review does not establish that
the particular bitset organization is novel. We do not claim to outperform
FlashMeta, DreamCoder or specialized automata solvers: those implementations
were not included in this benchmark.

## 6. Limitations and the next decisive experiment

All tasks are synthetic and specified with complete finite semantics. Targets
are constructed from known-length words and conditioned to lie outside the
half-bank, so the solve rate does not measure arbitrary-target reachability.
Primary no-solution conformance is checked on small domains, not a broad large
unsatisfiable benchmark. Timing variation, one host, few scaling seeds,
conditional bootstrap intervals, an authored grammar and lack of live model
proposals limit generalization. Current result certificates establish existence
by replay; bounded unsatisfiability depends on a completed trusted search, not
a separately machine-checked proof object. There is no production Beetle adapter.

The next experiment capable of supporting the moonshot claim must let an
improver change search structure beyond these planner switches, compare learned
changes with matched-budget random and expert controls, and rerun the whole
improvement procedure from identical starting artifacts. A frozen application
benchmark derived from real FX or Beetle traces must then measure correctness,
latency, memory, discovery cost and regressions. These are future experiments,
not results already established by this artifact.

## References

1. Alex Polozov and Sumit Gulwani. *FlashMeta: A Framework for Inductive Program
   Synthesis.* OOPSLA/SPLASH, 2015.
   https://www.microsoft.com/en-us/research/publication/flashmeta-a-framework-for-inductive-program-synthesis/
2. Kevin Ellis, Lionel Wong, Maxwell Nye, Mathias Sablé-Meyer, Lucas Morales,
   Luke Hewitt, Luc Cary, Armando Solar-Lezama and Joshua B. Tenenbaum.
   *DreamCoder: Bootstrapping Inductive Program Synthesis with Wake-Sleep Library
   Learning.* PLDI, 2021. https://doi.org/10.1145/3453483.3454080
3. Simon Alford et al. *Neural-guided, Bidirectional Program Search for Abstraction
   and Reasoning.* Complex Networks, 2021. https://arxiv.org/abs/2110.11536
4. Marek Szykuła. *Improving the Upper Bound on the Length of the Shortest Reset
   Word.* STACS, 2018. https://doi.org/10.4230/LIPIcs.STACS.2018.56
