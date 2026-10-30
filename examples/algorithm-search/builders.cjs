const { expressionBuilder } = require('../../packages/fx-core/dist/discovery');
const { literal: lit, variable: variable, get, call } = expressionBuilder;
const set = (name, value) => ({ kind: 'set', name, value });
const append = (name, value) => ({ kind: 'append', name, value });
const put = (name, key, value) => ({ kind: 'put', name, key, value });
const branch = (condition, then, otherwise = []) => ({ kind: 'if', condition, then, otherwise });
const loop = (name, values, body, direction = 'forward') => ({
  kind: 'for',
  name,
  values,
  body,
  direction,
});
const ret = (value) => ({ kind: 'return', value });
const stop = { kind: 'break' };
const input = (key) => get(variable('input'), key);
module.exports = { lit, variable, get, call, set, append, put, branch, loop, ret, stop, input };
