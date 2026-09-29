import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, '.cache/fixtures/koa');
const serial = process.argv.includes('--serial');
const onlyPonytail = process.argv.includes('--ponytail-only');
for (const name of (
  await readdir(path.join(root, 'runs'), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('pilot-'))
  .map((entry) => entry.name)) {
  if (onlyPonytail && !name.includes('-ponytail-')) continue;
  const output = path.join(root, 'runs', name);
  let invocation;
  try {
    invocation = JSON.parse(
      await readFile(path.join(output, 'invocation.json'), 'utf8'),
    );
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const parent = await mkdtemp(path.join(tmpdir(), 'token-bench-verify-'));
  const workspace = path.join(parent, 'workspace');
  await cp(source, workspace, {
    recursive: true,
    filter: (name) => path.basename(name) !== '.git',
  });
  await rm(path.join(workspace, 'lib'), { recursive: true });
  await cp(
    path.join(invocation.workspace, 'lib'),
    path.join(workspace, 'lib'),
    { recursive: true },
  );
  const env = { PATH: process.env.PATH };
  const result = await execute(
    process.execPath,
    serial ? ['--test', '--test-concurrency=1'] : ['--test'],
    {
      cwd: workspace,
      env,
      timeoutMs: 60000,
    },
  );
  const report = {
    kind: 'pristine-upstream-regression',
    serial,
    note: 'Original upstream tests, independent copy of model-modified lib; excludes model-edited tests and dependency changes.',
    ...result,
  };
  await writeFile(
    path.join(
      output,
      serial
        ? 'upstream-verification-serial.json'
        : 'upstream-verification.json',
    ),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      id: name,
      exitCode: result.code,
      timedOut: result.timedOut,
    }),
  );
  await rm(parent, { recursive: true });
}
