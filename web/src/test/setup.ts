import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// React Testing Library only auto-cleans when the test globals are injected;
// this project runs without globals, so unmount explicitly between tests.
afterEach(() => {
  cleanup()
})
