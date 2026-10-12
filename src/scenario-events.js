import { parseCodexRun } from './codex-events.js';

export function assertThreadId(threadId) {
  if (typeof threadId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId))
    throw new Error('Invalid thread identity');
}

function deduplicateTerminals(events) {
  const seen = new Map();
  return events.filter((event) => {
    if (!['turn.completed', 'turn.failed'].includes(event.type)) return true;
    const id = event.event_id ?? event.turn_id ?? event.id;
    if (id === undefined) return true;
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid terminal identity');
    const key = `${event.type}:${id}`;
    const encoded = JSON.stringify(event);
    if (seen.has(key) && seen.get(key) !== encoded) throw new Error('Conflicting terminal event');
    if (seen.has(key)) return false;
    seen.set(key, encoded);
    return true;
  });
}

function cumulativeDelta(current, previous, initial) {
  if (current === null || (!initial && previous === null)) return null;
  const fields = ['inputTokens', 'cachedInputTokens', 'outputTokens'];
  const base = initial ? Object.fromEntries(fields.map((key) => [key, 0])) : previous;
  if (fields.some((key) => !Number.isSafeInteger(base[key]) || base[key] < 0) ||
    base.cachedInputTokens > base.inputTokens) throw new Error('Invalid cumulative baseline');
  const values = Object.fromEntries(fields.map((key) => [key, current[key] - base[key]]));
  if (fields.some((key) => values[key] < 0)) throw new Error('Cumulative usage regressed');
  if (values.cachedInputTokens > values.inputTokens) throw new Error('Delta cached tokens exceed input');
  return { ...values, uncachedInputTokens: values.inputTokens - values.cachedInputTokens,
    totalTokens: values.inputTokens + values.outputTokens, reasoningTokens: null };
}

export function parseScenarioEvents(jsonl, expectedThreadId = null, usageMode = 'per-turn', previousUsage = null) {
  if (!['per-turn', 'cumulative'].includes(usageMode)) throw new Error('Unsupported usage mode');
  const raw = jsonl.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (raw.some((event) => !event || typeof event.type !== 'string')) throw new Error('Invalid stage event');
  const sessions = raw.filter((event) => event.type === 'thread.started');
  if (sessions.length !== 1) throw new Error('Exactly one thread identity required');
  const threadId = sessions[0].thread_id;
  assertThreadId(threadId);
  if (expectedThreadId !== null && threadId !== expectedThreadId) throw new Error('Session continuity mismatch');
  const events = deduplicateTerminals(raw);
  const terminals = events.filter((event) => ['turn.completed', 'turn.failed'].includes(event.type));
  if (terminals.length > 1) throw new Error('Ambiguous stage terminal events');
  const terminal = terminals[0];
  const parsed = parseCodexRun(events.map(JSON.stringify).join('\n'));
  if (parsed.usage && Object.entries(parsed.usage).some(([key, value]) =>
    key !== 'reasoningTokens' && !Number.isSafeInteger(value))) throw new Error('Usage sum overflow');
  const models = [...new Set(events.filter((event) => ['thread.started', 'turn.started', 'turn.completed'].includes(event.type))
    .map((event) => event.model).filter((model) => typeof model === 'string'))];
  if (models.length > 1) throw new Error('Model identity changed within stage');
  const reportedUsage = parsed.usage;
  const usage = usageMode === 'cumulative' ? cumulativeDelta(reportedUsage, previousUsage, expectedThreadId === null) : reportedUsage;
  return { ...parsed, usage, reportedUsage, threadId, turnId: terminal?.turn_id ?? terminal?.event_id ?? terminal?.id ?? null,
    resolvedModel: models[0] ?? null, usageMode, duplicateTerminals: raw.length - events.length };
}

export function sumStageUsage(values) {
  if (!values.length || values.some((value) => value === null)) return null;
  const fields = ['inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'totalTokens'];
  const totals = { reasoningTokens: null };
  for (const field of fields) {
    const sum = values.reduce((total, value) => total + value[field], 0);
    if (!Number.isSafeInteger(sum) || sum < 0) throw new Error('Usage sum overflow');
    totals[field] = sum;
  }
  return totals;
}
