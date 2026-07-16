import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'production' && visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
  // 生产环境将 console.log / console.debug 替换为无操作函数，treeshake 时删除
  // 保留 console.error / console.warn 用于生产排障
  define: mode === 'production' ? {
    'console.log': '(() => {})',
    'console.debug': '(() => {})',
  } : {},
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    assetsInlineLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react'
            if (id.includes('react-router')) return 'vendor-router'
            if (id.includes('zustand')) return 'vendor-state'
            if (id.includes('@radix-ui')) return 'vendor-radix'
            if (id.includes('framer-motion')) return 'vendor-motion'
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('immer') || id.includes('react-rnd') || id.includes('sonner') || id.includes('react-draggable')) return 'vendor-utils'
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}))