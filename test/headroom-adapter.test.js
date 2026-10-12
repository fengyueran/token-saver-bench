import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeadroomCodexLaunch, summarizeHeadroomRequests } from '../src/headroom-adapter.js';

test('Headroom redirects only native OpenAI provider in process; requires loopback', () => {
  const result = buildHeadroomCodexLaunch(32123, { CODEX_HOME: '/private/session', PATH: '/bin' });
  assert.deepEqual(result.args, ['-c', 'openai_base_url="http://127.0.0.1:32123/v1"']);
  assert.equal(result.env.OPENAI_BASE_URL, 'http://127.0.0.1:32123/v1');
  assert.equal(result.env.CODEX_HOME, '/private/session');
  assert.throws(() => buildHeadroomCodexLaunch(0, {}), /port/);
  assert.throws(() => buildHeadroomCodexLaunch(3000, {}), /CODEX_HOME/);
});

test('actual request transformation evidence preserves missing values and raw recovery uncertainty', () => {
  const rows = [{ request_id: 'a', endpoint: '/v1/responses', transforms_applied: ['smart_crusher'], request_messages: [{ role: 'tool', tool_call_id: 'x', content: 'abcde' }], compressed_messages: [{ role: 'tool', tool_call_id: 'x', content: 'abc' }] }, { request_id: 'b', endpoint: '/v1/responses', transforms_applied: [] }];
  const result = summarizeHeadroomRequests(rows);
  assert.equal(result.requests[0].toolOutputs[0].originalCharacters, 5);
  assert.equal(result.requests[0].toolOutputs[0].forwardedCharacters, 3);
  assert.equal(result.requests[0].toolOutputs[0].rewritten, true);
  assert.equal(result.requests[1].toolOutputs, null);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.originalRecovered, null);
  assert.equal(result.activationStatus, 'transformed');
  assert.equal(summarizeHeadroomRequests([]).activationStatus, 'no-requests');
  assert.throws(() => summarizeHeadroomRequests(null), /array/);
});

test('dropped tool output is unknown instead of paired with another call', () => {
  const result = summarizeHeadroomRequests([{ request_messages: [{role:'tool',tool_call_id:'missing',content:'keep me'}], compressed_messages:[{role:'tool',tool_call_id:'different',content:'other'}] }]);
  assert.equal(result.requests[0].toolOutputs[0].forwardedCharacters, null);
  assert.equal(result.requests[0].toolOutputs[0].rewritten, null);
});

test('formal Headroom use rejects inactive live calibration instead of fallback', async () => {
  const { requireHeadroomActivation } = await import('../src/headroom-adapter.js');
  assert.throws(() => requireHeadroomActivation({status:'unsupported-or-inactive', modelInvoked:true}), /not calibrated/);
});

test('activation gate requires fixed source evidence and completed secret cleanup', async () => {
  const { requireHeadroomActivation } = await import('../src/headroom-adapter.js');
  const report = {status:'activation-calibrated', modelInvoked:true, evidence:{sourceCommit:'d13e1966f820220b482a33c30bde1e926743939a', activationStatus:'transformed'}, authenticationCopyRemoved:true, servicesClosed:true};
  assert.deepEqual(requireHeadroomActivation(report), report.evidence);
  assert.throws(() => requireHeadroomActivation({...report, authenticationCopyRemoved:false}), /not calibrated/);
  assert.throws(() => requireHeadroomActivation({...report, evidence:{...report.evidence, sourceCommit:'unknown'}}), /not calibrated/);
});

test('formal offline profile preserves native recent-turn guards; unprotected calibration stays separate', async () => {
 const {buildHeadroomServerScript}=await import('../src/headroom-adapter.js');
 const source=buildHeadroomServerScript('native-offline');
 assert.match(source,/keep_last_turns=4,protect_recent=None/);
 assert.match(source,/ccr_handle_responses=True/);
 assert.match(source,/disable_kompress=True/);
 assert.match(buildHeadroomServerScript('calibration-unprotected'),/keep_last_turns=0,protect_recent=0/);
 assert.throws(()=>buildHeadroomServerScript('other'),/profile/);
});
