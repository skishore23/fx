const { ProgramRuntime } = require('../../packages/fx-core/dist');

const features = ['duration', 'cost', 'wait', 'slack', 'setup'];
const primitives = features.map((name) => ({
  name,
  arity: 1,
  execute: (state, [weight]) => ({ ...state, score: state.score + weight * state[name] }),
}));
const runtime = new ProgramRuntime(primitives);
const baselines = {
  fifo: { version: 1, body: [{ op: 'wait', args: [1] }] },
  shortest: { version: 1, body: [{ op: 'duration', args: [-1] }] },
  deadline: { version: 1, body: [{ op: 'slack', args: [-1] }] },
  locality: { version: 1, body: [{ op: 'setup', args: [-1] }] },
  cheapest: { version: 1, body: [{ op: 'cost', args: [-1] }] },
  hybrid: {
    version: 1,
    body: [
      { op: 'setup', args: [-1] },
      { op: 'cost', args: [-1] },
    ],
  },
};

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function workload(seed, jobs = 24, regime = 'mixed') {
  const rng = random(seed);
  const workers = [
    { id: 0, memory: 8, speed: 1, price: 1, model: -1 },
    { id: 1, memory: 24, speed: 2, price: 1.8, model: -1 },
    { id: 2, memory: 24, speed: 3, price: 2.8, model: -1 },
  ];
  const tasks = Array.from({ length: jobs }, (_, id) => {
    const arrival = regime === 'burst' ? (id < jobs / 2 ? 0 : 20) : Math.floor(rng() * 30);
    const work = 2 + Math.floor(rng() * (regime === 'long' ? 60 : 24));
    return {
      id,
      arrival,
      work,
      memory: rng() < 0.3 ? 16 : 4,
      model: Math.floor(rng() * (regime === 'many-models' ? 8 : 3)),
      deadline: arrival + 5 + Math.floor(rng() * 24),
    };
  });
  return { seed, regime, workers, jobs: tasks };
}

/** Discrete-event simulation; each worker has one slot and persistent model cache. */
function simulate(program, scenario) {
  const policyLength = runtime.expand(program).length;
  const workers = scenario.workers.map((worker) => ({ ...worker, busy: false }));
  const pending = scenario.jobs.map((job) => ({ ...job })).sort((a, b) => a.id - b.id);
  if (
    new Set(workers.map((worker) => worker.id)).size !== workers.length ||
    new Set(pending.map((job) => job.id)).size !== pending.length ||
    pending.some(
      (job) =>
        !Number.isFinite(job.arrival) ||
        job.arrival < 0 ||
        !Number.isFinite(job.work) ||
        job.work <= 0 ||
        !Number.isFinite(job.deadline) ||
        !Number.isFinite(job.memory) ||
        job.memory <= 0 ||
        !workers.some((worker) => worker.memory >= job.memory),
    )
  )
    throw new Error('Invalid or infeasible workload');
  if (
    workers.some(
      (worker) =>
        worker.speed <= 0 ||
        worker.price < 0 ||
        !Number.isFinite(worker.speed) ||
        !Number.isFinite(worker.price),
    )
  ) {
    throw new Error('Invalid worker');
  }
  const active = [];
  const completed = [];
  const assignments = [];
  let now = 0;
  let primitiveCalls = 0;
  let policyCalls = 0;
  while (pending.length || active.length) {
    for (let i = active.length - 1; i >= 0; i--) {
      const execution = active[i];
      if (execution.finish <= now) {
        workers.find((worker) => worker.id === execution.worker).busy = false;
        completed.push(execution);
        active.splice(i, 1);
      }
    }
    while (true) {
      let selected;
      for (const job of pending) {
        if (job.arrival > now) continue;
        for (const worker of workers) {
          if (worker.busy || job.memory > worker.memory) continue;
          const setup = worker.model === job.model ? 0 : 4;
          const duration = Math.ceil(job.work / worker.speed) + setup;
          const result = runtime.run(program, {
            score: 0,
            duration,
            cost: duration * worker.price,
            wait: now - job.arrival,
            slack: job.deadline - now - duration,
            setup,
          });
          primitiveCalls += result.primitiveCalls;
          policyCalls++;
          const score = result.state.score;
          if (!selected || score > selected.score) selected = { job, worker, duration, score };
        }
      }
      if (!selected) break;
      const { job, worker, duration } = selected;
      pending.splice(pending.indexOf(job), 1);
      worker.busy = true;
      worker.model = job.model;
      const execution = {
        ...job,
        worker: worker.id,
        start: now,
        finish: now + duration,
        cost: duration * worker.price,
      };
      active.push(execution);
      assignments.push(execution);
    }
    const events = [
      ...pending.filter((job) => job.arrival > now).map((job) => job.arrival),
      ...active.map((job) => job.finish),
    ];
    if (events.length === 0) {
      if (pending.length) throw new Error('Simulation deadlock');
      break;
    }
    now = Math.min(...events);
  }
  if (
    completed.length !== scenario.jobs.length ||
    new Set(completed.map((job) => job.id)).size !== completed.length
  ) {
    throw new Error('Lost or duplicated jobs');
  }
  const count = Math.max(1, completed.length);
  const meanFlow = completed.reduce((sum, job) => sum + job.finish - job.arrival, 0) / count;
  const meanTardiness =
    completed.reduce((sum, job) => sum + Math.max(0, job.finish - job.deadline), 0) / count;
  const cost = completed.reduce((sum, job) => sum + job.cost, 0);
  return {
    score: -(meanFlow + 0.25 * meanTardiness + 0.08 * cost),
    meanFlow,
    meanTardiness,
    cost,
    jobs: completed.length,
    primitiveCalls,
    policyCalls,
    policyLength,
    assignments,
  };
}

function assess(program, scenarios) {
  const results = scenarios.map((scenario) => simulate(program, scenario));
  const mean = (key) =>
    results.reduce((sum, row) => sum + row[key], 0) / Math.max(1, results.length);
  return {
    valid: true,
    score: mean('score'),
    metrics: {
      meanFlow: mean('meanFlow'),
      meanTardiness: mean('meanTardiness'),
      cost: mean('cost'),
      primitiveCalls: results.reduce((sum, row) => sum + row.primitiveCalls, 0),
      policyCalls: results.reduce((sum, row) => sum + row.policyCalls, 0),
    },
  };
}

module.exports = { random, workload, simulate, assess, features, baselines, runtime };
