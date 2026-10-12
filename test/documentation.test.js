import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../', import.meta.url).pathname;

test('documentation architecture is lean without redundant design files', async () => {
  const requiredFiles = [
    'README.md',
    'docs/benchmark-protocol.md',
    'docs/reproduction-guide.md',
    'task-cards/httpie-download-diagnosis.md',
    'task-cards/httpie-download-iteration.md',
    'verifiers/httpie-download-diagnosis-manual.md',
    'verifiers/httpie-download-iteration-manual.md',
  ];

  for (const file of requiredFiles) {
    const fullPath = path.join(root, file);
    await assert.doesNotReject(access(fullPath), `Expected core document ${file} to exist`);
    const content = await readFile(fullPath, 'utf8');
    assert.ok(content.trim().length > 200, `Expected document ${file} to have substantial content`);
  }

  // Redundant duplicate experiment-design.md should not exist
  const redundantFile = path.join(root, 'docs/experiment-design.md');
  await assert.rejects(
    stat(redundantFile),
    /ENOENT/,
    'docs/experiment-design.md should not exist'
  );
});

test('README provides focused navigation and quick-start links without redundancy', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes('docs/benchmark-protocol.md'), 'README should link to benchmark-protocol.md');
  assert.ok(readme.includes('docs/reproduction-guide.md'), 'README should link to reproduction-guide.md');
  assert.ok(!readme.includes('docs/experiment-design.md'), 'README should not link to removed duplicate file');
  assert.ok(!readme.includes('docs/real-development-protocol.md'), 'README should not link to legacy protocol filename');
  for (const target of ['docs/token-saver-experiment-summary.md', 'docs/decision-study-results.md', 'docs/output-study-results.md']) {
    assert.ok(readme.includes(target), `README should link to current results: ${target}`);
  }

});

test('protocol distinguishes completed batches and retains accounting rules', async () => {
  const content = await readFile(path.join(root, 'docs/benchmark-protocol.md'), 'utf8');
  const overview = content.split('## 研究问题')[0];
  for (const [file, count] of [['codex-sol-results.md', 20], ['decision-study-results.md', 32], ['output-study-results.md', 12]]) {
    const row = overview.split('\n').find(line => line.includes(`](${file})`));
    assert.ok(row, `Missing completed batch link: ${file}`);
    assert.match(row, new RegExp(`${count} 个位置`));
  }
  for (const rule of ['输入 Token + 输出 Token', '输入 Token − 缓存输入', 'null', '独立质量验收', 'gpt-5.6-sol']) {
    assert.ok(content.includes(rule), `Missing current protocol rule: ${rule}`);
  }
});

test('reproduction guide retains fixed dependencies and lifecycle reference', async () => {
  const content = await readFile(path.join(root, 'docs/reproduction-guide.md'), 'utf8');
  const essentialElements = [
    '0.158.0',
    '11.0.1',
    'b1fa9aefcc22fde5774b7f6cf0b3e19fc67acc6e',
    '5b604c37c6c67e18e7c3e9aee6c88a8c22b98345',
    'e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156',
    '.cache/candidate-memos',
    '.cache/candidate-httpie',
    '.cache/tools/ponytail',
    'preflight',
    'prepare',
    'start',
    'resume',
    'manifest.json',
    'summary.json',
  ];
  for (const element of essentialElements) {
    assert.ok(
      content.includes(element),
      `Reproduction guide must include ${element}`
    );
  }
});

test('published documentation has no broken local file links', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = ['README.md', ...(await readdir(path.join(root, 'docs')))
    .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
  for (const file of files) {
    const content = await readFile(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      await assert.doesNotReject(access(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
    }
  }
});
