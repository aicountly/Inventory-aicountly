import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'

/**
 * The toast viewport is a fixed overlay pinned to the same corner as the
 * topbar's own controls, so its geometry is only correct relative to the
 * topbar — which is why the topbar's height is read from the topbar rather
 * than repeated here.
 */

/** Tailwind's spacing scale: one step is 0.25rem. */
const step = (n: number) => n * 0.25

function classNumber(className: string, prefix: string): number | null {
  const found = new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(className)
  return found ? Number(found[1]) : null
}

function topbarHeightRem(): number {
  const src = readFileSync(resolve(process.cwd(), 'src/layout/AppTopbar.tsx'), 'utf8')
  const header = /<header className="([^"]*app-topbar[^"]*)"/.exec(src)?.[1] ?? ''
  const height = classNumber(header, 'h')
  expect(height, 'the topbar no longer declares a fixed height').not.toBeNull()
  return step(height as number)
}

function Emit() {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast.success('Saved')}>
      emit
    </button>
  )
}

function renderToasts() {
  render(
    <ToastProvider>
      <Emit />
    </ToastProvider>,
  )
  act(() => {
    screen.getByText('emit').click()
  })
  return document.querySelector('.toast-viewport') as HTMLElement
}

describe('toast viewport', () => {
  it('sits clear of the topbar it would otherwise cover', () => {
    const viewport = renderToasts()
    const top = classNumber(viewport.className, 'top')
    expect(top, 'the viewport is no longer pinned to the top').not.toBeNull()
    expect(step(top as number)).toBeGreaterThanOrEqual(topbarHeightRem())
  })

  it('lets clicks through everywhere except the toasts themselves', () => {
    const viewport = renderToasts()
    expect(viewport.className).toContain('pointer-events-none')
    const toast = screen.getByRole('status')
    expect(toast.className).toContain('pointer-events-auto')
  })
})
