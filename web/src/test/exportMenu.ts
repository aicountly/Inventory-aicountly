/**
 * Driving the Export and Print buttons from a test.
 *
 * `ExportActions` renders both buttons as soon as the page mounts but keeps
 * them `disabled` until the rows they would export have arrived, and the print
 * handler returns early under the same condition. So waiting for the button to
 * EXIST proves nothing: a click on the disabled button opens no menu and runs
 * no print, and the assertion that follows fails on a menu item that was never
 * going to appear.
 *
 * On a fast machine the rows are usually there by the time the test clicks, so
 * this reads as a passing test and fails only on a loaded CI runner. Two
 * separate CI runs have now been lost to it. Wait for the button to become
 * enabled instead — that is the page's own signal that the data is in.
 */

import { expect } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

async function enabledButton(name: RegExp): Promise<HTMLButtonElement> {
  const button = (await screen.findByRole('button', { name })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  return button
}

/** Open the export menu once it is live, and choose the format matching `format`. */
export async function pickExport(format: RegExp): Promise<void> {
  fireEvent.click(await enabledButton(/export/i))
  fireEvent.click(await screen.findByRole('menuitem', { name: format }))
}

/** Press Print once it is live. `name` overrides the default match. */
export async function clickPrint(name: RegExp = /print/i): Promise<void> {
  fireEvent.click(await enabledButton(name))
}
