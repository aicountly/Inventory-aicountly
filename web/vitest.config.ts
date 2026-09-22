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
    // Vitest's 5000ms default assumes a dedicated machine. On a shared CI runner under load
    // from the rest of this suite, a test that is not actually broken can occasionally need
    // longer than that -- see src/test/setup.ts's asyncUtilTimeout for the matching waitFor()
    // increase and the failure pattern (a different test timing out each run) that led here.
    testTimeout: 15000,
    hookTimeout: 15000,
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
          // The print sheet is a standalone document that links the webfont it
          // needs. A test that parses one must not go and fetch it: the suite
          // has to run offline, and a remote stylesheet proves nothing here.
          environmentOptions: {
            happyDOM: {
              settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
                handleDisabledFileLoadingAsSuccess: true,
              },
            },
          },
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})
