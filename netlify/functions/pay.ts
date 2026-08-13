import {
  handleCreateDonateOrder,
  handleDonateOrderStatus,
  handleGetPendingDonateOrder,
  handleListMyDonateRecords,
  handleUpdateDonateOrderMessage,
  handleWechatPayNotify,
} from '../../server/payHandlers';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Wechatpay-Timestamp, Wechatpay-Nonce, Wechatpay-Signature, Wechatpay-Serial, Wechatpay-Signature-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function readRawBody(event: {
  body: string | null;
  isBase64Encoded?: boolean;
}): string {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function normalizePath(path: string): string {
  const cleaned = path.split('?')[0];
  const idx = cleaned.indexOf('/pay');
  if (idx >= 0) return cleaned.slice(idx + '/pay'.length) || '/';
  return cleaned;
}

export async function handler(event: {
  httpMethod?: string;
  path?: string;
  rawUrl?: string;
  body: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
}) {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const headers = (event.headers || {}) as Record<
    string,
    string | string[] | undefined
  >;
  const path = normalizePath(event.path || event.rawUrl || '/');

  try {
    if (method === 'POST' && path === '/wechat/notify') {
      const raw = readRawBody(event);
      const r = await handleWechatPayNotify(raw, headers);
      return {
        statusCode: r.status,
        headers: {
          ...corsHeaders,
          'Content-Type': r.contentType || 'application/json',
        },
        body: r.rawBody ?? JSON.stringify(r.body),
      };
    }

    if (method === 'POST' && path === '/donate/create') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleCreateDonateOrder(body, headers);
      return json(r.status, r.body);
    }

    if (method === 'GET' && path === '/donate/pending') {
      const r = await handleGetPendingDonateOrder(headers);
      return json(r.status, r.body);
    }

    if (method === 'GET' && path === '/donate/records') {
      const r = await handleListMyDonateRecords(headers);
      return json(r.status, r.body);
    }

    if (method === 'PATCH' && path === '/donate/message') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleUpdateDonateOrderMessage(body, headers);
      return json(r.status, r.body);
    }

    const statusMatch = path.match(/^\/donate\/status\/([^/]+)$/);
    if (method === 'GET' && statusMatch) {
      const r = await handleDonateOrderStatus(
        decodeURIComponent(statusMatch[1]),
        headers,
      );
      return json(r.status, r.body);
    }

    return json(404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pay]', message);
    return json(500, { error: message });
  }
}
