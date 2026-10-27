import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: { store: 'src/client/store.ts', admin: 'admin/index.html' },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'admin' ? 'assets/admin-[hash].js' : 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (info) =>
          info.names.some((n) => n.endsWith('.css'))
            ? 'assets/style.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
