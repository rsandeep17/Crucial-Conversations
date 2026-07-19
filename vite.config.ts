import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiPlugin } from './server/apiPlugin';

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    port: 5173,
    // Fail loudly rather than silently hopping ports, so start.bat opens the right URL.
    strictPort: true,
  },
});
