import { randomUUID } from 'node:crypto';

export function createScenarioSimulator() {
  const threadId = randomUUID();
  let stage = 0;
  return async () => {
    stage += 1;
    const events = [
      { type: 'thread.started', thread_id: threadId },
      { type: 'item.completed', item: { type: 'agent_message', text: '离线模拟回答，不是 Agent 交付。' } },
      { type: 'turn.completed', turn_id: `synthetic-turn-${stage}`,
        usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } },
    ];
    return { code: 0, timedOut: false, inputError: null,
      stdout: events.map(JSON.stringify).join('\n') + '\n', stderr: '' };
  };
}
