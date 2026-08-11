import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/localmaxxing-api': {
        target: 'https://www.localmaxxing.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/localmaxxing-api/, '/api'),
      },
    },
  },
})
