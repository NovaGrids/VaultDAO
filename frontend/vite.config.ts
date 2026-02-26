import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['@babel/plugin-transform-runtime', { useESModules: true }],
        ],
      },
    }),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html',
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-soroban': ['@soroban-react/core', '@stellar/freighter-api', 'stellar-sdk'],
          'vendor-ui': ['lucide-react', 'qrcode.react'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    // Performance optimizations
    sourcemap: false,
    reportCompressedSize: true,
    cssCodeSplit: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'recharts',
      'lucide-react',
      'stellar-sdk',
    ],
  },
})
