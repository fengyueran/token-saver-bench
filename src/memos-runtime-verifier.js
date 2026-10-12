function varint(body, cursor) {
  let value = 0n;
  for (let index = 0; index < 10; index++) {
    if (cursor.offset >= body.length) throw new Error('Truncated protobuf varint');
    const byte = body[cursor.offset++];
    value |= BigInt(byte & 127) << BigInt(index * 7);
    if (!(byte & 128)) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe protobuf integer');
      return Number(value);
    }
  }
  throw new Error('Invalid protobuf varint');
}

function fields(body) {
  const cursor = { offset: 0 };
  const result = [];
  while (cursor.offset < body.length) {
    const tag = varint(body, cursor);
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (field < 1) throw new Error('Invalid protobuf field');
    let value;
    if (wire === 0) value = varint(body, cursor);
    else if ([1, 2, 5].includes(wire)) {
      const size = wire === 2 ? varint(body, cursor) : wire === 1 ? 8 : 4;
      if (cursor.offset + size > body.length) throw new Error('Truncated protobuf field');
      value = body.subarray(cursor.offset, cursor.offset + size);
      cursor.offset += size;
    } else throw new Error('Unsupported protobuf wire type');
    result.push({ field, wire, value });
  }
  return result;
}

function one(items, field, wire) {
  const values = items.filter((item) => item.field === field);
  if (values.length > 1) throw new Error('Duplicate protobuf singular field');
  if (values[0] && values[0].wire !== wire) throw new Error('Unexpected protobuf wire type');
  return values[0]?.value;
}

function decodeProto(body) {
  const root = fields(body);
  const memo = fields(one(root, 1, 2) ?? Buffer.alloc(0));
  const mask = fields(one(root, 2, 2) ?? Buffer.alloc(0));
  const name = one(memo, 1, 2)?.toString('utf8') ?? null;
  const state = one(memo, 2, 0) ?? null;
  const updateMask = mask.filter((item) => item.field === 1).map((item) => {
    if (item.wire !== 2) throw new Error('Unexpected protobuf field-mask wire type');
    return item.value.toString('utf8');
  });
  const memoFields = memo.map((item) => item.field);
  return { name, state, updateMask, memoFields, onlyStateUpdated: Boolean(name && state === 2 &&
    memoFields.every((field) => [1, 2].includes(field)) && updateMask.length === 1 && updateMask[0] === 'state') };
}

function decodeJson(body) {
  const value = JSON.parse(body.toString('utf8'));
  const memo = value?.memo;
  const memoFields = memo && typeof memo === 'object' && !Array.isArray(memo) ? Object.keys(memo) : [];
  const name = typeof memo?.name === 'string' ? memo.name : null;
  const state = memo?.state ?? null;
  const updateMask = typeof value?.updateMask === 'string' ? value.updateMask.split(',').filter(Boolean) : null;
  return { name, state, updateMask, memoFields, onlyStateUpdated: Boolean(name && [2, 'ARCHIVED'].includes(state) &&
    memoFields.every((field) => ['name', 'state'].includes(field)) && updateMask?.length === 1 && updateMask[0] === 'state') };
}

export function decodeMemosUpdateRequest(contentType, body) {
  if (!Buffer.isBuffer(body) || body.length > 1024 * 1024) throw new Error('Invalid Memos request body');
  const mediaType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
  if (mediaType === 'application/proto') return decodeProto(body);
  if (mediaType === 'application/json') return decodeJson(body);
  throw new Error('Unsupported Memos update request content type');
}
