import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Modal } from './Modal'

/**
 * `aria-modal="true"` is a promise to assistive technology that nothing behind
 * the dialog is reachable. Two things have to hold it up: Tab must not leave,
 * and the page behind must not scroll — and the page behind scrolls in `main`,
 * not in the body.
 */

function shell(children: string = '<button type="button" id="behind">Behind</button>') {
  const main = document.createElement('main')
  main.className = 'app-main'
  main.innerHTML = children
  document.body.append(main)
  return main
}

afterEach(() => {
  document.querySelectorAll('main.app-main').forEach((el) => el.remove())
  document.body.removeAttribute('style')
})

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  return render(
    <Modal open title="Edit item" onClose={() => {}} {...props}>
      <input aria-label="Name" />
      <button type="button">Save</button>
    </Modal>,
  )
}

describe('Modal', () => {
  it('locks the scroll container the shell actually scrolls', () => {
    const main = shell()
    const { unmount } = renderModal()
    expect(main.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('')
    unmount()
    expect(main.style.overflow).toBe('')
  })

  it('falls back to the body when there is no shell to lock', () => {
    const { unmount } = renderModal()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps Tab inside the dialog', async () => {
    shell()
    renderModal()
    const panel = screen.getByRole('dialog')
    const stops = [...panel.querySelectorAll<HTMLElement>('input, button')]
    const first = stops[0]
    const last = stops[stops.length - 1]

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('moves focus to the first field on opening', async () => {
    shell()
    renderModal()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')))
  })

  it('returns focus to whatever opened it', async () => {
    const trigger = shell().querySelector('#behind') as HTMLElement
    trigger.focus()
    const { rerender } = render(
      <Modal open title="Edit item" onClose={() => {}}>
        <input aria-label="Name" />
      </Modal>,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')))
    act(() => {
      rerender(
        <Modal open={false} title="Edit item" onClose={() => {}}>
          <input aria-label="Name" />
        </Modal>,
      )
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Escape, but not while a save is in flight', () => {
    shell()
    const onClose = vi.fn()
    const { rerender } = renderModal({ onClose, busy: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    rerender(
      <Modal open title="Edit item" onClose={onClose}>
        <input aria-label="Name" />
        <button type="button">Save</button>
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
