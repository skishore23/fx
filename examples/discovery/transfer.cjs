const assert = require('node:assert/strict');
const {
  ProgramRuntime,
  abstractionActions,
  abstractProgram,
  enumeratePrograms,
  learnAbstractions,
  programId,
  searchProgram,
} = require('../../packages/fx-core/dist');

const primitives = [
  { name: 'add', arity: 1, execute: (state, [n]) => ({ value: state.value + n }) },
  { name: 'scale', arity: 1, execute: (state, [n]) => ({ value: state.value * n }) },
];
const actions = [1, 2, 3, 4]
  .map((n) => ({ op: 'add', args: [n] }))
  .concat([2, 3].map((n) => ({ op: 'scale', args: [n] })));
const searchInputs = [-2, 0, 3];
const verificationInputs = [-7, -1, 0.5, 9, 20];
const budgets = { maxCandidates: 256, maxPrimitiveCalls: 1024, maxLength: 4 };
const examples = (fn, inputs) =>
  inputs.map((value) => ({ input: { value }, expected: { value: fn(value) } }));

function runTransfer() {
  const runtime = new ProgramRuntime(primitives);
  const corpus = [];
  let learningCandidates = 0;
  let learningCalls = 0;
  for (const offset of [1, 2, 3, 4]) {
    for (const factor of [2, 3]) {
      const found = searchProgram(
        runtime,
        examples((x) => (x + offset) * factor, searchInputs),
        enumeratePrograms(actions, 2),
        { ...budgets, maxLength: 2 },
      );
      assert.ok(
        found.program,
        'Initial tasks must actually be solved, not supplied as an oracle corpus',
      );
      corpus.push({ version: 1, body: runtime.expand(found.program) });
      learningCandidates += found.candidates;
      learningCalls += found.primitiveCalls;
    }
  }
  const learned = learnAbstractions(corpus);
  assert.ok(learned.length > 0, 'The corpus should support a compressive abstraction');
  const selected = [learned[0]];
  const withLibrary = new ProgramRuntime(
    primitives,
    selected.map((item) => item.abstraction),
  );
  for (const program of corpus) {
    assert.deepEqual(
      withLibrary.expand(abstractProgram(program, selected[0].abstraction).program),
      runtime.expand(program),
    );
  }
  const macroActions = abstractionActions(selected);
  const saved = corpus.map((program, index) => ({
    name: `saved_${index}`,
    arity: 0,
    body: program.body,
  }));
  const withSavedPrograms = new ProgramRuntime(primitives, saved);
  const savedActions = saved.map((item) => ({ op: item.name, args: [] }));
  const baseActions = new Set(actions.map((action) => JSON.stringify(action)));
  for (const action of macroActions) {
    for (const expanded of withLibrary.expand({ version: 1, body: [action] })) {
      assert.ok(
        baseActions.has(JSON.stringify(expanded)),
        'Library must not introduce new primitive actions/constants',
      );
    }
  }
  // Entire task compositions withheld from learning; search still gets I/O specs.
  const targets = [
    [3, 3, 4, 2],
    [4, 3, 2, 2],
    [4, 3, 3, 2],
    [4, 3, 4, 2],
    [3, 2, 3, 3],
    [4, 3, 2, 3],
    [4, 2, 3, 3],
    [4, 2, 4, 3],
  ];
  assert.equal(
    new Set(targets.map(([a, b, c, d]) => JSON.stringify([b * d, (a * b + c) * d]))).size,
    targets.length,
    'Held-out tasks must represent distinct functions',
  );
  const rows = targets.map(([a, b, c, d], index) => {
    const fn = (x) => ((x + a) * b + c) * d;
    const spec = examples(fn, searchInputs);
    const baseline = searchProgram(
      runtime,
      spec,
      enumeratePrograms(actions, budgets.maxLength),
      budgets,
    );
    const learnedSearch = searchProgram(
      withLibrary,
      spec,
      enumeratePrograms([...actions, ...macroActions], budgets.maxLength),
      budgets,
    );
    const savedSearch = searchProgram(
      withSavedPrograms,
      spec,
      enumeratePrograms([...actions, ...savedActions], budgets.maxLength),
      budgets,
    );
    const verify = (machine, result) =>
      Boolean(result.program) &&
      examples(fn, verificationInputs).every(
        (example) =>
          machine.run(result.program, example.input).state.value === example.expected.value,
      );
    const expanded = learnedSearch.program && {
      version: 1,
      body: withLibrary.expand(learnedSearch.program),
    };
    if (expanded) assert.ok(!corpus.some((program) => programId(program) === programId(expanded)));
    return {
      task: index + 1,
      baseline: {
        solved: verify(runtime, baseline),
        candidates: baseline.candidates,
        primitiveCalls: baseline.primitiveCalls,
      },
      savedPrograms: {
        solved: verify(withSavedPrograms, savedSearch),
        candidates: savedSearch.candidates,
        primitiveCalls: savedSearch.primitiveCalls,
      },
      learned: {
        solved: verify(withLibrary, learnedSearch),
        candidates: learnedSearch.candidates,
        primitiveCalls: learnedSearch.primitiveCalls,
      },
      program: learnedSearch.program,
      expanded,
    };
  });
  return {
    experiment: 'bounded-abstraction-transfer',
    version: 1,
    budgets,
    searchInputs,
    verificationInputs,
    learning: {
      tasks: corpus.length,
      candidates: learningCandidates,
      primitiveCalls: learningCalls,
      selected,
    },
    result: {
      tasks: rows.length,
      baselineSolved: rows.filter((row) => row.baseline.solved).length,
      savedProgramsSolved: rows.filter((row) => row.savedPrograms.solved).length,
      learnedSolved: rows.filter((row) => row.learned.solved).length,
    },
    rows,
    limitations: [
      'Designed arithmetic benchmark; not evidence of general intelligence or GPU scheduling improvement.',
      'Same candidate/primitive-call caps; vocabulary order and description length affect bounded enumeration.',
      'Learning cost is reported separately and is not amortized away.',
      'Macros preserve the original primitive language; the measured claim is search efficiency.',
      'The saved-program baseline tests whether parameterized learning adds anything beyond storing snippets.',
      'Verification inputs are excluded from search; test task specifications are input/output examples.',
    ],
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runTransfer(), null, 2)}\n`);
module.exports = { runTransfer };
