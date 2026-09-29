import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startHeadroom(root, output) {
  const port = await availablePort();
  const state = path.join(output, 'headroom-state');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    DO_NOT_TRACK: '1',
    HEADROOM_TELEMETRY: 'off',
    HEADROOM_BEACON: 'off',
    HEADROOM_CONFIG_DIR: path.join(state, 'config'),
    HEADROOM_WORKSPACE_DIR: state,
  };
  const binary = path.join(root, '.cache/runtime/headroom/bin/headroom');
  const args = [
    'proxy',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--mode',
    'cache',
    '--no-telemetry',
    '--no-learn',
    '--no-subscription-tracking',
    '--log-file',
    path.join(output, 'headroom-requests.jsonl'),
  ];
  const child = spawn(binary, args, {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failure;
  child.once('error', (error) => {
    failure = error;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) =>
      appendFileSync(path.join(output, 'headroom-proxy.log'), data, {
        mode: 0o600,
      }),
    );
  }
  const stop = () => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const started = Date.now();
  while (Date.now() - started < 60000) {
    if (failure || child.exitCode !== null) {
      stop();
      throw failure ?? new Error(`Headroom exited: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok)
        return { port, stop, args, setupMs: Date.now() - started };
    } catch {
      /* Proxy is still initializing; retry within the startup deadline. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop();
  throw new Error('Headroom readiness timeout');
}
