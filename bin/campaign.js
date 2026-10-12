import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCampaignPlan, freezeCampaignPlan } from '../src/campaign-plan.js';
import { verifyCampaignEvidence } from '../src/campaign-evidence.js';
import { preflightRealDevelopment } from '../src/real-development.js';
import { createFormalCodexAdapter } from '../src/formal-codex-adapter.js';
import { createCampaignAdapter, createCampaign, runCampaign } from '../src/campaign-runner.js';
import { buildCampaignReport } from '../src/campaign-report.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const [mode, input, ...extra] = process.argv.slice(2);
if (!['plan', 'start', 'resume', 'report'].includes(mode) || !input || extra.length)
 throw new Error('Usage: node bin/campaign.js plan|start <private-readiness.json> | resume|report <campaign-id>');
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function privateJson(file) {
 const absolute = path.resolve(file);
 const relative = path.relative(path.join(root, 'runs'), absolute);
 if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Input must be under private runs');
 let current = path.join(root, 'runs');
 for (const part of relative.split(path.sep)) {
  current = path.join(current, part);
  const stat = await lstat(current);
  if (stat.isSymbolicLink()) throw new Error('Symbolic input path rejected');
 }
 const stat = await lstat(absolute);
 if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('Private owned input required');
 return JSON.parse(await readFile(absolute, 'utf8'));
}
async function adapterFor(plan) {
 await verifyCampaignEvidence(root, plan.readiness);
 return createCampaignAdapter({ scope: 'formal-host-adapter-factory', create: async () => createFormalCodexAdapter({ root, plan }) });
}
async function identityCheck(readiness) {
 await verifyCampaignEvidence(root, readiness);
 const preflight = await preflightRealDevelopment(root);
 if (!preflight.ready) throw new Error('Codex preflight failed');
 return preflight.identityHash;
}
async function report(directory, plan) {
 const results = [], incidents = [];
 for (const position of plan.positions) {
  for (const [name, list] of [['result.json', results], ['call-error.json', incidents]]) {
   try { list.push(await privateJson(path.join(directory, 'positions', position.id, name))); }
   catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
 }
 const value = buildCampaignReport(plan, results, incidents);
 await writeFile(path.join(directory, `report-${Date.now()}.json`), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
 return value;
}
if (mode === 'plan' || mode === 'start') {
 const readiness = await privateJson(input);
 const candidate = createCampaignPlan(readiness);
 await verifyCampaignEvidence(root, readiness);
 if (mode === 'plan') print(candidate);
 else {
  const plan = freezeCampaignPlan(candidate, await identityCheck(readiness));
  const adapter = await adapterFor(plan);
  const id = `codex-formal-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(root, 'runs', id);
  await createCampaign(root, directory, plan, adapter);
  print({ event: 'campaign-started', id, positions: plan.positionCount, stageCalls: plan.modelExecutionCount, model: plan.environments.codex });
  const result = await runCampaign(directory, { adapter, identityCheck: () => identityCheck(readiness) });
  await report(directory, plan);
  print({ id, ...result });
  if (result.status !== 'completed') process.exitCode = 1;
 }
} else {
 if (!/^codex-formal-\d+-[a-f0-9]{8}$/.test(input)) throw new Error('Invalid Codex campaign id');
 const directory = path.join(root, 'runs', input);
 const saved = await privateJson(path.join(directory, 'campaign.json'));
 if (mode === 'report') print(await report(directory, saved.plan));
 else {
  const adapter = await adapterFor(saved.plan);
  const result = await runCampaign(directory, { adapter, identityCheck: () => identityCheck(saved.plan.readiness), resume: true });
  await report(directory, saved.plan);
  print({ id: input, ...result });
  if (result.status !== 'completed') process.exitCode = 1;
 }
}
