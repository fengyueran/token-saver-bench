import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { prepareFixture } from '../src/fixture.js';
import { execute } from '../src/process.js';
import { getTask } from '../src/tasks.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '.cache/fixtures/koa');
const referenceMethods = {
  'implement-filter': `module.exports.pickQuery = function (keys) {
    if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new TypeError('keys');
    const query = this.query;
    const result = Object.create(null);
    for (const key of keys) if (Object.hasOwn(query, key)) result[key] = Array.isArray(query[key]) ? [...query[key]] : query[key];
    return result;
  };`,
  'implement-export': `module.exports.exportHeaders = function (exclude = []) {
    if (!Array.isArray(exclude) || exclude.some(key => typeof key !== 'string')) throw new TypeError('exclude');
    const excluded = new Set(exclude.map(key => key.toLowerCase()));
    const result = Object.create(null);
    for (const [key, value] of Object.entries(this.header)) if (!excluded.has(key.toLowerCase())) result[key.toLowerCase()] = Array.isArray(value) ? [...value] : value;
    return result;
  };`,
};

for (const task of ['repair-state', 'implement-filter', 'implement-export']) {
  test(`${task}: verifier rejects starting code and accepts known-correct result`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'token-task-test-'));
    const workspace = path.join(parent, 'workspace');
    try {
      await prepareFixture(source, workspace, task);
      const args = [path.join(root, `verifiers/${task}.cjs`), workspace];
      const red = await execute(process.execPath, args, { timeoutMs: 5000 });
      assert.notEqual(red.code, 0);
      assert.match(red.stderr, /ERR_ASSERTION/);
      if (task === 'repair-state') {
        await writeFile(
          path.join(workspace, 'lib/application.js'),
          execFileSync('git', ['show', 'HEAD:lib/application.js'], {
            cwd: source,
          }),
        );
      } else {
        const file = path.join(
          workspace,
          task === 'implement-filter' ? 'lib/request.js' : 'lib/response.js',
        );
        await writeFile(
          file,
          (await readFile(file, 'utf8')) + '\n' + referenceMethods[task],
        );
      }
      const green = await execute(process.execPath, args, { timeoutMs: 5000 });
      assert.equal(green.code, 0, green.stderr);
    } finally {
      await rm(parent, { recursive: true });
    }
  });
}

test('unknown task fails before any fixture write', () =>
  assert.throws(() => getTask('../bad'), /Unsupported/));

test('exploration verifier rejects plausible wrong proxy interpretation', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'token-answer-test-'));
  const answer = {
    implementationFile: 'lib/request.js',
    delegationFile: 'lib/context.js',
    forwardedProtocolHeader: 'X-Forwarded-Proto',
    forwardedHostHeader: 'X-Forwarded-Host',
    ipHeaderOption: 'proxyIpHeader',
    ipLimitOption: 'maxIpsCount',
    ipLimitSide: 'right',
    noProxy: { protocol: 'http', ips: [] },
    encryptedProtocol: 'https',
    example: {
      host: 'edge.example:8443',
      hostname: 'edge.example',
      protocol: 'https',
      ips: ['203.0.113.2', '192.0.2.3'],
      ip: '203.0.113.2',
    },
    explanation: 'Trusting forwarded headers changes client IP and protocol.',
  };
  const args = [
    path.join(root, 'verifiers/exploration.cjs'),
    workspace,
    'assess-change',
  ];
  try {
    await writeFile(
      path.join(workspace, 'answer.json'),
      JSON.stringify({ ...answer, ipLimitSide: 'left' }),
    );
    assert.notEqual((await execute(process.execPath, args)).code, 0);
    await writeFile(
      path.join(workspace, 'answer.json'),
      JSON.stringify(answer),
    );
    const green = await execute(process.execPath, args);
    assert.equal(green.code, 0, green.stderr);
  } finally {
    await rm(workspace, { recursive: true });
  }
});
