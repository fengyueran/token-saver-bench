const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateIds(items, label) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  if (items.some((item) => !safeId.test(item?.id ?? ''))) {
    throw new Error(`${label} contains an invalid id`);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(`${label} contains duplicate ids`);
  }
}

export function validateExperiment(config) {
  if (!safeId.test(config?.id ?? '')) {
    throw new Error('experiment id must be kebab-case');
  }
  if (typeof config.model !== 'string' || !config.model.trim()) {
    throw new Error('model is required');
  }
  if (
    !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(
      config.reasoningEffort,
    )
  ) {
    throw new Error('invalid reasoningEffort');
  }
  if (!Number.isSafeInteger(config.repetitions) || config.repetitions < 1) {
    throw new Error('repetitions must be a positive integer');
  }
  if (
    !Number.isSafeInteger(config.timeoutSeconds) ||
    config.timeoutSeconds < 1
  ) {
    throw new Error('timeoutSeconds must be a positive integer');
  }
  validateIds(config.arms, 'arms');
  validateIds(config.tasks, 'tasks');
  if (!config.arms.some((arm) => arm.id === 'baseline')) {
    throw new Error('baseline is required');
  }
  return config;
}

export function createSchedule(config) {
  validateExperiment(config);
  return config.tasks.flatMap((task, taskIndex) =>
    Array.from({ length: config.repetitions }, (_, repeat) =>
      config.arms.map((_, index) => {
        const arm =
          config.arms[(index + taskIndex + repeat) % config.arms.length];
        return {
          id: `${task.id}-${repeat + 1}-${arm.id}`,
          task: task.id,
          arm: arm.id,
          repeat,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
        };
      }),
    ).flat(),
  );
}

function aggregateUsage(turns) {
  if (turns.length === 0 || turns.some((turn) => !turn.usage)) {
    return null;
  }
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
  for (const { usage } of turns) {
    if (
      fields.some((key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0)
    ) {
      throw new Error('Invalid usage counter');
    }
    if (usage.cached_input_tokens > usage.input_tokens) {
      throw new Error('Invalid usage: cached tokens exceed total input');
    }
  }
  const sum = (key) =>
    turns.reduce((total, turn) => total + turn.usage[key], 0);
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
  const events = jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        const event = JSON.parse(line);
        if (
          !event ||
          typeof event !== 'object' ||
          typeof event.type !== 'string'
        ) {
          throw new Error('event type missing');
        }
        return event;
      } catch {
        throw new Error(`Invalid JSONL event at line ${index + 1}`);
      }
    });
  const turns = events.filter((event) => event.type === 'turn.completed');
  const failed = events.some((event) => event.type === 'turn.failed');
  const answer = events
    .filter(
      (event) =>
        event.type === 'item.completed' && event.item?.type === 'agent_message',
    )
    .map((event) => event.item.text)
    .join('\n');
  return {
    status: failed ? 'failed' : turns.length ? 'completed' : 'incomplete',
    errors: [
      ...new Set(
        events.flatMap((event) => {
          const message =
            event.type === 'turn.failed'
              ? event.error?.message
              : event.type === 'error'
                ? event.message
                : event.type === 'item.completed' &&
                    event.item?.type === 'error'
                  ? event.item.message
                  : null;
          return typeof message === 'string' ? [message] : [];
        }),
      ),
    ],
    usage: aggregateUsage(turns),
    actualCostUsd: null,
    answer,
  };
}

export function codexArgs(config, workspace) {
  validateExperiment(config);
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--model',
    config.model,
    '-c',
    `model_reasoning_effort=${JSON.stringify(config.reasoningEffort)}`,
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'skills.include_instructions=false',
    '-c',
    'skills.bundled.enabled=false',
    '-c',
    'features.plugins=false',
    '-c',
    'features.apps=false',
    '-c',
    'features.memories=false',
    '-c',
    'features.hooks=false',
    '-c',
    'features.multi_agent=false',
    '--sandbox',
    'read-only',
    '--cd',
    workspace,
    '-',
  ];
}
