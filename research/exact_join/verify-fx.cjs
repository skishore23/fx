// A separate implementation checks every final task through the actual FX API.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { synthesizeFiniteComposition, verifyFiniteCertificate } = require('../../packages/fx-core/dist');
const { createHash } = require('node:crypto');
const scaling = process.argv.includes('--scaling');
const source = path.join(__dirname, scaling ? 'results/scaling.json' : 'results/heldout.json');
const heldout = JSON.parse(fs.readFileSync(source, 'utf8'));
const proofs = scaling ? heldout.cases.flatMap((c) => c.targets.map((target) => ({
  case: c.id, target, operations: c.operations,
}))) : heldout.proofs;
const records = [];
const start = performance.now();
for (const proof of proofs) {
  const problem = {
    states: proof.target.length / 2,
    operations: proof.operations.map((hex, i) => ({ name: `operation${i}`, table: [...Buffer.from(hex, 'hex')] })),
    target: [...Buffer.from(proof.target, 'hex')],
  };
  const result = synthesizeFiniteComposition(problem, { maxLength: scaling ? 10 : 6,
    maxBank: scaling ? 16384 : 2048, maxWork: 100_000_000 });
  if (result.status !== 'solved' || !verifyFiniteCertificate(problem, result.certificate))
    throw new Error(`FX failed independent reconstruction: ${proof.case} (${result.status})`);
  records.push({ case: proof.case, certificate: result.certificate, usage: result.usage });
}
const result = { tasks: records.length, verified: records.length, wallMilliseconds: performance.now() - start,
  node: process.version, heldoutSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'), records };
if (process.argv.includes('--record'))
  fs.writeFileSync(path.join(__dirname, scaling ? 'results/scaling-fx-verification.json' : 'results/fx-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ tasks: result.tasks, verified: result.verified, wallMilliseconds: result.wallMilliseconds }));
