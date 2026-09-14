import { defineConfig } from 'vitest/config'

/**
 * Two projects, on purpose.
 *
 * `unit` is the original suite: pure helpers, node environment, no DOM. It is
 * unchanged — same include glob, same environment — so none of the existing
 * tests gained a dependency or a global they did not have before.
 *
 * `dom` is new and covers the rendered UI primitives (`*.test.tsx`) under
 * happy-dom with React Testing Library.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})
