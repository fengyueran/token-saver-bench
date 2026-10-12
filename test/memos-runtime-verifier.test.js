import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMemosUpdateRequest } from '../src/memos-runtime-verifier.js';
const text = (field, value) => Buffer.concat([Buffer.from([field * 8 + 2, Buffer.byteLength(value)]), Buffer.from(value)]);
const memo = Buffer.concat([text(1, 'memos/owned'), Buffer.from([16, 2])]);
const body = Buffer.concat([Buffer.from([10, memo.length]), memo, text(2, text(1, 'state'))]);
test('independently decodes real UpdateMemo protobuf field mask and business fields', () => {
  assert.deepEqual(decodeMemosUpdateRequest('application/proto', body), {name:'memos/owned',state:2,updateMask:['state'],memoFields:[1,2],onlyStateUpdated:true});
});
test('keeps unrequested memo field evidence and rejects malformed protobuf', () => {
  const extra = Buffer.concat([memo, text(5,'unexpected content')]);
  const result=decodeMemosUpdateRequest('application/proto', Buffer.concat([Buffer.from([10,extra.length]),extra,text(2,text(1,'state'))]));
  assert.equal(result.onlyStateUpdated,false);
  assert.throws(() => decodeMemosUpdateRequest('application/proto', body.subarray(0,body.length-1)), /Truncated/);
  assert.throws(() => decodeMemosUpdateRequest('application/proto', Buffer.concat([body,body])), /Duplicate/);
  assert.throws(() => decodeMemosUpdateRequest('application/grpc',body), /Unsupported/);
});
test('JSON gateway body preserves extra field and missing mask instead of success', () => {
  const good=Buffer.from(JSON.stringify({memo:{name:'memos/owned',state:'ARCHIVED'},updateMask:'state'}));
  assert.equal(decodeMemosUpdateRequest('application/json; charset=utf-8',good).onlyStateUpdated,true);
  assert.equal(decodeMemosUpdateRequest('application/json',Buffer.from('{"memo":{"name":"memos/owned","state":"ARCHIVED","content":"changed"},"updateMask":"state"}')).onlyStateUpdated,false);
  assert.equal(decodeMemosUpdateRequest('application/json',Buffer.from('{"memo":{"name":"memos/owned","state":"ARCHIVED"}}')).onlyStateUpdated,false);
});
