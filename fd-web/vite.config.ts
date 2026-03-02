import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * Vite 插件：覆盖 n8n 的 base-path.js，让 Vue Router 使用 /n8n/ 子路径。
 * 必须注册在 proxy 之前，否则 /static 代理会先拦截。
 */
function n8nBasePath(): Plugin {
  return {
    name: 'n8n-base-path',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/static/base-path.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end("window.BASE_PATH = '/n8n/';");
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [n8nBasePath(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 5173,
    strictPort: false,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:9988',
        changeOrigin: true,
      },
      '/h2-console': {
        target: 'http://localhost:9988',
        changeOrigin: true,
      },
      '/bridge': {
        target: 'http://localhost:9987',
        changeOrigin: true,
      },
      // ---- n8n 同源代理（iframe 嵌入需要同源才能使用 cookie 登录） ----
      '/n8n': {
        target: 'http://localhost:5678',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/n8n/, ''),
        ws: true,
      },
      '/rest': {
        target: 'http://localhost:5678',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:5678',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://localhost:5678',
        changeOrigin: true,
      },
      '/push': {
        target: 'http://localhost:5678',
        changeOrigin: true,
        ws: true,
      },
      '/healthz': {
        target: 'http://localhost:5678',
        changeOrigin: true,
      },
    },
  },
});
