import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCursorUsageCsv, reconcileCursorUsage } from '../src/cursor-reconciliation.js';
const fields = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
const usage = Object.fromEntries(fields.map((field, i) => [field, [100, 5, 60, 40][i]]));
const evidence = { verified: true, reference: 'private-fixture-evidence' };
const schema = { columns: { timestamp: 'When', model: 'Model', generationId: 'Generation',
  counters: Object.fromEntries(fields.map(field => [field, field])), costUsd: 'Cost' },
  definition: { rowUnit: 'generation', counters: 'same-as-hook', excludesSubagents: true, evidence, costMeaning:'charged-cost', costEvidence:evidence } };
const csv = 'When,Model,Generation,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,Cost\r\n2026-10-09T01:00:05Z,opus,g1,100,5,60,40,0.25\r\n';
const generation = { conversationId: 'c1', generationId: 'g1', model: 'opus',
  startTime: '2026-10-09T01:00:00Z', endTime: '2026-10-09T01:00:10Z',
  reportedUsage: usage, duplicateUsageCount: 1, subagentEvents: [] };
const input = () => ({ csv, schema, generations: [generation], accountEvidence: evidence,
  source: { kind: 'synthetic-test-only', evidence } });
test('strict CSV handles quoted commas/newlines and rejects malformed or duplicate headers', () => {
  assert.deepEqual(parseCursorUsageCsv('A,B\r\n"a,b","one\ntwo"\r\n'), [{ A: 'a,b', B: 'one\ntwo' }]);
  for (const invalid of ['A,A\n1,2', 'A,B\n1', 'A\n"open', 'A\n"one"tail', 'A\na"b'])
    assert.throws(() => parseCursorUsageCsv(invalid));
});
test('explicit synthetic mapping deduplicates hook generation but cannot certify real accounting', () => {
  const result = reconcileCursorUsage(input());
  assert.equal(result.status, 'matched-test-only');
  assert.equal(result.validationMatched, true);
  assert.equal(result.accountingVerified, false);
  assert.equal(result.actualCostUsd, null);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].duplicateHookUsageCount, 1);
  const real = reconcileCursorUsage({ ...input(), source: { kind: 'official-csv', evidence } });
  assert.equal(real.accountingVerified, true);
  assert.equal(real.actualCostUsd, 0.25);
  assert.equal(real.formalReady, false);
});
test('missing account, supplier provenance or accounting semantics remains blocked', () => {
  for (const patch of [{ accountEvidence: { verified: false } }, { source: null },
    { schema: { ...schema, definition: null } }, { csv: csv.split('\r\n')[0] }]) {
    const result = reconcileCursorUsage({ ...input(), ...patch });
    assert.equal(result.status, 'blocked');
    assert.equal(result.accountingVerified, false);
    assert.equal(result.actualCostUsd, null);
    assert.ok(result.blockers.length);
  }
});
test('ambiguous CSV matches, duplicate hook identities, unmatched and discrepant rows block', () => {
  for (const patch of [{ csv: csv + csv.split('\r\n')[1] + '\r\n' },
    { generations: [generation, generation] }, { csv: csv.replace('opus,g1', 'other,g1') },
    { csv: csv.replace(',100,5,', ',101,5,') }, { csv: csv.replace(',100,5,', ',,5,') }])
    assert.equal(reconcileCursorUsage({ ...input(), ...patch }).status, 'blocked');
});
test('missing mappings, invalid counters/timezone/cost and subagents cannot silently normalize', () => {
  for (const altered of [csv.replace(',100,5,', ',-1,5,'), csv.replace(',100,5,', ',1e2,5,'),
    csv.replace('01:00:05Z', '01:00:05'), csv.replace('2026-10-09', '2026-02-30'), csv.replace(',0.25', ',NaN')])
    assert.equal(reconcileCursorUsage({ ...input(), csv: altered }).status, 'blocked');
  assert.equal(reconcileCursorUsage({ ...input(), csv: csv.replaceAll('2026-10-09', '2026-02-30'), generations: [{ ...generation, startTime: generation.startTime.replace('2026-10-09', '2026-02-30'), endTime: generation.endTime.replace('2026-10-09', '2026-02-30') }] }).status, 'blocked');
  assert.equal(reconcileCursorUsage({ ...input(), generations: [{ ...generation, subagentEvents: [{}] }] }).status, 'blocked');
  assert.equal(reconcileCursorUsage({ ...input(), schema: { ...schema, columns: { ...schema.columns, counters: {} } } }).status, 'blocked');
  const missingCost = reconcileCursorUsage({ ...input(), csv: csv.replace(',0.25', ','), source: { kind: 'official-csv', evidence } });
  assert.equal(missingCost.accountingVerified, true);
  assert.equal(missingCost.actualCostUsd, null);
});

const splitCsv='Date,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-10-09T01:00:05Z,Included,opus,26323,8,75477,358,102166,0.18\n';
const splitSchema={columns:{timestamp:'Date',model:'Model',counters:{input_tokens:'Input (w/o Cache Write)',cache_write_tokens:'Input (w/ Cache Write)',cache_read_tokens:'Cache Read',output_tokens:'Output Tokens'},totalTokens:'Total Tokens',costUsd:'Cost'},definition:{rowUnit:'generation',counters:'cursor-export-split-input',excludesSubagents:true,evidence,costMeaning:'usage-value'}};
const splitInput=()=>({...input(),csv:splitCsv,schema:splitSchema,generations:[{...generation,reportedUsage:{input_tokens:101808,cache_write_tokens:26323,cache_read_tokens:75477,output_tokens:358}}],source:{kind:'official-csv',evidence}});
test('explicit split-input semantics reconcile supplier totals and retain included value without claiming payment',()=>{
 const result=reconcileCursorUsage(splitInput());assert.equal(result.accountingVerified,true);assert.equal(result.normalizedUsage[0].input_tokens,101808);assert.equal(result.actualCostUsd,null);assert.equal(result.supplierUsageValueUsd,0.18);
 const unknown=reconcileCursorUsage({...splitInput(),schema:{...splitSchema,definition:{...splitSchema.definition,costMeaning:undefined}}});assert.equal(unknown.accountingVerified,true);assert.equal(unknown.actualCostUsd,null);assert.equal(unknown.supplierUsageValueUsd,null);
 const synthetic=reconcileCursorUsage({...splitInput(),source:{kind:'synthetic-test-only',evidence}});assert.equal(synthetic.status,'matched-test-only');assert.equal(synthetic.actualCostUsd,null);assert.equal(synthetic.supplierUsageValueUsd,null);
});
test('split-input requires explicit total column and rejects wrong totals and safe integer overflow',()=>{
 for(const patch of [{csv:splitCsv.replace(',102166,',',102167,')},{csv:splitCsv.replace(',26323,8,',',9007199254740991,8,')},{schema:{...splitSchema,columns:{...splitSchema.columns,totalTokens:undefined}}}])assert.equal(reconcileCursorUsage({...splitInput(),...patch}).status,'blocked');
 const noEvidence={...splitSchema,definition:{...splitSchema.definition,evidence:{verified:false}}};assert.equal(reconcileCursorUsage({...splitInput(),schema:noEvidence}).accountingVerified,false);
});
test('charged cost needs separate evidence and monetary values/totals must remain within safe bounds',()=>{
 const charged={...splitSchema,definition:{...splitSchema.definition,costMeaning:'charged-cost'}};
 assert.equal(reconcileCursorUsage({...splitInput(),schema:charged}).actualCostUsd,null);
 const verifiedCharged={...charged,definition:{...charged.definition,costEvidence:evidence}};assert.equal(reconcileCursorUsage({...splitInput(),schema:verifiedCharged}).actualCostUsd,0.18);
 assert.equal(reconcileCursorUsage({...splitInput(),schema:{...splitSchema,definition:{...splitSchema.definition,costMeaning:'invented'}}}).status,'blocked');
 assert.equal(reconcileCursorUsage({...splitInput(),csv:splitCsv.replace(',0.18',',9007199254740992')}).status,'blocked');
 const multi={...splitInput(),csv:splitCsv.replace(',0.18',',9007199254740991')+splitCsv.split('\n')[1].replace('01:00:05Z','01:01:05Z').replace(',0.18',',9007199254740991')+'\n',generations:[splitInput().generations[0],{...splitInput().generations[0],generationId:'g2',startTime:'2026-10-09T01:01:00Z',endTime:'2026-10-09T01:01:10Z'}]};assert.equal(reconcileCursorUsage(multi).status,'blocked');
});
