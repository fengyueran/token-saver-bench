const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

const httpCommand = process.argv[2];
assert.ok(httpCommand && path.isAbsolute(httpCommand), 'absolute HTTPie executable required');

const body = Buffer.from('download-integrity-'.repeat(512));
const compressed = gzipSync(body);
const prefix = body.subarray(0, 137);
const observedRanges = new Map();
const boundedRanges = [];

function respond(request, response) {
  const route = request.url;
  observedRanges.set(route, request.headers.range ?? null);
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (route === '/gzip-full') {
    response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
    response.end(compressed);
  } else if (route === '/plain-resume') {
    const tail = body.subarray(prefix.length);
    response.writeHead(206, {
      ...headers,
      'Content-Length': tail.length,
      'Content-Range': `bytes ${prefix.length}-${body.length - 1}/${body.length}`,
    });
    response.end(tail);
  } else if (route === '/range-ignored') {
    response.writeHead(200, { ...headers, 'Content-Length': body.length });
    response.end(body);
  } else if (route === '/bounded-resume') {
    const match = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    const start = match ? Number(match[1]) : -1;
    boundedRanges.push(start);
    if (start < 0 || start >= body.length) {
      response.writeHead(416);
      response.end();
      return;
    }
    const end = Math.min(start + 1023, body.length - 1);
    response.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${body.length}`,
      ETag: '"fixture-v1"',
    });
    response.end(body.subarray(start, end + 1));
  } else if (route === '/stalled-resume') {
    response.writeHead(206, {
      ...headers,
      'Content-Length': 0,
      'Content-Range': `bytes ${prefix.length}-${body.length - 1}/${body.length}`,
    });
    response.end();
  } else if (route === '/gzip-resume') {
    const encodedTail = gzipSync(body.subarray(prefix.length));
    response.writeHead(206, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': encodedTail.length,
      'Content-Range': `bytes ${prefix.length}-${prefix.length + encodedTail.length - 1}/${prefix.length + encodedTail.length}`,
    });
    response.end(encodedTail);
  } else {
    response.writeHead(404);
    response.end();
  }
}

function runHttp(args, configDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(httpCommand, args, {
      env: { ...process.env, HTTPIE_CONFIG_DIR: configDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(0, 3000); });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr: stderr.slice(0, 3000) });
    });
  });
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'httpie-integrity-'));
  const server = createServer(respond);
  const failures = [];
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['gzip-full', 'plain-resume', 'range-ignored', 'bounded-resume', 'stalled-resume', 'gzip-resume']) {
      const output = path.join(dir, `${route}.bin`);
      const resume = route !== 'gzip-full';
      if (resume) await writeFile(output, prefix);
      const result = await runHttp([
        '--download', ...(resume ? ['--continue'] : []), '--output', output, 'GET', `${baseUrl}/${route}`,
      ], dir);
      try {
        assert.equal(result.signal, null, `${route} timed out`);
        assert.equal(
          route === 'bounded-resume' ? `bytes=${boundedRanges[0]}-` : observedRanges.get(`/${route}`),
          resume ? `bytes=${prefix.length}-` : null,
        );
        if (route === 'gzip-resume' || route === 'stalled-resume') {
          assert.notEqual(result.code, 0, `${route} must be rejected`);
          assert.ok((await readFile(output)).equals(prefix), `${route} changed the partial file`);
        } else {
          assert.equal(result.code, 0, `${route} failed: ${result.stderr}`);
          assert.ok((await readFile(output)).equals(body), `${route} output differs from expected bytes`);
          if (route === 'bounded-resume') {
            assert.ok(boundedRanges.length > 1, 'bounded response did not trigger follow-up ranges');
            assert.ok(boundedRanges.length < 20, 'too many follow-up ranges');
            for (let i = 0; i < boundedRanges.length; i++) {
              assert.equal(boundedRanges[i], prefix.length + i * 1024, 'range requests skipped or repeated bytes');
            }
          }
        }
        console.log(`PASS: ${route}`);
      } catch (error) {
        failures.push(`${route}: ${error.message}`);
        console.error(`FAIL: ${route}: ${error.message}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
