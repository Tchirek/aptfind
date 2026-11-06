import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * 仅开发服务器：接收 tools/amap.html 采集到的高德数据，写进 pipeline/raw/amap/。
 * 生产构建里不存在这个接口。
 */
function collectPlugin(): Plugin {
  const dir = resolve(import.meta.dirname, 'pipeline/raw/amap');
  return {
    name: 'jianguang-collect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__collect', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[\w-]+$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.json`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // Qoder Sites 是纯静态托管，用相对路径，部署到任意子路径都能打开
  base: './',
  plugins: [react(), collectPlugin()],
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
