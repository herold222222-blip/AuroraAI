import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { editImage, type EditRequest } from './geminiService';

dotenv.config();

export function createApiApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '40mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
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

  return app;
}
