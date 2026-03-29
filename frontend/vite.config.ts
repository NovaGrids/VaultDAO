import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { resolve } from 'path'

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
        manualChunks(id) {
          // PDF / image export — loaded only in AdvancedChart / ExportModal
          if (id.includes('jspdf') || id.includes('jspdf-autotable') || id.includes('html2canvas')) {
            return 'vendor-pdf';
          }
          // Collaborative editing (yjs, y-websocket)
          if (id.includes('yjs') || id.includes('y-websocket') || id.includes('lib0')) {
            return 'vendor-collab';
          }
          // IPFS — only used in IPFSUploader
          if (id.includes('ipfs-http-client') || id.includes('multiformats') || id.includes('@ipld')) {
            return 'vendor-ipfs';
          }
          // Video player — only used in VideoPlayer
          if (id.includes('react-player')) {
            return 'vendor-player';
          }
          // Grid layout — only used in DashboardBuilder
          if (id.includes('react-grid-layout')) {
            return 'vendor-grid';
          }
          // Charts
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-')) {
            return 'vendor-charts';
          }
          // Stellar / Soroban
          if (
            id.includes('stellar-sdk') ||
            id.includes('@stellar/') ||
            id.includes('@soroban-react') ||
            id.includes('stellar-base')
          ) {
            return 'vendor-soroban';
          }
          // Drag-and-drop
          if (id.includes('@dnd-kit')) {
            return 'vendor-dnd';
          }
          // Fuzzy search
          if (id.includes('fuse.js')) {
            return 'vendor-fuse';
          }
          // i18n
          if (id.includes('i18next') || id.includes('react-i18next')) {
            return 'vendor-i18n';
          }
          // Core React runtime
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // React ecosystem (router, hooks, etc.)
          if (id.includes('node_modules/react-')) {
            return 'vendor-react-ecosystem';
          }
          // UI utilities
          if (id.includes('lucide-react') || id.includes('qrcode.react')) {
            return 'vendor-ui';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    sourcemap: false,
    reportCompressedSize: true,
    cssCodeSplit: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
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
