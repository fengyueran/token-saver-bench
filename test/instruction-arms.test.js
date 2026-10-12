import test from 'node:test';
import assert from 'node:assert/strict';
import { instructionArm } from '../src/arms.js';
import { buildRealDevelopmentArgs } from '../src/real-development.js';

test('Caveman uses the fixed full skill body and isolated instruction argument', async () => {
  const root = new URL('../', import.meta.url).pathname;
  const prepared = await instructionArm(root, 'caveman');
  assert.equal(prepared.evidence.commit, '2fd153c67988e980fb0b2455c90832159a6a5a25');
  assert.equal(prepared.evidence.instructionSha256, 'cae24e41e98e9c6557417d98bf9dc21b598e71e6e7b093a00e287338892183c6');
  assert.equal(prepared.evidence.behavioralCompliance, 'requires-trace-review');
  assert.ok(!prepared.instructions.startsWith('---'));
  const args = buildRealDevelopmentArgs('/tmp/caveman-offline', 'caveman', prepared.instructions);
  assert.ok(args.includes(`developer_instructions=${JSON.stringify(prepared.instructions)}`));
  assert.throws(() => buildRealDevelopmentArgs('/tmp/caveman-offline', 'caveman'), /instructions missing/);
});
