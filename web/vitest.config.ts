import { defineConfig } from 'vitest/config'

// Unit tests cover pure helpers only (no DOM), so the node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
