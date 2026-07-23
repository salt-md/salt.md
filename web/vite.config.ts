import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.SALT_PROXY ?? 'http://localhost:8420';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/files': backend,
    },
  },
});
