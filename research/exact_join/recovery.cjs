// Universal recovery in a finite state model: the initial state is unknown.
// These are the established Cerny automata, not a new automata-theory result.
const fs = require('node:fs');
const path = require('node:path');
const { synthesizeFiniteComposition, verifyFiniteCertificate } = require('../../packages/fx-core/dist');
const records = [];
for (const states of [5, 6, 7]) {
  const problem = { states, target: Array(states).fill(0), operations: [
    { name: 'advance', table: Array.from({ length: states }, (_, x) => (x + 1) % states) },
    { name: 'merge', table: Array.from({ length: states }, (_, x) => x === states - 1 ? 0 : x) },
  ] };
  const expectedLength = (states - 1) ** 2;
  for (const maxLength of [expectedLength - 1, expectedLength]) {
    const start = process.hrtime.bigint();
    const result = synthesizeFiniteComposition(problem, { maxLength, maxBank: 8192, maxWork: 100_000_000 });
    if (result.status === 'solved' && !verifyFiniteCertificate(problem, result.certificate))
      throw new Error('Invalid recovery certificate');
    const record = { states, maxLength, result, cpuNote: 'wall time; not a benchmark comparison',
      wallMilliseconds: Number(process.hrtime.bigint() - start) / 1e6 };
    records.push(record);
    console.log(JSON.stringify({ states, maxLength, status: result.status,
      program: result.status === 'solved' ? result.certificate.program.map((i) => problem.operations[i].name).join(' ') : null,
      work: result.usage.work, wallMilliseconds: record.wallMilliseconds }));
  }
}
if (process.argv.includes('--record'))
  fs.writeFileSync(path.join(__dirname, 'results/recovery.json'), JSON.stringify({ node: process.version,
    interpretation: 'Recovers state 0 from every state in the exact finite model. Known Cerny examples; no new theorem or claim about live bot recovery.', records }, null, 2) + '\n');
