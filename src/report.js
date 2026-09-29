import { failureCategory } from './failure.js';

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10000) / 10000;
}

function summarizeArm(rows, arm, baseline) {
  const own = rows.filter((row) => row.arm === arm);
  const pairs = own.map((row) => ({
    row,
    base: baseline.get(`${row.task}:${row.repeat}`),
  }));
  const known = pairs.filter(
    ({ row, base }) =>
      Number.isFinite(row.usage?.totalTokens) &&
      Number.isFinite(base?.usage?.totalTokens) &&
      base.usage.totalTokens > 0,
  );
  const changes = known.map(
    ({ row, base }) =>
      (row.usage.totalTokens / base.usage.totalTokens - 1) * 100,
  );
  return {
    arm,
    runs: own.length,
    executionPassed: own.filter((row) => row.executionPassed).length,
    qualityPassed: own.filter((row) => row.qualityPassed).length,
    quotaFailures: own.filter((row) => failureCategory(row) === 'quota').length,
    verificationFailures: own.filter(
      (row) => failureCategory(row) === 'verification',
    ).length,
    activationNotObserved: own.filter(
      (row) => row.activation?.status === 'not-observed',
    ).length,
    activationUnknown: own.filter((row) => !row.activation).length,
    missingUsage: own.filter((row) => !Number.isFinite(row.usage?.totalTokens))
      .length,
    unpaired: pairs.filter(({ base }) => !base).length,
    pairedKnownUsage: known.length,
    medianTotalTokenChangePercent: median(changes),
    minTotalTokenChangePercent: changes.length ? Math.min(...changes) : null,
    maxTotalTokenChangePercent: changes.length ? Math.max(...changes) : null,
    actualCostUsd: null,
  };
}

export function summarizeCampaign(rows, arms) {
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.arm}:${row.task}:${row.repeat}`;
    if (seen.has(key)) throw new Error(`Duplicate result: ${key}`);
    seen.add(key);
  }
  const baseline = new Map(
    rows
      .filter((row) => row.arm === 'baseline')
      .map((row) => [`${row.task}:${row.repeat}`, row]),
  );
  return {
    note: 'Paired total-token changes include every pair with known usage, even failed or inactive runs. Negative means fewer tokens, not lower billed cost. Interpret alongside completion and activation; no significance claim.',
    arms: arms.map((arm) => summarizeArm(rows, arm, baseline)),
    byTask: [...new Set(rows.map((row) => row.task))].map((task) => ({
      task,
      arms: arms.map((arm) =>
        summarizeArm(
          rows.filter((row) => row.task === task),
          arm,
          baseline,
        ),
      ),
    })),
  };
}
