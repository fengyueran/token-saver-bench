const assert = require('node:assert/strict');
const path = require('node:path');
const Koa = require(path.resolve(process.argv[2], 'lib/application.js'));
const app = new Koa();
function context() {
  const req = { url: '/example', headers: {}, socket: {} };
  const res = {};
  return app.createContext(req, res);
}
const one = context();
one.state.user = { roles: ['admin'] };
const two = context();
assert.deepEqual(two.state, {});
assert.notEqual(one.state, two.state);
assert.equal(Object.getPrototypeOf(two.state), Object.prototype);
assert.equal(app.context.state, undefined);
two.state.user = { roles: ['guest'] };
assert.deepEqual(one.state.user.roles, ['admin']);
app.context.state = { seed: true };
const three = context();
assert.deepEqual(three.state, {});
assert.deepEqual(app.context.state, { seed: true });
for (const ctx of [one, two, three]) {
  assert.equal(ctx.request.ctx, ctx);
  assert.equal(ctx.response.ctx, ctx);
  assert.equal(ctx.request.response, ctx.response);
  assert.equal(ctx.response.request, ctx.request);
  assert.equal(ctx.request.req, ctx.req);
  assert.equal(ctx.response.res, ctx.res);
}
console.log('PASS: per-request state, no prototype mutation, preserved links');
