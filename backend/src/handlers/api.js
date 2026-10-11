// API Gateway (HTTP API) → core router.
import { awsContext } from '../adapters/aws.js';
import { handle } from '../core/api.js';

const ctx = awsContext();

function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw).replace(/^\[|\]$/g, '').split(/[ ,]+/).filter(Boolean);
}

export const handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); }
    catch { return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Request body must be JSON', code: 'badJson', params: {} }) }; }
  }
  const res = await handle(ctx, {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters || {},
    body,
    auth: claims ? { userId: claims.sub, groups: parseGroups(claims['cognito:groups']), claims } : null,
    ip: event.requestContext?.http?.sourceIp || '', // per-IP rate limits on public speech routes (only a hash is stored)
  });
  return { statusCode: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(res.body) };
};
