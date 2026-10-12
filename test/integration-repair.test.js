import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildHeadroomSubscriptionLaunch, prepareRtkTrustedSession } from '../src/integration-repair.js';

test('Headroom subscription route uses its original named provider and OAuth, without changing model', () => {
  const launch = buildHeadroomSubscriptionLaunch(32123, { CODEX_HOME: '/private/state', PATH: '/bin' });
  assert.ok(launch.args.includes('model_provider="headroom"'));
  assert.ok(launch.args.includes('model_providers.headroom.requires_openai_auth=true'));
  assert.ok(launch.args.includes('model_providers.headroom.base_url="http://127.0.0.1:32123/v1"'));
  assert.ok(launch.args.includes('model_providers.headroom.wire_api="responses"'));
  assert.equal(launch.env.CODEX_HOME, '/private/state');
  assert.equal(launch.args.includes('-m'), false);
  assert.throws(() => buildHeadroomSubscriptionLaunch(0, {}), /port/);
  assert.throws(() => buildHeadroomSubscriptionLaunch(3000, {}), /CODEX_HOME/);
});

test('RTK trusted session writes only fresh sibling private state and retains original hook', async t => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-repair-'));
  t.after(() => fs.rm(output, { recursive: true, force: true }));
  const workspace = path.join(output, 'workspace'), state = path.join(output, 'state');
  await fs.mkdir(workspace); await fs.mkdir(state, {mode:0o700});
  const adapter = await prepareRtkTrustedSession({workspace, state, binaryPath:path.join(process.cwd(), '.cache/source-build-2026-10-08/rtk-target/release/rtk')});
  assert.match(await fs.readFile(path.join(state, 'config.toml'), 'utf8'), /trust_level = "trusted"/);
  assert.equal((await fs.stat(path.join(state, 'config.toml'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(adapter.hooksPath, 'utf8')).hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(adapter.env.CODEX_HOME, state);
  assert.equal(adapter.hostArgs.includes('--dangerously-bypass-hook-trust'), true);
  await assert.rejects(prepareRtkTrustedSession({workspace,state,binaryPath:adapter.binaryPath}), /config already exists/);
  await assert.rejects(prepareRtkTrustedSession({workspace,state:path.join(os.homedir(),'.codex'),binaryPath:adapter.binaryPath}), /sibling private/);
});

test('Headroom launch places provider overrides in exec scope alongside reasoning settings', async () => {
  const { buildHeadroomRepairArgs } = await import('../src/integration-repair.js');
  const launch = buildHeadroomSubscriptionLaunch(32123, {CODEX_HOME:'/private/state'});
  const args = buildHeadroomRepairArgs(launch);
  assert.equal(args[0], '--no-daemon');
  assert.equal(args[1], 'exec');
  assert.ok(args.indexOf('model_provider="headroom"') > args.indexOf('exec'));
  assert.ok(args.includes('gpt-5.6-sol'));
  assert.ok(args.includes('model_reasoning_effort="medium"'));
});

test('Responses audit pairs typed tool outputs by call id and proves reversibility without estimated token claims', async () => {
  const { summarizeHeadroomResponses } = await import('../src/integration-repair.js');
  const original = 'PASS\nPASS\nERROR 42\n', compressed = 'PASS\n... (repeated 2 times)\nERROR 42\n';
  const row = {event:'codex_compression_payload_result', request_id:'r', pass_id:'p', model:'gpt-5.6-sol', modified:true, transforms:['code_aware'], input_payload:{input:[{type:'custom_tool_call_output',call_id:'a',output:original},{type:'reasoning',encrypted_content:'opaque'}]}, output_payload:{input:[{type:'custom_tool_call_output',call_id:'a',output:compressed},{type:'reasoning',encrypted_content:'opaque'}]}};
  const report = summarizeHeadroomResponses([row]);
  assert.equal(report.activationStatus, 'transformed');
  assert.equal(report.requests[0].toolOutputs[0].originalRecovered, true);
  assert.equal(report.requests[0].opaqueItemsPreserved, true);
  assert.equal(report.supplierUsage, null);
  assert.equal(report.actualCostUsd, null);
  const missing = structuredClone(row); missing.output_payload.input[0].call_id='other';
  assert.equal(summarizeHeadroomResponses([missing]).activationStatus, 'no-transformation-proved');
  assert.equal(summarizeHeadroomResponses([{...row, model:'other'}]).activationStatus, 'no-transformation-proved');
  assert.throws(() => summarizeHeadroomResponses(null), /array/);
});

test('Responses output text parts remain paired while nontext output and call metadata are protected', async () => {
  const {summarizeHeadroomResponses} = await import('../src/integration-repair.js');
  const body = {input:[{type:'custom_tool_call_output',call_id:'x',status:'completed',output:[{type:'input_text',text:'PASS\nPASS\n'},{type:'image',url:'opaque'}]}]};
  const after = structuredClone(body); after.input[0].output[0].text='PASS\n... (repeated 2 times)\n';
  const row={event:'codex_compression_payload_result',model:'gpt-5.6-sol',input_payload:body,output_payload:after};
  assert.equal(summarizeHeadroomResponses([row]).activationStatus, 'transformed');
  const broken=structuredClone(row);broken.output_payload.input[0].output[1].url='different';
  assert.equal(summarizeHeadroomResponses([broken]).activationStatus,'no-transformation-proved');
});
