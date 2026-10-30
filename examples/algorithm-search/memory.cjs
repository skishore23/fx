const { getMemory } = require('../../packages/fx-core/dist/memory');
const {
  lit,
  variable: v,
  get,
  call,
  set,
  append,
  branch,
  loop,
  ret,
  stop,
  input,
} = require('./builders.cjs');
const filter = (key) => get(input('filter'), key);
const entry = (key) => get(v('entry'), key);
const eq = (a, b) => call('eq', a, b);
const notNull = (value) => call('not', eq(value, lit(null)));
const hasLimit = call('and', notNull(filter('limit')), call('not', eq(filter('limit'), lit(0))));
const fastLimit = call(
  'and',
  notNull(filter('limit')),
  call(
    'and',
    call('gt', filter('limit'), lit(0)),
    eq(filter('limit'), call('floor', filter('limit'))),
  ),
);
const predicates = {
  type: call('or', eq(filter('type'), lit(null)), eq(entry('type'), filter('type'))),
  since: call(
    'or',
    eq(filter('since'), lit(null)),
    call('gte', entry('timestamp'), filter('since')),
  ),
  search: call(
    'or',
    eq(v('needle'), lit('')),
    call('contains', call('lower', entry('content')), v('needle')),
  ),
};
const orders = [
  ['type', 'since', 'search'],
  ['type', 'search', 'since'],
  ['since', 'type', 'search'],
  ['since', 'search', 'type'],
  ['search', 'type', 'since'],
  ['search', 'since', 'type'],
];

function memoryAlgorithm(strategy, order) {
  const matches = order
    .map((name) => predicates[name])
    .reduce((left, right) => call('and', left, right));
  const scan = (reverse, early) =>
    loop(
      'entry',
      input('entries'),
      [
        branch(matches, [
          append('result', v('entry')),
          ...(early
            ? [
                branch(
                  call('and', fastLimit, call('gte', call('length', v('result')), filter('limit'))),
                  [stop],
                ),
              ]
            : []),
        ]),
      ],
      reverse ? 'reverse' : 'forward',
    );
  const full = [
    scan(false, false),
    branch(hasLimit, [set('result', call('slice', v('result'), call('neg', filter('limit'))))]),
    ret(v('result')),
  ];
  const body = [
    set('result', call('array')),
    set('needle', lit('')),
    branch(notNull(filter('search')), [set('needle', call('lower', filter('search')))]),
  ];
  if (strategy === 'forward') body.push(...full);
  else if (strategy === 'reverse-guarded')
    body.push(branch(fastLimit, [scan(true, true), ret(call('reverse', v('result')))], full));
  else if (strategy === 'forward-early') body.push(scan(false, true), ret(v('result')));
  else body.push(scan(true, true), ret(v('result'))); // intentionally fails output order
  return { version: 1, body };
}

function fixture(seed, size, filterOverride = {}) {
  const types = ['observation', 'action', 'result', 'error'];
  return {
    entries: Array.from({ length: size }, (_, i) => ({
      id: `entry-${seed}-${i}`,
      type: types[(i + seed) % 4],
      content: i % 7 === 0 ? 'URGENT deploy' : i % 3 === 0 ? 'Build succeeded' : 'routine status',
      timestamp: seed * 1000 + (size - i) * 10,
    })),
    filter: { type: null, since: null, search: null, limit: 3, ...filterOverride },
  };
}
function cases(prefix, seed, sizes) {
  const filters = [
    {},
    { limit: null },
    { limit: 0 },
    { limit: -2 },
    { limit: 2.5 },
    { type: 'error', limit: 2 },
    { search: 'bUiLd', limit: 4 },
    { since: 0, search: '', limit: 1 },
    { search: 'missing', limit: 1 },
    { type: 'observation', search: 'urgent', limit: 2 },
  ];
  return filters.map((filter, i) => ({
    name: `${prefix}-${i}`,
    input: fixture(seed + i, sizes[i % sizes.length], filter),
  }));
}
function memoryTarget() {
  return {
    id: 'fx.memory.getMemory',
    contract:
      'Input is {entries:[{id,type,content,timestamp}],filter:{type,since,search,limit}}. Timestamps/since are finite milliseconds; every filter field is nullable. Return complete matching entries in input array order. Preserve actual FX getMemory semantics: type and since filtering, case-insensitive substring search, and finite numeric limit behavior including negative, fractional, zero or null limits.',
    baseline: memoryAlgorithm('forward', orders[0]),
    reference: async (input) => {
      const filter = Object.fromEntries(
        Object.entries(input.filter).filter(([, value]) => value !== null),
      );
      if (filter.since !== undefined) filter.since = new Date(filter.since);
      const memory = input.entries.map((entry) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));
      const result = await getMemory(filter)({ memory });
      return result.memoryFiltered.map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.getTime(),
      }));
    },
    training: cases('train', 10, [16, 48, 128]),
    validation: cases('validation', 100, [0, 80, 180]),
    heldOut: cases('test', 200, [512, 256, 31]),
  };
}
function memoryCandidates() {
  return ['forward-early', 'reverse-unordered', 'forward', 'reverse-guarded'].flatMap((strategy) =>
    orders.map((order) => ({
      name: `${strategy}:${order.join(',')}`,
      algorithm: memoryAlgorithm(strategy, order),
    })),
  );
}
module.exports = { memoryTarget, memoryCandidates, memoryAlgorithm };
