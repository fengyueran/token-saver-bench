import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/process.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const locks = JSON.parse(
  await readFile(path.join(root, 'config/sources-lock.json'), 'utf8'),
);
const config = JSON.parse(
  await readFile(path.join(root, 'config/experiment.json'), 'utf8'),
);
const sourceRepos = Object.fromEntries(
  config.arms
    .filter((arm) => arm.repository)
    .map((arm) => [arm.id, arm.repository]),
);
async function command(binary, args, cwd = root) {
  const result = await execute(binary, args, { cwd, timeoutMs: 600000 });
  if (result.code !== 0 || result.timedOut)
    throw new Error(`${binary} failed: ${result.stderr.slice(-2000)}`);
  return result.stdout.trim();
}
async function checkout(repository, commit, directory) {
  try {
    await access(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true });
    await command('git', ['init', '--quiet'], directory);
    await command('git', ['remote', 'add', 'origin', repository], directory);
    await command(
      'git',
      ['fetch', '--depth', '1', 'origin', commit],
      directory,
    );
    await command('git', ['checkout', '--detach', 'FETCH_HEAD'], directory);
  }
  if ((await command('git', ['rev-parse', 'HEAD'], directory)) !== commit)
    throw new Error(`Existing checkout differs: ${directory}`);
}
if ((await command('codex', ['--version'])) !== `codex-cli ${locks.codex}`)
  throw new Error(`Install global @openai/codex@${locks.codex} first`);
for (const name of ['caveman', 'ponytail', 'rtk']) {
  console.log(`Preparing ${name}`);
  await checkout(
    sourceRepos[name],
    locks.tools[name].commit,
    path.join(root, '.cache/tools', name),
  );
}
const koa = path.join(root, '.cache/fixtures/koa');
await checkout(locks.fixture.repository, locks.fixture.commit, koa);
await copyFile(
  path.join(root, 'config/koa-package-lock.json'),
  path.join(koa, 'package-lock.json'),
);
await command(
  'npm',
  ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  koa,
);
await command('npm', ['run', 'build'], koa);
await command(
  'cargo',
  ['build', '--release', '--locked'],
  path.join(root, '.cache/tools/rtk'),
);
const graph = path.join(root, '.cache/runtime/codegraph');
await mkdir(graph, { recursive: true });
await writeFile(
  path.join(graph, 'package.json'),
  JSON.stringify({
    private: true,
    dependencies: { '@colbymchenry/codegraph': '1.6.0' },
  }),
);
await copyFile(
  path.join(root, 'config/codegraph-package-lock.json'),
  path.join(graph, 'package-lock.json'),
);
await command('npm', ['ci', '--no-audit', '--no-fund'], graph);
const headroom = path.join(root, '.cache/runtime/headroom');
try {
  await access(path.join(headroom, 'bin/python'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await command('uv', ['venv', '--python', '3.12', headroom]);
}
await command('uv', [
  'pip',
  'sync',
  '--python',
  path.join(headroom, 'bin/python'),
  path.join(root, 'config/headroom-requirements-lock.txt'),
]);
console.log('Setup complete. No global agent configuration was changed.');
