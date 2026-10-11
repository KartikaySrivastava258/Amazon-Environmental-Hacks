// DynamoDB implementation of the core store port. Used by the cloud adapter (aws.js) and, against LocalStack,
// by the local Build It server and SAM local (backend/src/local/). Only the DynamoDB SDK is imported here.
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export class ConditionFailed extends Error {
  constructor() { super('Condition failed'); this.code = 'ConditionFailed'; this.status = 409; }
}

function exprBuilder() {
  const names = {};
  const values = {};
  let n = 0;
  const name = (a) => { const k = `#n${n++}`; names[k] = a; return k; };
  const value = (v) => { const k = `:v${n++}`; values[k] = v; return k; };
  const cond = (c) => {
    if (!c) return null;
    if (c.notExists) return `attribute_not_exists(${name('PK')})`;
    if (c.exists) return `attribute_exists(${name('PK')})`;
    if (c.or) return `(${c.or.map(cond).join(' OR ')})`;
    if (c.and) return `(${c.and.map(cond).join(' AND ')})`;
    if (c.missing) return c.missing.map((a) => `attribute_not_exists(${name(a)})`).join(' AND ');
    const ops = { eq: '=', ne: '<>', lt: '<', gt: '>' };
    for (const [op, sym] of Object.entries(ops)) {
      if (c[op]) return Object.entries(c[op]).map(([a, v]) => `${name(a)} ${sym} ${value(v)}`).join(' AND ');
    }
    return null;
  };
  return { names, values, name, value, cond };
}

const wrap = async (fn) => {
  try { return await fn(); } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') throw new ConditionFailed();
    throw e;
  }
};

export function createDynamoStore(ddb, TABLE) {
  return {
  async get(pk, sk) {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }));
    return r.Item || null;
  },
  async put(item, cond) {
    const b = exprBuilder();
    const c = b.cond(cond);
    await wrap(() => ddb.send(new PutCommand({ TableName: TABLE, Item: item, ...(c ? { ConditionExpression: c, ExpressionAttributeNames: b.names, ...(Object.keys(b.values).length ? { ExpressionAttributeValues: b.values } : {}) } : {}) })));
  },
  async update(pk, sk, ops, cond) {
    const b = exprBuilder();
    const set = [];
    const add = [];
    const remove = [];
    for (const [k, v] of Object.entries(ops.set || {})) if (v !== undefined) set.push(`${b.name(k)} = ${b.value(v)}`);
    for (const [k, v] of Object.entries(ops.append || {})) { const nk = b.name(k); set.push(`${nk} = list_append(if_not_exists(${nk}, ${b.value([])}), ${b.value(v)})`); }
    for (const [k, v] of Object.entries(ops.add || {})) if (v) add.push(`${b.name(k)} ${b.value(v)}`);
    for (const k of ops.remove || []) remove.push(b.name(k));
    const parts = [];
    if (set.length) parts.push(`SET ${set.join(', ')}`);
    if (add.length) parts.push(`ADD ${add.join(', ')}`);
    if (remove.length) parts.push(`REMOVE ${remove.join(', ')}`);
    if (!parts.length) return this.get(pk, sk);
    const c = b.cond(cond);
    const r = await wrap(() => ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { PK: pk, SK: sk }, UpdateExpression: parts.join(' '), ExpressionAttributeNames: b.names,
      ...(Object.keys(b.values).length ? { ExpressionAttributeValues: b.values } : {}),
      ...(c ? { ConditionExpression: c } : {}), ReturnValues: 'ALL_NEW',
    })));
    return r.Attributes;
  },
  async delete(pk, sk) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }));
  },
  async query({ pk, index, skPrefix = '', desc = false, limit }) {
    const pkA = index ? `${index}PK` : 'PK';
    const skA = index ? `${index}SK` : 'SK';
    const names = { '#pk': pkA };
    const values = { ':pk': pk };
    let kce = '#pk = :pk';
    if (skPrefix) { names['#sk'] = skA; values[':sk'] = skPrefix; kce += ' AND begins_with(#sk, :sk)'; }
    const out = [];
    let ExclusiveStartKey;
    do {
      const r = await ddb.send(new QueryCommand({ TableName: TABLE, IndexName: index, KeyConditionExpression: kce, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ScanIndexForward: !desc, Limit: limit ? Math.min(limit - out.length, 1000) : undefined, ExclusiveStartKey }));
      out.push(...(r.Items || []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && (!limit || out.length < limit) && out.length < 5000);
    return out;
  },
  async batchUpdate(list) {
    for (let i = 0; i < list.length; i += 10) {
      await Promise.all(list.slice(i, i + 10).map((u) => this.update(u.pk, u.sk, { set: u.set, add: u.add })));
    }
  },
  };
}
