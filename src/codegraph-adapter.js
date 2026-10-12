import path from 'node:path';
import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execute } from './process.js';
import { assertScenarioState } from './scenario-state.js';
import { homedir } from 'node:os';
import {prepareDecisionShell,quoteDecisionShell} from './decision-shell.js';

const commit = '290e03f7bc582b8726a104428f39bc178bac30bd';
const sourceRelative = '.cache/offline-integration-2026-10-08-9f665fbf/codegraph-source';
const toolEnv = Object.freeze({ CODEGRAPH_TELEMETRY: '0', DO_NOT_TRACK: '1',
  CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_NO_WATCH: '1', CODEGRAPH_NO_UPDATE_CHECK: '1',
  CODEGRAPH_NO_INSTALL_REFRESH: '1', CODEGRAPH_NO_PROMPT_HOOK: '1' });

async function installPrivateCodexTarget(source, state, workspace, env) {
  const protectedRoots = [path.join(homedir(), '.codex'), process.env.CODEX_HOME].filter(Boolean);
  if (protectedRoots.some(root => state === root || state.startsWith(root + path.sep)))
    throw new Error('Private CodeGraph installation cannot target user configuration');
  const script = "const {codexTarget}=require(process.argv[1]);console.log(JSON.stringify(codexTarget.install('global',{})));";
  const start = performance.now();
  const result = await execute(process.execPath, ['-e', script, path.join(source, 'dist/installer/targets/codex.js')],
    { cwd: workspace, env, timeoutMs: null });
  if (result.code !== 0 || result.inputError) throw new Error('Private official Codex target installation failed');
  const installation = JSON.parse(result.stdout);
  if (!installation.files?.length || installation.files.some(file => !file.path.startsWith(state + path.sep)))
    throw new Error('Private installer write scope mismatch');
  const instructionFile = path.join(state, 'AGENTS.md');
  return { installation, installDurationMs: performance.now() - start, instructionFile,
    instructionSha256: createHash('sha256').update(await readFile(instructionFile)).digest('hex') };
}

async function pinPrivateCli(state, cli, workspace) {
  const shell = await prepareDecisionShell(workspace, state);
  const shim = path.join(state, 'bin/codegraph');
  await writeFile(shim, `#!/bin/sh\nexec ${quoteDecisionShell(process.execPath)} ${quoteDecisionShell(cli)} "$@"\n`, { mode: 0o700, flag: 'wx' });
  return shell.env;
}

async function sourceEvidence(source, cli) {
  const hash = createHash('sha256').update(await readFile(cli)).digest('hex');
  const lockHash = createHash('sha256').update(await readFile(path.join(source, 'package-lock.json'))).digest('hex');
  if (hash !== '9add647d1474ad2230f117309c277da1519da6f0d22662a182831000d9566003' ||
    lockHash !== '51f3b7f40b2e555ba17ca4df8ac99c02ce4871848a69b165d242b09d8c32c649')
    throw new Error('CodeGraph fixed build or lockfile mismatch');
  const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (metadata.version !== '1.6.0') throw new Error('CodeGraph version mismatch');
  return { commit, version: metadata.version, cli,
    cliSha256: hash, lockfileSha256: lockHash, provenance: 'previous fixed-source archive build; pinned CLI and lock hashes' };
}

export async function prepareCodeGraphAdapter(root, workspace, state, options = {}) {
  const integration = options.integration ?? 'historical';
  if (!['historical', 'native'].includes(integration)) throw new Error('Unknown CodeGraph integration');
  const native = integration === 'native';
  if (![root, workspace, state].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw new Error('Absolute adapter paths required');
  await assertScenarioState(state);
  const info = await lstat(workspace);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('CodeGraph workspace must be a real directory');
  const source = path.join(root, sourceRelative);
  const cli = path.join(source, 'dist/bin/codegraph.js');
  const evidence = await sourceEvidence(source, cli);
  const adapterEnv = { ...toolEnv, CODEGRAPH_NO_WATCH: native ? '0' : '1' };
  const env = { ...process.env, ...adapterEnv, CODEX_HOME: state };
  if (native) {
    Object.assign(evidence, await installPrivateCodexTarget(source, state, workspace, env));
    Object.assign(env, await pinPrivateCli(state, cli, workspace));
    evidence.privateCli = path.join(state, 'bin/codegraph');
  }
  const indexStarted = performance.now();
  const indexed = await execute(process.execPath, [cli, 'init', '-i', '-y', workspace],
    { cwd: workspace, env, timeoutMs: null });
  evidence.indexDurationMs = performance.now() - indexStarted;
  evidence.indexStdout = indexed.stdout;
  evidence.indexStderr = indexed.stderr;
  evidence.indexExitCode = indexed.code;
  if (indexed.code !== 0 || indexed.inputError) throw new Error('CodeGraph fixture indexing failed');
  const args = ['-c', `mcp_servers.codegraph.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.codegraph.args=${JSON.stringify([cli, 'serve', '--mcp', ...(native ? [] : ['--no-watch']), '--path', workspace])}`,
    '-c', `mcp_servers.codegraph.env={${Object.entries(adapterEnv).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',')}}`,
    '-c', 'mcp_servers.codegraph.enabled=true'];
  if (native) args.push('-c', `shell_environment_policy.set.PATH=${JSON.stringify(env.PATH)}`,
    '-c', `shell_environment_policy.set.ZDOTDIR=${JSON.stringify(env.ZDOTDIR)}`);
  return { args, env, instructions: native ? '' : 'Use the real codegraph_explore MCP tool for structural code exploration. Every call requires a non-empty query string; projectPath optionally selects an indexed project and cannot replace query; path is not an advertised argument. Prefer indexed exploration when locating symbols or tracing related code. Do not claim activation if a call fails.', evidence: { ...evidence, integration, setupTiming: 'outside-agent',
    transport: 'stdio', indexedWorkspace: workspace, activationStatus: 'requires-real-trace',
    exposedTool: native ? 'all-advertised-tools' : 'codegraph_explore', automaticSync: native,
    automaticSyncEvidence: native ? 'configured-not-yet-runtime-verified' : 'disabled' } };
}

export function codeGraphActivation(jsonl, pinned = null) {
  const events = jsonl.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' &&
      event.item.server === 'codegraph' && event.item.tool === 'codegraph_explore').map(event => event.item);
  const successful = calls.filter(call => call.status === 'completed' && !call.error &&
    Array.isArray(call.result?.content) && call.result.content.length > 0 && !call.result.isError);
  const cliCalls = pinned?.privateCli && pinned.cliSha256 === '9add647d1474ad2230f117309c277da1519da6f0d22662a182831000d9566003' ? events
    .filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution' &&
      /(?:^|[\s;'"])codegraph\s+explore\s/.test(event.item.command ?? '')).map(event => event.item) : [];
  const cliSuccess = cliCalls.filter(call => call.status === 'completed' && call.exit_code === 0 && /^\*\*Exploration:/m.test(call.aggregated_output ?? ''));
  return { status: successful.length || cliSuccess.length ? 'activated' : calls.length || cliCalls.length ? 'failed' : 'missing',
    callCount: calls.length + cliCalls.length, successfulCount: successful.length + cliSuccess.length, failedCount: calls.length + cliCalls.length - successful.length - cliSuccess.length,
    mcpCallCount: calls.length, cliCallCount: cliCalls.length, cliCalls, cliEvidence: cliCalls.length ? 'observed-command-under-pinned-shell-environment' : null,
    failureReasons: calls.filter(call => !successful.includes(call)).map(call =>
      call.error?.message ?? (typeof call.error === 'string' ? call.error : null) ??
      call.result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ??
      'Missing or unsuccessful MCP result'), calls };
}
