import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildNativeIntegrationArgs, reviewNativeActivation } from '../src/native-integration.js';

test('native comparison uses isolated config and no forced tool instructions', () => {
  const paths = ['/global/one/SKILL.md', '/global/two/SKILL.md'];
  const baseline = buildNativeIntegrationArgs('/private/workspace', 'baseline', paths);
  const pony = buildNativeIntegrationArgs('/private/workspace', 'ponytail', paths);
  const cave = buildNativeIntegrationArgs('/private/workspace', 'caveman', paths);
  for (const args of [baseline, pony, cave]) {
    assert.ok(args.includes('skills.include_instructions=false'));
    assert.ok(args.includes('model_reasoning_effort="medium"'));
    assert.ok(!args.some(x => x.startsWith('developer_instructions=')));
    assert.ok(!args.includes('--ephemeral'));
    assert.ok(args.some(x => x.includes('enabled=false') && x.includes('/global/one/SKILL.md')));
  }
  assert.ok(pony.includes('features.plugins=true'));
  assert.ok(pony.includes('features.hooks=true'));
  assert.ok(!pony.includes('--ignore-user-config'));
  assert.ok(cave.includes('--ignore-user-config'));
  assert.ok(!cave.includes('features.plugins=true'));
  assert.deepEqual(paths, ['/global/one/SKILL.md', '/global/two/SKILL.md']);
  assert.throws(() => buildNativeIntegrationArgs('/private/workspace', 'unknown', paths));
  assert.throws(() => buildNativeIntegrationArgs('/private/workspace', 'baseline', ['relative']));
});

const row = (role, text, kind = 'hooks.additional_context') => JSON.stringify({ type: 'response_item', payload: {
  role, content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { content_item_kinds: [kind] },
} });
test('activation requires the exact native instruction and excludes global catalogs', () => {
  const body = 'Fixed original instructions';
  const sha256 = createHash('sha256').update(body).digest('hex');
  assert.equal(reviewNativeActivation(row('developer', body), 'ponytail', { sha256 }).status, 'activated');
  assert.equal(reviewNativeActivation(row('assistant', body), 'ponytail', { sha256 }).status, 'missing');
  assert.equal(reviewNativeActivation(row('developer', body + '!'), 'ponytail', { sha256 }).status, 'missing');
  assert.equal(reviewNativeActivation(row('developer', body, 'plain'), 'ponytail', { sha256 }).status, 'missing');
  const contaminated = [row('developer', body), row('developer', '<skills_instructions>catalog</skills_instructions>')].join('\n');
  assert.equal(reviewNativeActivation(contaminated, 'ponytail', { sha256 }).isolationPassed, false);
});

test('explicit native Skill must contain the complete source in the selected wrapper', () => {
  const skill = '---\nname: caveman\n---\nExact source body';
  const selected = `<skill>\n<name>caveman</name>\n<path>/private/workspace/.agents/skills/caveman/SKILL.md</path>\n${skill}\n</skill>`;
  const expected = { skill, skillPath: '/private/workspace/.agents/skills/caveman/SKILL.md' };
  assert.equal(reviewNativeActivation(row('user', selected, 'skills.selected_skill_instructions'), 'caveman', expected).status, 'activated');
  assert.equal(reviewNativeActivation(row('user', '$caveman full'), 'caveman', expected).status, 'missing');
  assert.equal(reviewNativeActivation(row('developer', selected), 'caveman', expected).status, 'missing');
  assert.equal(reviewNativeActivation(row('user', selected, 'skills.selected_skill_instructions'), 'caveman', { ...expected, skillPath: '/wrong/SKILL.md' }).status, 'missing');
});
