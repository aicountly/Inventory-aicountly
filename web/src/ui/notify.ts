/**
 * Module-scope toast bridge.
 *
 * Inventory's toasts live in a React context (ui/ToastContext.tsx), but the
 * export / print / download code paths are plain modules with no component to
 * call a hook from — Books solves this by importing react-hot-toast at module
 * scope, which Inventory deliberately does not depend on.
 *
 * So: ToastProvider registers its `notify` here on mount, and non-React code
 * imports `notify` directly. Before the provider mounts (or in tests) the sink
 * is a no-op, never a crash.
 */

export type NotifyKind = 'success' | 'error' | 'info'

type Notifier = (kind: NotifyKind, message: string) => void

const noop: Notifier = () => {}

let sink: Notifier = noop

/** Called by ToastProvider. Pass null on unmount to restore the no-op sink. */
export function setNotifier(fn: Notifier | null): void {
  sink = fn ?? noop
}

export const notify = {
  success: (message: string): void => sink('success', message),
  error: (message: string): void => sink('error', message),
  info: (message: string): void => sink('info', message),
  /** Escape hatch for code that already has the kind in a variable. */
  emit: (kind: NotifyKind, message: string): void => sink(kind, message),
}
