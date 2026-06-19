import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  // React is provided by the host (the design runtime / consuming app).
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
