import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useQuery } from './useQuery'

/**
 * The tenant-switch guard.
 *
 * `keepData` exists so a page change or a date tweak does not blank the screen,
 * and that is right — until the company changes, where holding the previous
 * company's figures under the new company's name is another tenant's data on
 * screen. `resetKey` is what stops that, and it has to drop the data in render
 * rather than in an effect: an effect runs after the browser has painted, which
 * is one visible frame of the wrong company's numbers.
 */
function Probe({ scope, resolve }: { scope: string; resolve: (scope: string) => Promise<string> }) {
  const q = useQuery((_signal) => resolve(scope), [scope], { resetKey: scope })
  return (
    <div>
      <span data-testid="scope">{scope}</span>
      <span data-testid="value">{q.data ?? 'none'}</span>
      <span data-testid="loading">{q.loading ? 'loading' : 'idle'}</span>
    </div>
  )
}

function Harness({ resolve }: { resolve: (scope: string) => Promise<string> }) {
  const [scope, setScope] = useState('company-a')
  return (
    <>
      <button type="button" onClick={() => setScope('company-b')}>
        switch
      </button>
      <Probe scope={scope} resolve={resolve} />
    </>
  )
}

describe('useQuery resetKey', () => {
  it('never shows the previous tenant\'s data under the new tenant', async () => {
    let releaseB: ((value: string) => void) | null = null
    const resolve = (scope: string) =>
      scope === 'company-a'
        ? Promise.resolve('A figures')
        : new Promise<string>((res) => {
            releaseB = res
          })

    render(<Harness resolve={resolve} />)
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('A figures'))

    // Switch companies. Company B's request is deliberately left in flight.
    await act(async () => {
      screen.getByText('switch').click()
    })

    // The instant the scope changes, A's figures are gone — not still on screen
    // behind a spinner.
    expect(screen.getByTestId('scope').textContent).toBe('company-b')
    expect(screen.getByTestId('value').textContent).toBe('none')

    await act(async () => {
      releaseB?.('B figures')
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('B figures'))
  })

  it('keeps data across a change that is not a tenant change', async () => {
    // The other half of the contract: a filter tweak must NOT blank the page,
    // or every date change flashes an empty dashboard.
    // The second request is held open on purpose: an immediately-resolved
    // promise lands inside the same act() and there is no in-flight state left
    // to observe, which would make this test pass for the wrong reason.
    let releaseSecond: ((value: string) => void) | null = null

    function DateProbe() {
      const [asOf, setAsOf] = useState('2026-09-15')
      const q = useQuery(
        (_s) =>
          asOf === '2026-09-15'
            ? Promise.resolve('value for 2026-09-15')
            : new Promise<string>((res) => {
                releaseSecond = res
              }),
        [asOf],
        { resetKey: 'same-tenant' },
      )
      return (
        <>
          <button type="button" onClick={() => setAsOf('2026-08-31')}>
            change date
          </button>
          <span data-testid="value">{q.data ?? 'none'}</span>
        </>
      )
    }

    render(<DateProbe />)
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('value for 2026-09-15'))

    await act(async () => {
      screen.getByText('change date').click()
    })
    // Still showing the old figure while the new one is in flight — the whole
    // point of keepData.
    expect(screen.getByTestId('value').textContent).toBe('value for 2026-09-15')

    await act(async () => {
      releaseSecond?.('value for 2026-08-31')
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('value for 2026-08-31'))
  })
})
