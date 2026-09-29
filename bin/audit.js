import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditActivation } from '../src/activation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function optional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}
const records = [];
for (const name of (
  await readdir(path.join(root, 'runs'), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('pilot-'))
  .map((entry) => entry.name)
  .sort()) {
  const dir = path.join(root, 'runs', name);
  const summaryText = await optional(path.join(dir, 'summary.json'));
  if (!summaryText) {
    records.push({ id: name, status: 'missing-summary' });
    continue;
  }
  const summary = JSON.parse(summaryText);
  const invocationText = await optional(path.join(dir, 'invocation.json'));
  const invocation = invocationText ? JSON.parse(invocationText) : {};
  const instructions =
    (invocation.args ?? []).find((arg) =>
      arg.startsWith('developer_instructions='),
    ) ?? '';
  const activation = auditActivation(summary.arm, {
    events: await optional(path.join(dir, 'events.jsonl')),
    hookEvents: await optional(path.join(dir, 'rtk-hooks.jsonl')),
    proxyEvents: await optional(path.join(dir, 'headroom-requests.jsonl')),
    instructions,
  });
  const upstreamText = await optional(
    path.join(dir, 'upstream-verification.json'),
  );
  const upstream = upstreamText ? JSON.parse(upstreamText) : null;
  const serialText = await optional(
    path.join(dir, 'upstream-verification-serial.json'),
  );
  const serial = serialText ? JSON.parse(serialText) : null;
  records.push({
    id: name,
    arm: summary.arm,
    environmentRevision: summary.environmentRevision ?? 1,
    status: summary.status,
    executionPassed: summary.executionPassed,
    qualityPassed: summary.qualityPassed,
    activation,
    usage: summary.usage,
    upstreamRegressionPassed: upstream
      ? upstream.code === 0 && !upstream.timedOut
      : null,
    serialRecheckPassed: serial ? serial.code === 0 && !serial.timedOut : null,
    actualCostUsd: summary.actualCostUsd ?? null,
    formalComparisonEligible: false,
  });
}
const report = {
  kind: 'integration-audit',
  note: 'Integration pilots only. No ranking or savings estimate. Environment revisions and activation failures are retained.',
  records,
};
await writeFile(
  path.join(root, 'runs/pilot-audit.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
