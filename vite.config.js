import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: './',
  plugins: [preact()],
  build: {
    outDir: 'www',
    emptyOutDir: true
  }
});
