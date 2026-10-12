import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const RTK_BINARY_SHA256 = '47fb447178df42a2cfb65640724b64f1956c6f8780655ac84e597af49ac7e51c';
export const RTK_SOURCE_COMMIT = '7efbaef462911f0fcb112c8a01025dc90f280617';
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

function hookLogger(binaryPath, logPath) {
  return `const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const input = fs.readFileSync(0, 'utf8');
const payload = JSON.parse(input);
const phase = process.argv[2];
const result = phase === 'pre' ? spawnSync(${JSON.stringify(binaryPath)}, ['hook', 'codex'], { input, encoding: 'utf8', env: process.env }) : { status: 0, stdout: '', stderr: '' };
let response = null;
if (result.stdout?.trim()) response = JSON.parse(result.stdout);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ phase, payload, response, exitCode: result.status, stderr: result.stderr || '', timestamp: new Date().toISOString() }) + '\\n', { mode: 0o600 });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
`;
}

export async function prepareRtkAdapter({ workspace, binaryPath }) {
  if (![workspace, binaryPath].every((value) => typeof value === 'string' && path.isAbsolute(value)))
    throw new Error('RTK paths must be absolute');
  const workspaceStat = await fs.lstat(workspace);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) throw new Error('RTK workspace must be a real directory');
  const digest = createHash('sha256').update(await fs.readFile(binaryPath)).digest('hex');
  if (digest !== RTK_BINARY_SHA256) throw new Error('RTK binary hash mismatch');
  const hooksDirectory = path.join(workspace, '.codex');
  try {
    const stat = await fs.lstat(hooksDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid .codex directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(hooksDirectory, { mode: 0o700 });
  }
  const hooksPath = path.join(hooksDirectory, 'hooks.json');
  if (await fs.lstat(hooksPath).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error)))
    throw new Error('Project hooks already exists');
  const directory = path.join(workspace, '.rtk-adapter');
  await fs.mkdir(directory, { mode: 0o700 });
  const loggerPath = path.join(directory, 'hook-logger.cjs');
  const logPath = path.join(directory, 'hook-events.jsonl');
  await fs.writeFile(loggerPath, hookLogger(binaryPath, logPath), { flag: 'wx', mode: 0o600 });
  await fs.symlink(binaryPath, path.join(directory, 'rtk'));
  const hooks = Object.fromEntries([['PreToolUse', 'pre'], ['PostToolUse', 'post']].map(([event, phase]) =>
    [event, [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(loggerPath)} ${phase}` }] }]]));
  await fs.writeFile(hooksPath, JSON.stringify({ hooks }, null, 2), { flag: 'wx', mode: 0o600 });
  return { directory, loggerPath, logPath, hooksPath, binaryPath, binarySha256: digest,
    env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, RTK_DB_PATH: path.join(directory, 'history.sqlite') },
    hostArgs: ['--enable', 'hooks', '--dangerously-bypass-hook-trust', '-c', `projects.${JSON.stringify(workspace)}.trust_level="trusted"`], formalReady: false };
}

export function auditRtkHooks(events) {
  if (!Array.isArray(events)) throw new Error('Hook events must be an array');
  const records = events.filter((event) => event.phase === 'pre').map((event) => {
    const originalCommand = event.payload?.tool_input?.command ?? null;
    const rewrittenCommand = event.response?.hookSpecificOutput?.updatedInput?.command ?? null;
    const id = event.payload?.tool_use_id;
    const post = typeof id === 'string' ? events.find((candidate) => candidate.phase === 'post' && candidate.payload?.tool_use_id === id) : null;
    const executedCommand = post?.payload?.tool_input?.command ?? null;
    const response = post?.payload?.tool_response ?? null;
    const exitCode = Number.isSafeInteger(response?.exit_code) ? response.exit_code : null;
    const verified = event.exitCode === 0 && typeof originalCommand === 'string' &&
      typeof rewrittenCommand === 'string' && rewrittenCommand !== originalCommand && executedCommand === rewrittenCommand;
    return { toolUseId: id ?? null, originalCommand, rewrittenCommand, executedCommand, exitCode, output: response, verified };
  });
  return { automaticHostIntegrationVerified: records.some((record) => record.verified), records, formalReady: false,
    actualCostUsd: null, usage: null };
}

export function assertRtkActivation(audit) {
  if (audit?.automaticHostIntegrationVerified !== true) throw new Error('RTK automatic host integration not verified');
}
