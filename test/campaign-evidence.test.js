import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyCampaignEvidence } from '../src/campaign-evidence.js';

test('formal gate references bind private evidence bytes and reject missing, changed or escaping files', async () => {
 const root = await mkdtemp(path.join(tmpdir(), 'campaign-evidence-'));
 await mkdir(path.join(root, 'runs'));
 const content = '{"reviewed":true}';
 const file = path.join(root, 'runs', 'proof.json');
 await writeFile(file, content);
 const reference = `runs/proof.json#${createHash('sha256').update(content).digest('hex')}`;
 const input = { source: 'verified-evidence', environments: { codex: { metering: { status: 'ready', evidence: reference } } } };
 assert.deepEqual(await verifyCampaignEvidence(root, input), [reference]);
 await writeFile(file, 'changed');
 await assert.rejects(verifyCampaignEvidence(root, input), /hash/);
 await assert.rejects(verifyCampaignEvidence(root, { evidence: '../outside#' + 'a'.repeat(64) }), /reference/);
 await assert.rejects(verifyCampaignEvidence(root, { evidence: 'runs/missing.json#' + 'a'.repeat(64) }), /ENOENT/);
 await symlink(file, path.join(root, 'runs', 'link.json'));
 await assert.rejects(verifyCampaignEvidence(root, { evidence: 'runs/link.json#' + 'a'.repeat(64) }), /symbolic/i);
 await assert.rejects(verifyCampaignEvidence(root, { evidence: 'unverified words' }), /reference/);
});
