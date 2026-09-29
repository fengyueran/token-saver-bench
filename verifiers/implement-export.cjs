const assert = require('node:assert/strict');
const path = require('node:path');
const response = require(path.resolve(process.argv[2], 'lib/response.js'));
assert.equal(typeof response.exportHeaders, 'function');
const headers = Object.assign(Object.create({ inherited: 'secret' }), {
  'Content-Type': 'text/plain',
  'Set-Cookie': ['a=1', 'b=2'],
  'Content-Length': 42,
  'X-Empty': '',
});
Object.defineProperty(headers, '__proto__', {
  value: 'safe',
  enumerable: true,
});
for (const res of [{ getHeaders: () => headers }, { _headers: headers }]) {
  const target = Object.create(response);
  target.res = res;
  const snapshot = target.exportHeaders(
    Object.freeze(['CONTENT-TYPE', 'not-present']),
  );
  assert.equal(Object.getPrototypeOf(snapshot), null);
  assert.deepEqual(
    { ...snapshot },
    {
      'set-cookie': ['a=1', 'b=2'],
      'content-length': 42,
      'x-empty': '',
      ['__proto__']: 'safe',
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), { ...snapshot });
  snapshot['set-cookie'].push('c=3');
  assert.deepEqual(headers['Set-Cookie'], ['a=1', 'b=2']);
  assert.equal(target.exportHeaders()['content-type'], 'text/plain');
  assert.equal(target.exportHeaders(undefined)['content-type'], 'text/plain');
}
for (const value of [null, 'cookie', {}, 1, [1], ['valid', null]]) {
  const trap = {
    get header() {
      throw new Error('read before validation');
    },
  };
  assert.throws(() => response.exportHeaders.call(trap, value), TypeError);
}
console.log(
  'PASS: case normalization, own keys, exclusion, snapshot isolation, legacy fallback',
);
