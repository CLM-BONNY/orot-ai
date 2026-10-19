import { defineConfig } from 'vite';

const api = process.env.AI_STUDY_API_URL || 'http://127.0.0.1:8018';
export default defineConfig({
  server: { proxy: { '/api': api, '/content': api } },
  preview: { proxy: { '/api': api, '/content': api } },
});
