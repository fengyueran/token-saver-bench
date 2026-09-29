// Match Supertest's connection family to the actual server listener.
// Test assertions and application implementation remain unchanged.
const path = require('node:path');
const Test = require(
  require.resolve('supertest/lib/test', { paths: [process.cwd()] }),
);
const original = Test.prototype.serverAddress;
Test.prototype.serverAddress = function (server, requestPath) {
  const url = original.call(this, server, requestPath);
  return server.address()?.family === 'IPv6'
    ? url.replace('://127.0.0.1:', '://[::1]:')
    : url;
};
