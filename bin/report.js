import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCampaign } from '../src/report.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const id = process.argv[2];
if (!/^campaign-[a-z0-9-]+$/.test(id ?? ''))
  throw new Error('Usage: report.js <campaign-id>');
const directory = path.join(root, 'runs', id);
const manifest = JSON.parse(
  await readFile(path.join(directory, 'manifest.json'), 'utf8'),
);
const rows = [];
const missing = [];
for (const run of manifest.schedule) {
  try {
    rows.push(
      JSON.parse(
        await readFile(path.join(directory, run.id, 'summary.json'), 'utf8'),
      ),
    );
  } catch (error) {
    if (error.code === 'ENOENT') missing.push(run.id);
    else throw error;
  }
}
const report = {
  id,
  planned: manifest.schedule.length,
  recorded: rows.length,
  missing,
  ...summarizeCampaign(
    rows,
    manifest.identity.config.arms.map((arm) => arm.id),
  ),
};
await writeFile(
  path.join(directory, 'report.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
const lines = [
  '# Token Saver Bench',
  `\nCampaign: ${id}`,
  `\n已记录 ${rows.length}/${manifest.schedule.length}；实际美元费用未知。`,
  '\n| 组 | 记录 | 执行通过 | 自动验收通过 | 额度失败 | 未观察到激活 | 配对用量齐全 | 总 token 变化中位数 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...report.arms.map(
    (arm) =>
      `| ${arm.arm} | ${arm.runs} | ${arm.executionPassed} | ${arm.qualityPassed} | ${arm.quotaFailures} | ${arm.activationNotObserved} | ${arm.pairedKnownUsage} | ${arm.medianTotalTokenChangePercent === null ? '未知' : arm.medianTotalTokenChangePercent.toFixed(1) + '%'} |`,
  ),
  '\n负值表示总 token 较基线减少，不代表美元费用降低。统计包含用量已知的失败和未激活样本，不进行显著性推断。探索题解释内容仍需人工复核。',
  '\n原始分项、每题结果、失败与缺失状态见 report.json 和各运行目录。',
];
await writeFile(path.join(directory, 'report.md'), lines.join('\n') + '\n', {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
