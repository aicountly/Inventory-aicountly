/**
 * Open a date/month input's native picker on click.
 *
 * Without this the tiny calendar glyph is the only hit target, which is a
 * recurring complaint on data-entry screens.
 */
export function openNativePicker(input: HTMLInputElement | null | undefined): void {
  if (!input || input.disabled || input.readOnly) return
  try {
    input.showPicker?.()
  } catch {
    // Browsers throw if the picker is already open or the gesture was not
    // user-initiated — never worth surfacing.
  }
}
