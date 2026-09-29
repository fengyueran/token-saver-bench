export function failureCategory(result) {
  const errors = (result.errors ?? []).join('\n');
  if (/hit your usage limit|insufficient.quota|quota exceeded/i.test(errors))
    return 'quota';
  if (/429|too many requests|rate.limit/i.test(errors)) return 'rate-limit';
  if (result.timedOut) return 'timeout';
  if (result.runnerError) return 'runner';
  if (result.status === 'failed') return 'provider';
  if (result.qualityPassed === false) return 'verification';
  return null;
}
