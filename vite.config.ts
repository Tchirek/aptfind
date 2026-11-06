import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Qoder Sites 是纯静态托管，用相对路径，部署到任意子路径都能打开
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
