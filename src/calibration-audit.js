const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];

function counters(value) {
  if (!value || fields.some((field) => value[field] === undefined)) return null;
  if (fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0) ||
    value.cached_input_tokens > value.input_tokens ||
    !Number.isSafeInteger(value.input_tokens + value.output_tokens))
    throw new Error('Invalid calibration counter');
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

const equal = (left, right) => left && right && fields.every((field) => left[field] === right[field]);

export function assertCalibrationAudit(audit) {
  if (!audit?.sessionModelMatches || !audit.stageUsage ||
    !['initial-undetermined', 'per-turn', 'cumulative'].includes(audit.usageMode))
    throw new Error('Session identity or native usage audit failed');
}

export function auditCalibrationSession(jsonl, threadId, reported, previousTotal = null, model = 'gpt-6-sol') {
  if (!['gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.6-sol'].includes(model)) throw new Error('Unsupported calibration model');
  const events = jsonl.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const sessions = events.filter((event) => event.type === 'session_meta');
  if (sessions.length !== 1 || sessions[0].payload?.id !== threadId)
    throw new Error('Calibration session identity mismatch');
  const contexts = events.filter((event) => event.type === 'turn_context').map((event) => event.payload);
  const sessionModelMatches = contexts.length > 0 && contexts.every((context) =>
    context?.model === model && context?.effort === 'medium');
  const totals = events.filter((event) => event.type === 'event_msg' && event.payload?.type === 'token_count')
    .map((event) => event.payload.info?.total_token_usage).filter(Boolean);
  const total = counters(totals.at(-1));
  const reportedUsage = counters(reported);
  const base = previousTotal === null ? Object.fromEntries(fields.map((field) => [field, 0])) : counters(previousTotal);
  if (!base) throw new Error('Missing prior calibration counters');
  const delta = total ? Object.fromEntries(fields.map((field) => [field, total[field] - base[field]])) : null;
  if (delta && fields.some((field) => delta[field] < 0)) throw new Error('Calibration counters regressed');
  if (delta) counters(delta);
  const usageMode = !total || !reportedUsage ? 'missing' : equal(reportedUsage, delta) ?
    (previousTotal === null || equal(total, delta) ? 'initial-undetermined' : 'per-turn') :
    equal(reportedUsage, total) ? 'cumulative' : 'mismatch';
  return { sessionModelMatches, modelEvidence: 'local-turn-context', actualResolvedModel: null, contextCount: contexts.length, totalUsage: total, reportedUsage,
    usageMode, stageUsage: ['per-turn', 'cumulative', 'initial-undetermined'].includes(usageMode) ? delta : null,
    actualCostUsd: null };
}
