const COUNTERS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
const verified = value => value?.verified === true && typeof value.reference === 'string' && value.reference.trim().length > 0;

function csvCells(csv) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (csv[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      finishRow();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error('Malformed CSV quoting'); cell += char; }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell !== '' || row.length || closed) finishRow();
  return rows;
}

export function parseCursorUsageCsv(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv) > 10 * 1024 * 1024) throw new Error('Invalid CSV input');
  const [header, ...rows] = csvCells(csv.replace(/^\uFEFF/, ''));
  if (!header?.length || header.some(name => !name || name.trim() !== name) || new Set(header).size !== header.length)
    throw new Error('Invalid CSV headers');
  return rows.map(row => {
    if (row.length !== header.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(header.map((name, index) => [name, row[index]]));
  });
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error('Timestamp requires explicit ISO timezone');
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59)
    throw new Error('Invalid timestamp calendar components');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('Invalid timestamp');
  return millis;
}

function counter(value) {
  if (value === '') return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid supplier counter');
  return Number(value);
}

function cost(value) {
  if (value === '' || value === undefined) return null;
  if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (!Number.isFinite(Number(value)) || Number(value) > Number.MAX_SAFE_INTEGER)) throw new Error('Invalid supplier USD cost');
  return Number(value);
}

function supplierUsage(row, schema) {
  const usage=Object.fromEntries(COUNTERS.map(field=>[field,counter(row[schema.columns.counters[field]])]));
  if(schema.definition?.counters!=='cursor-export-split-input')return usage;
  if(Object.values(usage).some(value=>value===null))throw new Error('Missing split-input counter');
  const input=usage.input_tokens+usage.cache_write_tokens+usage.cache_read_tokens;
  const total=input+usage.output_tokens;
  if(!Number.isSafeInteger(input)||!Number.isSafeInteger(total))throw new Error('Split-input counter overflow');
  if(counter(row[schema.columns.totalTokens])!==total)throw new Error('Supplier total token mismatch');
  return {...usage,input_tokens:input};
}

function sumCosts(matches) {
  if(!matches.length||matches.some(match=>match.supplierCostUsd===null))return null;
  const total=matches.reduce((sum,match)=>sum+match.supplierCostUsd,0);
  if(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)throw new Error('Supplier monetary total overflow');
  return total;
}

function parseSupplierRows(csv, schema) {
  const columns = schema?.columns;
  if (!columns || !columns.timestamp || !columns.model || !COUNTERS.every(field => columns.counters?.[field]))
    throw new Error('Explicit timestamp, model and all counter mappings required');
  if(schema.definition?.counters==='cursor-export-split-input'&&!columns.totalTokens)throw new Error('Split-input requires totalTokens mapping');
  const mapped = [columns.timestamp, columns.model, columns.generationId, columns.conversationId,
    columns.costUsd, columns.totalTokens, ...COUNTERS.map(field => columns.counters[field])].filter(Boolean);
  if (mapped.some(value => typeof value !== 'string') || new Set(mapped).size !== mapped.length)
    throw new Error('Invalid or reused column mapping');
  return parseCursorUsageCsv(csv).map((row, index) => {
    if (mapped.some(column => !Object.hasOwn(row, column))) throw new Error('Mapped column missing');
    if (!row[columns.model]) throw new Error('Missing supplier model');
    return { rowIndex: index + 1, time: timestamp(row[columns.timestamp]), model: row[columns.model],
      generationId: columns.generationId ? row[columns.generationId] : null,
      conversationId: columns.conversationId ? row[columns.conversationId] : null,
      usage: supplierUsage(row,schema),
      costUsd: columns.costUsd ? cost(row[columns.costUsd]) : null };
  });
}

function validateGeneration(generation) {
  if (!generation || ![generation.conversationId, generation.generationId, generation.model].every(value => typeof value === 'string' && value.length))
    throw new Error('Missing hook generation identity or model');
  const start = timestamp(generation.startTime), end = timestamp(generation.endTime);
  if (end < start) throw new Error('Invalid hook time window');
  if (!Array.isArray(generation.subagentEvents) || generation.subagentEvents.length) throw new Error('Subagent accounting unverified');
  if (!Number.isSafeInteger(generation.duplicateUsageCount) || generation.duplicateUsageCount < 0)
    throw new Error('Invalid hook duplicate count');
  if (!COUNTERS.every(field => Number.isSafeInteger(generation.reportedUsage?.[field]) && generation.reportedUsage[field] >= 0))
    throw new Error('Missing or invalid hook counters');
  return { ...generation, start, end };
}

function matchRows(rows, generations, blockers) {
  const matched = [], consumed = new Set();
  for (const generation of generations) {
    const candidates = rows.filter(row => row.model === generation.model && row.time >= generation.start && row.time <= generation.end &&
      (row.generationId === null || row.generationId === generation.generationId) &&
      (row.conversationId === null || row.conversationId === generation.conversationId));
    if (candidates.length !== 1 || consumed.has(candidates[0]?.rowIndex)) { blockers.push('Supplier pairing is missing or ambiguous'); continue; }
    const row = candidates[0]; consumed.add(row.rowIndex);
    const equal = COUNTERS.every(field => row.usage[field] !== null && row.usage[field] === generation.reportedUsage[field]);
    if (!equal) blockers.push('Supplier and hook counters are missing or differ');
    matched.push({ conversationId: generation.conversationId, generationId: generation.generationId,
      supplierRowIndex: row.rowIndex, countersMatch: equal, duplicateHookUsageCount: generation.duplicateUsageCount,
      reportedUsage: { ...generation.reportedUsage }, supplierUsage: row.usage, supplierCostUsd: row.costUsd });
  }
  if (consumed.size !== rows.length) blockers.push('Unmatched supplier rows remain');
  return matched;
}

/** Caller supplies verified evidence references; this function does not verify an account or infer CSV semantics. */
export function reconcileCursorUsage({ csv, schema, generations, accountEvidence, source } = {}) {
  const blockers = [];
  if (!verified(accountEvidence)) blockers.push('Matching editor and supplier account evidence required');
  if (!source || !['official-csv', 'synthetic-test-only'].includes(source.kind) || !verified(source.evidence))
    blockers.push('Verified supplier CSV provenance required');
  const definition = schema?.definition;
  if (definition?.rowUnit !== 'generation' || !['same-as-hook','cursor-export-split-input'].includes(definition.counters) || definition.excludesSubagents !== true || !verified(definition.evidence))
    blockers.push('Verified generation-level counter semantics required');
  const costMeaning=definition?.costMeaning??'unknown';
  if(!['charged-cost','usage-value','unknown'].includes(costMeaning))blockers.push('Invalid supplier cost meaning');
  let rows = [], hooks = [], matches = [], monetaryTotal=null;
  try {
    rows = parseSupplierRows(csv, schema);
    if (!Array.isArray(generations) || !generations.length) throw new Error('Hook generations required');
    hooks = generations.map(validateGeneration);
    if (new Set(hooks.map(g => JSON.stringify([g.conversationId, g.generationId]))).size !== hooks.length)
      throw new Error('Duplicate hook generation identity');
    if (!rows.length) throw new Error('Supplier CSV has no events');
    matches = matchRows(rows, hooks, blockers);
    monetaryTotal=sumCosts(matches);
  } catch (error) { blockers.push(error.message); }
  const validationMatched = blockers.length === 0;
  const testOnly = source?.kind === 'synthetic-test-only';
  const accountingVerified = validationMatched && !testOnly;
  return { status: validationMatched ? (testOnly ? 'matched-test-only' : 'reconciled') : 'blocked',
    validationMatched, accountingVerified, testOnly, blockers: [...new Set(blockers)], matches,
    normalizedUsage: accountingVerified ? matches.map(match => ({ ...match.supplierUsage })) : null,
    actualCostUsd: accountingVerified && costMeaning==='charged-cost' && verified(definition.costEvidence) ? monetaryTotal : null,
    supplierUsageValueUsd: accountingVerified && costMeaning==='usage-value' ? monetaryTotal : null,
    formalReady: false, privateArtifacts: true };
}
