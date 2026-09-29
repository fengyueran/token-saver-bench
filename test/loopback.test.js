import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.js';

test('test-only adapter connects to the matching address family and preserves response assertions', async () => {
  const preload = fileURLToPath(
    new URL('../verifiers/loopback.cjs', import.meta.url),
  );
  const cwd = fileURLToPath(new URL('../.cache/fixtures/koa', import.meta.url));
  const code = `const http=require('node:http'); const request=require('supertest'); const assert=require('node:assert/strict'); (async()=>{for(const host of ['::1','127.0.0.1']){const server=http.createServer((q,r)=>r.end('expected')); await new Promise(resolve=>server.listen(0,host,resolve));try{await request(server).get('/').expect(200).expect('expected');await assert.rejects(request(server).get('/').expect('wrong'));}finally{await new Promise(resolve=>server.close(resolve));}}})().catch(e=>{console.error(e);process.exitCode=1});`;
  const result = await execute(
    process.execPath,
    ['--require', preload, '-e', code],
    { cwd, timeoutMs: 5000 },
  );
  assert.equal(result.code, 0, result.stderr);
});
