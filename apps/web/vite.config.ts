import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // One .env at the monorepo root, shared with the scripts. Without this Vite
  // reads apps/web/.env only, and the app renders "escrow not deployed" against
  // a chain where it plainly is.
  envDir: '../..',
  server: {
    port: 5173,
    // Duel links are real paths (/d/<chainId>/<escrow>/<duelId>, §5.3), so every
    // unknown path must fall through to index.html.
    fs: { strict: false },
  },
  preview: { port: 4173 },
});
