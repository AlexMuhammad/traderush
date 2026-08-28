import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Duel links are real paths (/d/<chainId>/<escrow>/<duelId>, §5.3), so every
    // unknown path must fall through to index.html.
    fs: { strict: false },
  },
  preview: { port: 4173 },
});
