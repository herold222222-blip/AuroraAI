import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import react from '@vitejs/plugin-react';
import { createApiApp } from './server/app';

/** Mount Express API as Vite middleware in dev; production uses server/index.ts :3000 */
function auroraApiPlugin(): Plugin {
  return {
    name: 'aurora-api',
    configureServer(server) {
      const api = createApiApp();
      server.middlewares.use(api);
    },
  };
}

/**
 * 混合联调：仅把 /api/pay 交给本机 Express（读 .env.local 微信配置），
 * 其余 /api 仍走线上代理。这样只需 pnpm dev，不必另开 :3000。
 */
function auroraPayLocalPlugin(): Plugin {
  return {
    name: 'aurora-pay-local',
    configureServer(server) {
      const api = createApiApp();
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url || '';
          if (url === '/api/pay' || url.startsWith('/api/pay/')) {
            // Connect 中间件与 Express Request 类型不完全一致
            return (api as unknown as (
              req: IncomingMessage,
              res: ServerResponse,
              next: () => void,
            ) => void)(req, res, next);
          }
          next();
        },
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = (env.VITE_API_ORIGIN || 'https://www.gnoverse.cn').replace(
    /\/$/,
    '',
  );
  const useDevProxy =
    mode === 'development' &&
    String(env.VITE_DEV_PROXY || '').toLowerCase() === 'true';
  /** 登录等走线上，仅 /api/pay 走本机中间件 */
  const payLocal =
    mode === 'development' &&
    String(env.VITE_DEV_PAY_LOCAL || '').toLowerCase() === 'true';

  return {
    plugins: [
      react(),
      ...(useDevProxy && payLocal ? [auroraPayLocalPlugin()] : []),
      ...(!useDevProxy ? [auroraApiPlugin()] : []),
    ],
    server: {
      proxy: useDevProxy
        ? {
            '/api': {
              target: apiOrigin,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    build: {
      chunkSizeWarningLimit: 4000,
    },
  };
});
