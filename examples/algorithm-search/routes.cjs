const {
  lit,
  variable: v,
  get,
  call,
  set,
  append,
  put,
  branch,
  loop,
  ret,
  stop,
  input,
} = require('./builders.cjs');
const routeAddress = get(v('route'), 'address');
const converse = (route) => call('eq', get(route, 'policy'), lit('converse'));
const notNull = (value) => call('not', call('eq', value, lit(null)));

function routeAlgorithm(strategy, preferConverse = true, reverse = false) {
  const indexed = strategy !== 'scan';
  const body = [set('output', call('array'))];
  if (indexed) {
    body.push(set('index', call('map')));
    if (strategy === 'bucket-index')
      body.push(
        loop('route', input('routes'), [
          branch(call('not', call('has', v('index'), routeAddress)), [
            put('index', routeAddress, call('array')),
          ]),
          set('bucket', call('lookup', v('index'), routeAddress)),
          append('bucket', v('route')),
        ]),
      );
    else
      body.push(
        loop('route', input('routes'), [
          branch(
            call('not', call('has', v('index'), routeAddress)),
            [put('index', routeAddress, v('route'))],
            preferConverse
              ? [
                  branch(
                    call(
                      'and',
                      call('not', converse(call('lookup', v('index'), routeAddress))),
                      converse(v('route')),
                    ),
                    [put('index', routeAddress, v('route'))],
                  ),
                ]
              : [],
          ),
        ]),
      );
  }
  const addressBody = [];
  if (strategy === 'reader-index')
    addressBody.push(
      branch(call('has', v('index'), v('address')), [
        set('chosen', call('lookup', v('index'), v('address'))),
        stop,
      ]),
    );
  else {
    if (indexed)
      addressBody.push(
        set('bucket', call('array')),
        branch(call('has', v('index'), v('address')), [
          set('bucket', call('lookup', v('index'), v('address'))),
        ]),
      );
    addressBody.push(
      set('first', lit(null)),
      loop('route', indexed ? v('bucket') : input('routes'), [
        branch(call('eq', routeAddress, v('address')), [
          branch(call('eq', v('first'), lit(null)), [set('first', v('route'))]),
          ...(preferConverse
            ? [branch(converse(v('route')), [set('first', v('route')), stop])]
            : []),
        ]),
      ]),
      branch(notNull(v('first')), [set('chosen', v('first')), stop]),
    );
  }
  body.push(
    loop('query', input('queries'), [
      set('chosen', lit(null)),
      loop('address', v('query'), addressBody, reverse ? 'reverse' : 'forward'),
      append('output', v('chosen')),
    ]),
    ret(v('output')),
  );
  return { version: 1, body };
}
function routeReference(input) {
  return input.queries.map((addresses) => {
    for (const address of addresses) {
      const level = input.routes.filter((route) => route.address === address);
      if (level.length) return level.find((route) => route.policy === 'converse') ?? level[0];
    }
    return null;
  });
}
function fixture(seed, size, queries) {
  const routes = Array.from({ length: size }, (_, i) => ({
    id: `route-${seed}-${i}`,
    address: `channel:${seed}:${i % 17}`,
    policy: i % 5 === 0 ? 'converse' : 'observe',
    metadata: { source: 'synthetic' },
  }));
  return {
    routes,
    queries: Array.from({ length: queries }, (_, i) => [
      `thread:${seed}:${i}`,
      `channel:${seed}:${i % 19}`,
      `workspace:${seed}`,
    ]),
  };
}
function routeTarget() {
  const make = (prefix, seed, sizes) =>
    sizes.map((n, i) => ({ name: `${prefix}-${i}`, input: fixture(seed + i, n, i ? 20 : 3) }));
  return {
    id: 'beetle.route.batch-most-specific',
    contract:
      'Input is {routes:[{id,address,policy,...otherFields}],queries:[orderedAddressStrings[]]}. For every query return the first converse route at the nearest nonempty address level, otherwise its first route, otherwise null. Return an array preserving full route records and query order. Routes are an immutable snapshot for the batch. This is a selection reference model, not the live Rust authorization router.',
    baseline: routeAlgorithm('scan'),
    reference: routeReference,
    training: [
      ...make('train', 1, [0, 4, 64, 128]),
      {
        name: 'train-precedence',
        input: {
          routes: [
            { id: 'observer', address: 'thread', policy: 'observe' },
            { id: 'primary', address: 'thread', policy: 'converse' },
            { id: 'later', address: 'thread', policy: 'converse' },
            { id: 'channel', address: 'channel', policy: 'converse' },
          ],
          queries: [['thread', 'channel'], ['channel', 'thread'], ['absent']],
        },
      },
    ],
    validation: make('validation', 101, [8, 96, 180]),
    heldOut: make('test', 201, [1, 256, 512]),
  };
}
function routeCandidates() {
  return ['scan', 'bucket-index', 'reader-index'].flatMap((strategy) =>
    [false, true].flatMap((prefer) =>
      [true, false].map((reverse) => ({
        name: `${strategy}:converse=${prefer}:reverse=${reverse}`,
        algorithm: routeAlgorithm(strategy, prefer, reverse),
      })),
    ),
  );
}
module.exports = { routeTarget, routeCandidates, routeAlgorithm, routeReference };
