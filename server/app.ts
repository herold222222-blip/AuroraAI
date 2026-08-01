import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { editImage, type EditRequest } from './geminiService';
import { createImageTo3dTask, fetchMeshyAsset, getImageTo3dTask } from './meshyService';

dotenv.config();

export function createApiApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '40mb' }));

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

  app.post('/api/image/edit', async (req, res) => {
    try {
      const body = req.body as EditRequest;
      if (!body?.imageDataUrl || !body?.prompt) {
        res.status(400).json({ error: 'imageDataUrl 与 prompt 必填' });
        return;
      }
      const result = await editImage(body);
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
