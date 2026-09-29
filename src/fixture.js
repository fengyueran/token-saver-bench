import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getTask } from './tasks.js';

export const koaCommit = '824c1cf8de9a91a2941973b25dc8a3d3029b9e4f';
export const validationGuard =
  "    if (typeof fn !== 'function') { throw new TypeError('middleware must be a function!') }\n";

export async function prepareFixture(source, destination, task) {
  const definition = getTask(task);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
  if (commit !== koaCommit) throw new Error('Fixture commit mismatch');
  const locks = JSON.parse(
    await readFile(
      new URL('../config/sources-lock.json', import.meta.url),
      'utf8',
    ),
  );
  const lockHash = createHash('sha256')
    .update(await readFile(path.join(source, 'package-lock.json')))
    .digest('hex');
  if (lockHash !== locks.fixture.dependencyLockSha256)
    throw new Error('Fixture dependency lock mismatch');
  await readFile(path.join(source, 'dist/koa.mjs'));
  await mkdir(destination, { recursive: false });
  await cp(source, destination, {
    recursive: true,
    filter: (name) => !['.git', '.codegraph'].includes(path.basename(name)),
  });
  await mkdir(path.join(destination, '.bench'), { recursive: true });
  await cp(
    new URL('../verifiers/loopback.cjs', import.meta.url),
    path.join(destination, '.bench/loopback.cjs'),
  );
  const file = path.join(destination, 'lib/application.js');
  const original = execFileSync('git', ['show', 'HEAD:lib/application.js'], {
    cwd: source,
    encoding: 'utf8',
  });
  let mutation = null;
  let content = original;
  if (task === 'repair-validation') {
    if (original.split(validationGuard).length !== 2)
      throw new Error('Mutation target changed');
    content = original.replace(validationGuard, '');
    mutation = 'Removed Application.use input validation';
  }
  if (task === 'repair-state') {
    const target = '    context.state = {}';
    if (original.split(target).length !== 2)
      throw new Error('Mutation target changed');
    content = original.replace(
      target,
      '    context.state = this.context.state || (this.context.state = {})',
    );
    mutation = 'Reused application prototype state between requests';
  }
  await writeFile(file, content);
  return {
    commit,
    mutation,
    kind: definition.kind,
  };
}

export const validationPrompt = `Fix this regression in the Koa repository: app.use currently accepts invalid middleware values and fails later during request handling. Restore immediate validation: reject every non-function with TypeError and message "middleware must be a function!", without changing the middleware list. Preserve support for ordinary and async functions, registration order and chaining. Add focused regression coverage and run relevant tests. Do not install dependencies or modify package manifests. Work only inside this repository. End with a summary of the change and the tests you ran.`;
