import { loadServerEnv } from '../server/loadEnv';
loadServerEnv();
import { editImage } from '../server/geminiService';

(async () => {
  try {
    console.log('Loaded ENV GEMINI_API_KEY=', process.env.GEMINI_API_KEY ? 'SET' : 'MISSING');
    const result = await editImage({
      imageDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
      prompt: 'test real via script',
    });
    console.log('RESULT:', result);
  } catch (err) {
    console.error('CALL ERROR:', err && (err.stack || err));
    process.exit(1);
  }
})();
