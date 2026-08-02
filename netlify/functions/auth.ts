import {
  handleDefaults,
  handleDeleteApi,
  handleDeleteDonation,
  handleDeleteUser,
  handleDonate,
  handleGetDocs,
  handleListApis,
  handleListDonations,
  handleListUsers,
  handleLogin,
  handleMe,
  handlePublicApis,
  handleRegister,
  handleSaveDocs,
  handleTrackUsage,
  handleUpdateApi,
  handleUpdateProfile,
  handleUpdateUser,
} from '../../server/authHandlers';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: corsHeaders,
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
  const idx = cleaned.indexOf('/auth');
  if (idx >= 0) return cleaned.slice(idx + '/auth'.length) || '/';
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
    if (method === 'GET' && (path === '/' || path === '/defaults')) {
      const r = await handleDefaults();
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/docs') {
      const r = await handleGetDocs();
      return json(r.status, r.body);
    }
    if (method === 'PUT' && path === '/docs') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleSaveDocs(body, headers);
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/apis/public') {
      const r = await handlePublicApis();
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/apis') {
      const r = await handleListApis(headers);
      return json(r.status, r.body);
    }
    const apiMatch = path.match(/^\/apis\/([^/]+)$/);
    if (method === 'PATCH' && apiMatch) {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleUpdateApi(
        decodeURIComponent(apiMatch[1]),
        body,
        headers,
      );
      return json(r.status, r.body);
    }
    if (method === 'DELETE' && apiMatch) {
      const r = await handleDeleteApi(
        decodeURIComponent(apiMatch[1]),
        headers,
      );
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/me') {
      const r = await handleMe(headers);
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/users') {
      const r = await handleListUsers(headers);
      return json(r.status, r.body);
    }
    if (method === 'GET' && path === '/donations') {
      const r = await handleListDonations(headers);
      return json(r.status, r.body);
    }
    if (method === 'POST' && path === '/register') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleRegister(body, headers);
      return json(r.status, r.body);
    }
    if (method === 'POST' && path === '/login') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleLogin(body, headers);
      return json(r.status, r.body);
    }
    if (method === 'POST' && path === '/track') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleTrackUsage(body, headers);
      return json(r.status, r.body);
    }
    if (method === 'POST' && path === '/donate') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleDonate(body, headers);
      return json(r.status, r.body);
    }
    if (method === 'PATCH' && path === '/profile') {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleUpdateProfile(body, headers);
      return json(r.status, r.body);
    }
    const patchMatch = path.match(/^\/users\/([^/]+)$/);
    if (method === 'PATCH' && patchMatch) {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleUpdateUser(
        decodeURIComponent(patchMatch[1]),
        body,
        headers,
      );
      return json(r.status, r.body);
    }
    if (method === 'DELETE' && patchMatch) {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleDeleteUser(
        decodeURIComponent(patchMatch[1]),
        body,
        headers,
      );
      return json(r.status, r.body);
    }
    const donationMatch = path.match(/^\/donations\/([^/]+)$/);
    if (method === 'DELETE' && donationMatch) {
      const body = JSON.parse(readRawBody(event) || '{}');
      const r = await handleDeleteDonation(
        decodeURIComponent(donationMatch[1]),
        body,
        headers,
      );
      return json(r.status, r.body);
    }
    return json(404, { error: `未知认证接口: ${method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth]', message);
    return json(500, { error: message });
  }
}
