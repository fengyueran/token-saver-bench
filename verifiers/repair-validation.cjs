const assert = require('node:assert/strict');
const path = require('node:path');
const Koa = require(path.resolve(process.argv[2], 'lib/application.js'));

const app = new Koa();
const first = () => {};
const second = async () => {};
assert.equal(app.use(first), app);
for (const value of [
  undefined,
  null,
  false,
  true,
  0,
  1,
  '',
  'function',
  [],
  {},
  /x/,
  Symbol('middleware'),
  { then() {} },
]) {
  assert.throws(() => app.use(value), {
    name: 'TypeError',
    message: 'middleware must be a function!',
  });
  assert.deepEqual(app.middleware, [first]);
}
assert.equal(app.use(second), app);
assert.deepEqual(app.middleware, [first, second]);
console.log(
  'PASS: invalid inputs, unchanged state, async functions, order, chaining',
);
