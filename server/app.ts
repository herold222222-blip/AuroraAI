import express from 'express';
import cors from 'cors';
import { editImage, type EditRequest } from './geminiService';
import { createImageTo3dTask, fetchMeshyAsset, getImageTo3dTask } from './meshyService';
import {
  assertUsageFromAuthHeader,
  bumpUsageFromAuthHeader,
  handleDefaults,
  handleDeleteApi,
  handleDeleteDonation,
  handleDeleteUser,
  handleDonate,
  handleGetDocs,
  handleListApis,
  handleListDonations,
  handleAdminStats,
  handleAdjustExtraCredits,
  handleListUsers,
  handleLogin,
  handleMe,
  handlePublicApis,
  handleRegister,
  handleSaveDocs,
  handleSendSms,
  handleTrackUsage,
  handleUpdateApi,
  handleUpdateProfile,
  handleUpdateUser,
} from './authHandlers';
import {
  handleCreateDonateOrder,
  handleDonateOrderStatus,
  handleGetPendingDonateOrder,
  handleListMyDonateRecords,
  handleUpdateDonateOrderMessage,
  handleWechatPayNotify,
} from './payHandlers';
import { ensureSeedAdmin, QuotaExceededError } from './userStore';
import { loadServerEnv } from './loadEnv';

loadServerEnv();

function reqHeaders(req: express.Request) {
  const headers = {
    ...(req.headers as Record<string, string | string[] | undefined>),
  };
  // Local Vite/Express often has no X-Forwarded-For; fall back to socket IP.
  if (!headers['x-forwarded-for'] && !headers['x-real-ip']) {
    const ip =
      req.ip ||
      req.socket?.remoteAddress ||
      (req as express.Request & { connection?: { remoteAddress?: string } })
        .connection?.remoteAddress;
    if (ip) headers['x-real-ip'] = ip.replace(/^::ffff:/, '');
  }
  return headers;
}

type ReqWithRaw = express.Request & { rawBody?: string };

/** 线上 nginx `location /api` 常把前缀剥掉，Express 实际收到 /image/edit。 */
const STRIPPED_API_PREFIXES = [
  '/health',
  '/auth',
  '/image',
  '/meshy',
  '/pay',
  '/projects',
  '/assets',
];

function restoreStrippedApiPrefix(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  const url = req.url || '';
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    next();
    return;
  }
  const pathOnly = url.split('?')[0];
  if (
    STRIPPED_API_PREFIXES.some(
      (p) => pathOnly === p || pathOnly.startsWith(`${p}/`),
    )
  ) {
    req.url = `/api${url}`;
  }
  next();
}

export function createApiApp() {
  const app = express();
  app.use(cors());
  app.use(restoreStrippedApiPrefix);

  // 微信支付回调需要原始 body 验签，必须在 json parser 之前挂载
  app.post(
    '/api/pay/wechat/notify',
    express.raw({ type: '*/*', limit: '2mb' }),
    async (req, res) => {
      const raw =
        Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : String(req.body || '');
      const r = await handleWechatPayNotify(raw, reqHeaders(req));
      if (r.contentType) res.setHeader('Content-Type', r.contentType);
      res.status(r.status).send(r.rawBody ?? JSON.stringify(r.body));
    },
  );

  app.use(
    express.json({
      limit: '40mb',
      verify: (req, _res, buf) => {
        (req as ReqWithRaw).rawBody = buf.toString('utf8');
      },
    }),
  );

  void ensureSeedAdmin().catch((err) =>
    console.error('[auth] seed admin failed', err),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      hasQwenKey: Boolean(
        process.env.DASHSCOPE_API_KEY ||
          process.env.QWEN_API_KEY ||
          process.env.QWEN_IMAGE_API_KEY,
      ),
      hasMeshyKey: Boolean(process.env.MESHY_API_KEY),
    });
  });

  app.get('/api/auth/defaults', async (_req, res) => {
    const r = await handleDefaults();
    res.status(r.status).json(r.body);
  });
  app.get('/api/auth/docs', async (_req, res) => {
    const r = await handleGetDocs();
    res.status(r.status).json(r.body);
  });
  app.put('/api/auth/docs', async (req, res) => {
    const r = await handleSaveDocs(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/auth/apis/public', async (_req, res) => {
    const r = await handlePublicApis();
    res.status(r.status).json(r.body);
  });
  app.get('/api/auth/apis', async (req, res) => {
    const r = await handleListApis(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.patch('/api/auth/apis/:id', async (req, res) => {
    const r = await handleUpdateApi(
      req.params.id,
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });
  app.delete('/api/auth/apis/:id', async (req, res) => {
    const r = await handleDeleteApi(req.params.id, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/auth/me', async (req, res) => {
    const r = await handleMe(reqHeaders(req));
    res.status(r.status).json(r.body);
  });

  // Project workspace persistence（先注册精确路径，再注册 :id）
  app.post('/api/projects/save', async (req, res) => {
    const { handleSaveProject } = await import('./projectHandlers');
    return handleSaveProject(req, res);
  });
  app.get('/api/projects', async (req, res) => {
    const { handleListMyProjects } = await import('./projectHandlers');
    return handleListMyProjects(req, res);
  });
  app.get('/api/projects/:id', async (req, res) => {
    const { handleGetProject } = await import('./projectHandlers');
    return handleGetProject(req, res);
  });
  app.delete('/api/projects/:id', async (req, res) => {
    const { handleDeleteProject } = await import('./projectHandlers');
    return handleDeleteProject(req, res);
  });

  // Assets manifest (OSS)
  app.get('/api/assets/manifest', async (req, res) => {
    const { handleListAssets } = await import('./assetHandlers');
    return handleListAssets(req, res);
  });
  app.get('/api/auth/users', async (req, res) => {
    const r = await handleListUsers(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/auth/stats', async (req, res) => {
    const r = await handleAdminStats(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/register', async (req, res) => {
    const r = await handleRegister(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/sms/send', async (req, res) => {
    const r = await handleSendSms(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/login', async (req, res) => {
    const r = await handleLogin(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/track', async (req, res) => {
    const r = await handleTrackUsage(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.patch('/api/auth/users/:id', async (req, res) => {
    const r = await handleUpdateUser(
      req.params.id,
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/users/:id/credits', async (req, res) => {
    const r = await handleAdjustExtraCredits(
      req.params.id,
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });
  app.delete('/api/auth/users/:id', async (req, res) => {
    const r = await handleDeleteUser(
      req.params.id,
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });
  app.patch('/api/auth/profile', async (req, res) => {
    const r = await handleUpdateProfile(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/donate', async (req, res) => {
    const r = await handleDonate(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });

  app.post('/api/pay/donate/create', async (req, res) => {
    const r = await handleCreateDonateOrder(req.body || {}, reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/pay/donate/pending', async (req, res) => {
    const r = await handleGetPendingDonateOrder(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/pay/donate/records', async (req, res) => {
    const r = await handleListMyDonateRecords(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.get('/api/pay/donate/status/:outTradeNo', async (req, res) => {
    const r = await handleDonateOrderStatus(
      req.params.outTradeNo,
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });
  app.patch('/api/pay/donate/message', async (req, res) => {
    const r = await handleUpdateDonateOrderMessage(
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });

  app.get('/api/auth/donations', async (req, res) => {
    const r = await handleListDonations(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.delete('/api/auth/donations/:id', async (req, res) => {
    const r = await handleDeleteDonation(
      req.params.id,
      req.body || {},
      reqHeaders(req),
    );
    res.status(r.status).json(r.body);
  });

  app.post('/api/image/edit', async (req, res) => {
    try {
      console.log('[image/edit] incoming request, MOCK_MODEL=', process.env.MOCK_MODEL, 'NODE_ENV=', process.env.NODE_ENV);
      const body = req.body as EditRequest;
      if (!body?.imageDataUrl || !body?.prompt) {
        res.status(400).json({ error: 'imageDataUrl 与 prompt 必填' });
        return;
      }
      const { usageKindFromEditModel } = await import('./authTypes');
      const usageKind = usageKindFromEditModel(body.model);
      try {
        await assertUsageFromAuthHeader(reqHeaders(req), usageKind);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof QuotaExceededError ? 403 : 400;
        res.status(status).json({ error: message });
        return;
      }
      const result = await editImage(body);
      try {
        await bumpUsageFromAuthHeader(reqHeaders(req), usageKind);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          res.status(403).json({ error: err.message });
          return;
        }
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error('[image/edit] error object:', err);
      console.error('[image/edit]', message);
      if (process.env.NODE_ENV !== 'production') {
        res.status(500).json({ error: message, stack });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  app.post('/api/meshy/image-to-3d', async (req, res) => {
    try {
      const {
        imageDataUrl,
        enablePbr,
        shouldTexture,
        textureResolution,
        modelType,
        aiModel,
        targetPolycount,
      } = req.body as {
        imageDataUrl?: string;
        enablePbr?: boolean;
        shouldTexture?: boolean;
        textureResolution?: '2k' | '4k' | '8k';
        modelType?: 'standard' | 'smart-topology';
        aiModel?: string;
        targetPolycount?: number;
      };
      if (!imageDataUrl) {
        res.status(400).json({ error: 'imageDataUrl 必填' });
        return;
      }
      const result = await createImageTo3dTask({
        imageDataUrl,
        enablePbr,
        shouldTexture,
        textureResolution,
        modelType,
        aiModel,
        targetPolycount,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[meshy/image-to-3d]', message);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/meshy/image-to-3d/:id', async (req, res) => {
    try {
      const data = await getImageTo3dTask(req.params.id);
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[meshy/image-to-3d/:id]', message);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/meshy/asset', async (req, res) => {
    try {
      const url = typeof req.query.url === 'string' ? req.query.url : '';
      if (!url) {
        res.status(400).json({ error: 'url 必填' });
        return;
      }
      const { buffer, contentType } = await fetchMeshyAsset(url);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[meshy/asset]', message);
      res.status(500).json({ error: message });
    }
  });

  return app;
}
