import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../src/process.js';
import { prepareCodeGraphAdapter, codeGraphActivation } from '../src/codegraph-adapter.js';

const root = path.resolve('.');
test('CodeGraph prepares a private fixture index and explicit stdio MCP override', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'codegraph-adapter-'));
  const workspace = path.join(output, 'workspace');
  const state = path.join(output, 'codex-home');
  await mkdir(workspace); await mkdir(state, { mode: 0o700 });
  await writeFile(path.join(workspace, 'example.py'), 'def download():\n    return 42\n');
  try {
    const adapter = await prepareCodeGraphAdapter(root, workspace, state);
    assert.equal(adapter.evidence.commit, '290e03f7bc582b8726a104428f39bc178bac30bd');
    assert.equal(adapter.evidence.version, '1.6.0');
    assert.equal(adapter.env.CODEX_HOME, state);
    assert.match(adapter.instructions, /non-empty query/);
    assert.equal(adapter.env.CODEGRAPH_NO_DAEMON, '1');
    assert.ok(adapter.args.includes(`mcp_servers.codegraph.command=${JSON.stringify(process.execPath)}`));
    assert.ok(adapter.args.some(arg => arg.includes('serve') && arg.includes('--no-watch') && arg.includes(workspace)));
    assert.match(adapter.evidence.indexStdout, /Index|index/);
    await chmod(state, 0o755);
    await assert.rejects(prepareCodeGraphAdapter(root, workspace, state), /private directory/);
    await assert.rejects(prepareCodeGraphAdapter('relative', workspace, state), /Absolute/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('CodeGraph activation requires genuine successful MCP completed evidence', () => {
  const event = { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'codegraph',
    tool: 'codegraph_explore', status: 'completed', arguments: { query: 'download' },
    result: { content: [{ type: 'text', text: 'def download()' }] }, error: null } };
  assert.equal(codeGraphActivation(JSON.stringify(event)).status, 'activated');
  assert.equal(codeGraphActivation('').status, 'missing');
  const failed = codeGraphActivation(JSON.stringify({ ...event, item: { ...event.item, status: 'failed', result: { content: [{ type: 'text', text: 'Error: query must be a non-empty string' }] } } }));
  assert.deepEqual(failed.failureReasons, ['Error: query must be a non-empty string']);
  assert.equal(codeGraphActivation(JSON.stringify({ ...event, item: { ...event.item, status: 'failed', error: 'error' } })).status, 'failed');
  assert.equal(codeGraphActivation(JSON.stringify({ ...event, item: { ...event.item, result: null } })).status, 'failed');
  assert.equal(codeGraphActivation(JSON.stringify({ ...event, item: { ...event.item, tool: 'other' } })).status, 'missing');
  assert.throws(() => codeGraphActivation('{'), /JSON/);
});

test('native CodeGraph mode enables project watching without changing historical integration', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'codegraph-native-'));
  const workspace = path.join(output, 'workspace'), state = path.join(output, 'codex-home');
  await mkdir(workspace); await mkdir(state, { mode: 0o700 });
  await writeFile(path.join(workspace, 'example.py'), 'def download():\n    return 42\n');
  try {
    const adapter = await prepareCodeGraphAdapter(root, workspace, state, { integration: 'native' });
    assert.equal(adapter.evidence.automaticSync, true);
    assert.equal(adapter.env.CODEGRAPH_NO_WATCH, '0');
    assert.equal(adapter.instructions, '');
    const shell = await execute('/bin/zsh', ['-lc', 'command -v codegraph; codegraph --version'], { cwd: workspace, env: adapter.env, timeoutMs: null });
    assert.equal(shell.code, 0);
    assert.equal(shell.stdout.trim().split('\n')[0], path.join(state, 'bin/codegraph'));
    assert.match(shell.stdout, /1\.6\.0/);
    assert.ok(adapter.args.some(arg => arg.startsWith('shell_environment_policy.set.PATH=')));
    const query = await execute('/bin/zsh', ['-lc', 'codegraph explore download'], { cwd: workspace, env: adapter.env, timeoutMs: null });
    assert.equal(query.code, 0);
    assert.match(query.stdout, /download/);
    assert.ok(!adapter.args.some(arg => arg.includes('--no-watch')));
    assert.ok(adapter.evidence.indexDurationMs >= 0);
    assert.match(await readFile(path.join(state,'AGENTS.md'),'utf8'), /<!-- CODEGRAPH_START -->/);
    assert.ok(adapter.evidence.installation.files.every(file=>file.path.startsWith(state+path.sep)));
    await assert.rejects(prepareCodeGraphAdapter(root, workspace, state, { integration: 'unknown' }), /integration/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('native CLI activation remains separate from MCP and requires pinned setup plus successful exploration',()=>{
 const event={type:'item.completed',item:{type:'command_execution',command:"/bin/zsh -lc 'codegraph explore download'",status:'completed',exit_code:0,aggregated_output:'**Exploration: download**\nFound 1 symbols across 1 file.'}};
 const pin={privateCli:'/private/state/bin/codegraph',cliSha256:'9add647d1474ad2230f117309c277da1519da6f0d22662a182831000d9566003'};
 assert.equal(codeGraphActivation(JSON.stringify(event)).status,'missing');
 const result=codeGraphActivation(JSON.stringify(event),pin);assert.equal(result.status,'activated');assert.equal(result.cliCallCount,1);assert.equal(result.mcpCallCount,0);
 assert.equal(codeGraphActivation(JSON.stringify({...event,item:{...event.item,exit_code:1}}),pin).status,'failed');
 assert.equal(codeGraphActivation(JSON.stringify(event),{...pin,cliSha256:'wrong'}).status,'missing');
});
