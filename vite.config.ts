import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import react from '@vitejs/plugin-react';
import { syncOrtWasm } from './scripts/sync-ort-wasm.mjs';

process.env.NODE_USE_ENV_PROXY ??= '1';

/** Self-host onnxruntime-web WASM under /ort (avoids blocked jsDelivr). */
function ortWasmPlugin(): Plugin {
  const sync = () => {
    try {
      const { copied } = syncOrtWasm();
      if (copied.length) {
        console.log(`[ort-wasm] public/ort ← ${copied.length} files`);
      }
    } catch (e) {
      console.warn('[ort-wasm] sync failed', e);
    }
  };
  return {
    name: 'ort-wasm-sync',
    buildStart() {
      sync();
    },
    configureServer() {
      sync();
    },
  };
}

/** Mount Express API as Vite middleware in dev; production uses server/index.ts :3000 */
function auroraApiPlugin(): Plugin {
  return {
    name: 'aurora-api',
    async configureServer(server) {
      // 动态导入：避免 `vite build` 加载 Express/Redis 导致进程挂住不退出
      const { createApiApp } = await import('./server/app');
      const api = createApiApp();
      // Only hand /api to Express — otherwise it 404s /ort and other static paths.
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
          return (api as unknown as (
            req: IncomingMessage,
            res: ServerResponse,
            next: () => void,
          ) => void)(req, res, next);
        }
        next();
      });
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
    async configureServer(server) {
      const { createApiApp } = await import('./server/app');
      const api = createApiApp();
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url || '';
          if (url === '/api/pay' || url.startsWith('/api/pay/')) {
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
      ortWasmPlugin(),
      // 默认 VITE_DEV_PROXY=false：全部 /api 走本机 Express。
      // VITE_DEV_PROXY=true：/api 代理到线上；再开 VITE_DEV_PAY_LOCAL 则仅支付走本机。
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
              // 现网 nginx 会剥掉一层 /api，这里补回，否则 /api/image/edit → Express /image/edit 404
              rewrite: (path) => `/api${path}`,
            },
          }
        : undefined,
    },
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    build: {
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: 0,
    },
  };
});
