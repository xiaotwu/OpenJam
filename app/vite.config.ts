import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['SHIORI_', 'VITE_'])
  return {
    plugins: [react()],
    // Expose only the client settings. SHIORI_* also includes server credentials.
    define: {
      'import.meta.env.SHIORI_API_URL': JSON.stringify(env.SHIORI_API_URL ?? env.VITE_API_URL ?? ''),
      'import.meta.env.SHIORI_WS_URL': JSON.stringify(env.SHIORI_WS_URL ?? env.VITE_WS_URL ?? ''),
      'import.meta.env.SHIORI_BUILD': JSON.stringify(env.SHIORI_BUILD ?? ''),
    },
    server: {
      port: 5173,
      host: true, // Allow external access (needed for ngrok)
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:8080',
          ws: true,
        },
      },
    },
  }
})
