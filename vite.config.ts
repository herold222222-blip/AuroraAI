import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  plugins: [react(), auroraApiPlugin()],
  server: {
    proxy: {
      // Fallback if middleware not hit (e.g. preview with external API)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
