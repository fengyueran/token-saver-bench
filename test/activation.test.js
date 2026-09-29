import test from 'node:test';
import assert from 'node:assert/strict';
import { auditActivation } from '../src/activation.js';

test('installed tools and failed calls cannot count as observed activation', () => {
  for (const arm of ['rtk', 'codegraph', 'headroom'])
    assert.equal(auditActivation(arm).status, 'not-observed');
  const events = JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call',
      server: 'codegraph',
      status: 'failed',
      error: 'down',
    },
  });
  assert.equal(auditActivation('codegraph', { events }).status, 'not-observed');
});

test('only actual hook rewrites, completed MCP calls and proxy transformations count', () => {
  assert.equal(
    auditActivation('rtk', {
      hookEvents: '{"rewritten":false}\n{"rewritten":true}',
    }).rewrittenCommands,
    1,
  );
  const events = JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call',
      server: 'codegraph',
      status: 'completed',
      error: null,
    },
  });
  assert.equal(auditActivation('codegraph', { events }).status, 'observed');
  assert.equal(
    auditActivation('headroom', {
      proxyEvents: '{"transforms_applied":["compress"],"error":null}',
    }).status,
    'observed',
  );
  assert.equal(
    auditActivation('caveman', { instructions: 'original skill' }).status,
    'instructions-injected',
  );
});
