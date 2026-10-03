import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    emptyOutDir: true,
    outDir: mode === 'release' ? 'dist/release' : 'dist/test',
    sourcemap: true,
    target: 'es2022',
    lib: {
      entry: 'src/extension/index.ts',
      formats: ['es'],
      name: 'AgeBarrier'
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.ts']
  }
}));
