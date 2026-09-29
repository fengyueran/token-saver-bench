import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildArgs } from '../src/run-case.js';
const config = JSON.parse(
  await readFile(new URL('../config/experiment.json', import.meta.url), 'utf8'),
);
test('formal arms preserve isolation, use writable workspace and share test environment', () => {
  const prepared = {
    instructions: 'Keep "exact"\ncontent',
    overrides: ['features.hooks=true'],
  };
  const args = buildArgs(config, '/tmp/work with spaces', prepared, 'rtk');
  assert.equal(args.at(-1), '-');
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('sandbox_workspace_write.network_access=true'));
  assert.ok(
    args.includes(
      'shell_environment_policy.set.XDG_CACHE_HOME="/tmp/work with spaces/.cache"',
    ),
  );
  assert.ok(
    args.includes('developer_instructions="Keep \\"exact\\"\\ncontent"'),
  );
  assert.ok(args.includes('--dangerously-bypass-hook-trust'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  const baseline = buildArgs(
    config,
    '/tmp/work',
    { instructions: '', overrides: [] },
    'baseline',
  );
  assert.ok(!baseline.includes('--dangerously-bypass-hook-trust'));
});
