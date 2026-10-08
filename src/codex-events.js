function aggregateUsage(turns) {
  if (turns.length === 0 || turns.some((turn) => !turn.usage)) return null;
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
  for (const { usage } of turns) {
    if (fields.some((key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0))
      throw new Error('Invalid usage counter');
    if (usage.cached_input_tokens > usage.input_tokens)
      throw new Error('Invalid usage: cached tokens exceed total input');
  }
  const sum = (key) => turns.reduce((total, turn) => total + turn.usage[key], 0);
  const inputTokens = sum('input_tokens');
  const cachedInputTokens = sum('cached_input_tokens');
  const outputTokens = sum('output_tokens');
  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens: null,
  };
}

export function parseCodexRun(jsonl) {
  const events = jsonl.split('\n').filter((line) => line.trim()).map((line, index) => {
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || typeof event.type !== 'string')
        throw new Error('event type missing');
      return event;
    } catch {
      throw new Error(`Invalid JSONL event at line ${index + 1}`);
    }
  });
  const turns = events.filter((event) => event.type === 'turn.completed');
  const failed = events.some((event) => event.type === 'turn.failed');
  const answer = events.filter((event) =>
    event.type === 'item.completed' && event.item?.type === 'agent_message')
    .map((event) => event.item.text).join('\n');
  const errors = [...new Set(events.flatMap((event) => {
    const message = event.type === 'turn.failed'
      ? event.error?.message
      : event.type === 'error'
        ? event.message
        : event.type === 'item.completed' && event.item?.type === 'error'
          ? event.item.message : null;
    return typeof message === 'string' ? [message] : [];
  }))];
  return {
    status: failed ? 'failed' : turns.length ? 'completed' : 'incomplete',
    errors,
    usage: aggregateUsage(turns),
    actualCostUsd: null,
    answer,
  };
}
