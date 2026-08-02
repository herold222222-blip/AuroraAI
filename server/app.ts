import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
} from './authHandlers';
import { ensureSeedAdmin, QuotaExceededError } from './userStore';

dotenv.config();

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

export function createApiApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '40mb' }));

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
  app.get('/api/auth/users', async (req, res) => {
    const r = await handleListUsers(reqHeaders(req));
    res.status(r.status).json(r.body);
  });
  app.post('/api/auth/register', async (req, res) => {
    const r = await handleRegister(req.body || {}, reqHeaders(req));
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
      const body = req.body as EditRequest;
      if (!body?.imageDataUrl || !body?.prompt) {
        res.status(400).json({ error: 'imageDataUrl 与 prompt 必填' });
        return;
      }
      try {
        await assertUsageFromAuthHeader(reqHeaders(req), 'imageEdit');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof QuotaExceededError ? 403 : 400;
        res.status(status).json({ error: message });
        return;
      }
      const result = await editImage(body);
      try {
        await bumpUsageFromAuthHeader(reqHeaders(req), 'imageEdit');
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          res.status(403).json({ error: err.message });
          return;
        }
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[image/edit]', message);
      res.status(500).json({ error: message });
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
