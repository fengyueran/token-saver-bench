export function auditActivation(
  arm,
  { events = '', hookEvents = '', proxyEvents = '', instructions = '' } = {},
) {
  const parse = (input) =>
    input
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  if (arm === 'baseline') return { status: 'not-applicable' };
  if (['caveman', 'ponytail'].includes(arm)) {
    return {
      status: instructions ? 'instructions-injected' : 'not-observed',
      behavioralCompliance: 'not-automatically-graded',
    };
  }
  if (arm === 'rtk') {
    const hooks = parse(hookEvents);
    const rewritten = hooks.filter((event) => event.rewritten).length;
    return {
      status: rewritten > 0 ? 'observed' : 'not-observed',
      hookCalls: hooks.length,
      rewrittenCommands: rewritten,
    };
  }
  if (arm === 'codegraph') {
    const calls = parse(events).filter(
      (event) =>
        event.type === 'item.completed' &&
        event.item?.type === 'mcp_tool_call' &&
        event.item.server === 'codegraph',
    );
    const succeeded = calls.filter(
      (event) =>
        !event.item.error &&
        !event.item.result?.isError &&
        event.item.status === 'completed',
    );
    return {
      status: succeeded.length ? 'observed' : 'not-observed',
      calls: calls.length,
      succeeded: succeeded.length,
    };
  }
  if (arm === 'headroom') {
    const calls = parse(proxyEvents);
    const transformed = calls.filter(
      (event) => !event.error && event.transforms_applied?.length,
    );
    return {
      status: transformed.length ? 'observed' : 'not-observed',
      requests: calls.length,
      transformedRequests: transformed.length,
      source: 'proxy-self-report-not-billed-savings',
    };
  }
  throw new Error('Unknown arm');
}
