const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

const httpCommand = process.argv[2];
assert.ok(httpCommand && path.isAbsolute(httpCommand), 'absolute HTTPie executable required');

const body = Buffer.from(JSON.stringify({ records: Array.from({ length: 256 }, (_, i) => ({ id: i, value: 'repeatable value' })) }));
const compressed = gzipSync(body);
assert.notEqual(compressed.length, body.length);

function serve(request, response) {
  if (request.url === '/gzip') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': compressed.length,
    });
    response.end(compressed);
    return;
  }
  if (request.url === '/plain' || request.url === '/truncated') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': body.length + (request.url === '/truncated' ? 10 : 0),
    });
    response.end(body);
    return;
  }
  response.writeHead(404);
  response.end();
}

function runHttp(args, configDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(httpCommand, args, {
      env: { ...process.env, HTTPIE_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(0, 2000); });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr: stderr.slice(0, 2000) });
    });
  });
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'httpie-gzip-verifier-'));
  const server = createServer(serve);
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['plain', 'truncated', 'gzip']) {
      const output = path.join(dir, `${route}.json`);
      const result = await runHttp(['--download', '--output', output, 'GET', `${baseUrl}/${route}`], dir);
      if (route === 'truncated') {
        assert.notEqual(result.code, 0, 'truncated plain response must fail');
        console.log('PASS: truncated plain response is rejected');
        continue;
      }
      assert.equal(result.code, 0, `${route} download failed: ${result.stderr}`);
      assert.deepEqual(await readFile(output), body, `${route} output differs from decoded response`);
      console.log(`PASS: ${route} download`);
    }
    console.log('PASS: gzip and plain downloads succeed; truncated plain download fails');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
