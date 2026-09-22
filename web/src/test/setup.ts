import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// React Testing Library only auto-cleans when the test globals are injected;
// this project runs without globals, so unmount explicitly between tests.
afterEach(() => {
  cleanup()
})

// waitFor()'s 1000ms default assumes a dedicated machine. A shared CI runner under load from
// the rest of this ~4,150-test suite can occasionally take longer than that for a callback that
// is not actually broken, which reads as a random, different test failing each run -- the
// signature that sent us looking here in the first place, not a real regression in the code
// under test. A genuinely broken async chain still fails, just after waiting longer first.
configure({ asyncUtilTimeout: 5000 })
