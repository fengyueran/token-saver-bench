const assert = require('node:assert/strict');
const path = require('node:path');
const request = require(path.resolve(process.argv[2], 'lib/request.js'));
assert.equal(typeof request.pickQuery, 'function');
const source = Object.assign(Object.create({ inherited: 'secret' }), {
  a: '1',
  multi: ['a', 'b'],
  empty: '',
  constructor: 'ctor',
  toString: 'str',
});
Object.defineProperty(source, '__proto__', { value: 'safe', enumerable: true });
const target = Object.create(request);
Object.defineProperty(target, 'query', { get: () => source });
const keys = Object.freeze([
  'multi',
  'a',
  'missing',
  'inherited',
  'multi',
  '__proto__',
  'constructor',
  'toString',
  'empty',
]);
const picked = target.pickQuery(keys);
assert.equal(Object.getPrototypeOf(picked), null);
assert.deepEqual(
  { ...picked },
  {
    multi: ['a', 'b'],
    a: '1',
    ['__proto__']: 'safe',
    constructor: 'ctor',
    toString: 'str',
    empty: '',
  },
);
picked.multi.push('new');
assert.deepEqual(source.multi, ['a', 'b']);
assert.equal(Object.getPrototypeOf(target.pickQuery([])), null);
for (const value of [
  undefined,
  null,
  'a',
  {},
  1,
  [1],
  ['a', null],
  ['a', {}],
]) {
  const trap = {
    get query() {
      throw new Error('read before validation');
    },
  };
  assert.throws(() => request.pickQuery.call(trap, value), TypeError);
}
const real = Object.create(request);
real.req = { url: '/path?a=1&a=2&b=&constructor=x&__proto__=y' };
const before = real.req.url;
const selected = real.pickQuery(['a', 'b', 'constructor', '__proto__']);
assert.deepEqual({ ...selected }, { a: ['1', '2'], b: '', constructor: 'x' });
selected.a[0] = 'changed';
assert.deepEqual(real.query.a, ['1', '2']);
assert.equal(real.req.url, before);
console.log(
  'PASS: own keys, repeated values, copying, validation, URL unchanged',
);
