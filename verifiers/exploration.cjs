const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const task = process.argv[3];
const answer = JSON.parse(
  fs.readFileSync(path.resolve(process.argv[2], 'answer.json'), 'utf8'),
);
assert.equal(typeof answer.explanation, 'string');
assert.ok(answer.explanation.trim().length > 0);
if (task === 'trace-request') {
  const entries = {
    entry: 'callback',
    createContext: 'createContext',
    handler: 'handleRequest',
    success: 'respond',
    failure: 'onerror',
  };
  for (const [key, symbol] of Object.entries(entries)) {
    assert.equal(
      answer[key].file,
      key === 'failure' ? 'lib/context.js' : 'lib/application.js',
    );
    assert.ok(answer[key].symbol.split(/[.#]/).pop() === symbol);
  }
  assert.equal(answer.compose.file, 'lib/application.js');
  assert.match(answer.compose.expression, /this\.compose\(this\.middleware\)/);
  assert.equal(answer.asyncStorage.file, 'lib/application.js');
  assert.match(answer.asyncStorage.expression, /this\.ctxStorage\.run\(ctx,/);
  assert.equal(answer.defaultStatus, 404);
  assert.equal(answer.stateScope, 'per-request');
} else if (task === 'assess-change') {
  assert.equal(answer.implementationFile, 'lib/request.js');
  assert.equal(answer.delegationFile, 'lib/context.js');
  assert.equal(
    answer.forwardedProtocolHeader.toLowerCase(),
    'x-forwarded-proto',
  );
  assert.equal(answer.forwardedHostHeader.toLowerCase(), 'x-forwarded-host');
  assert.equal(answer.ipHeaderOption, 'proxyIpHeader');
  assert.equal(answer.ipLimitOption, 'maxIpsCount');
  assert.equal(answer.ipLimitSide, 'right');
  assert.deepEqual(answer.noProxy, { protocol: 'http', ips: [] });
  assert.equal(answer.encryptedProtocol, 'https');
  assert.deepEqual(answer.example, {
    host: 'edge.example:8443',
    hostname: 'edge.example',
    protocol: 'https',
    ips: ['203.0.113.2', '192.0.2.3'],
    ip: '203.0.113.2',
  });
} else throw new Error('Unknown exploration task');
console.log(
  'PASS: structured facts; explanation requires separate human review',
);
