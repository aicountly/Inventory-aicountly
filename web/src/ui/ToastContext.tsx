import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { setNotifier } from './notify'

export type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  notify: (kind: ToastKind, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const AUTO_DISMISS_MS = 4500

const TONE: Record<ToastKind, { icon: typeof Info; ring: string; iconCls: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200', iconCls: 'text-emerald-600' },
  error: { icon: AlertCircle, ring: 'border-red-200', iconCls: 'text-red-600' },
  info: { icon: Info, ring: 'border-sky-200', iconCls: 'text-sky-600' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, kind, message }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      )
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (m) => notify('success', m),
      error: (m) => notify('error', m),
      info: (m) => notify('info', m),
    }),
    [notify],
  )

  // Non-React code (export / print / download helpers) reports through the
  // module-scope bridge; wire it to this provider for as long as it is mounted.
  useEffect(() => {
    setNotifier(notify)
    return () => setNotifier(null)
  }, [notify])

  // Never leak a pending dismissal timer across an unmount.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((t) => clearTimeout(t))
      pending.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="aic toast-viewport fixed top-3 right-3 z-[120] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 print:hidden"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => {
          const tone = TONE[t.kind]
          const Icon = tone.icon
          return (
            <div
              key={t.id}
              className={`animate-slide-in-right pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 shadow-overlay ${tone.ring}`}
              role={t.kind === 'error' ? 'alert' : 'status'}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.iconCls}`} aria-hidden />
              <span className="min-w-0 flex-1 text-sm leading-snug text-gray-800 break-words">
                {t.message}
              </span>
              <button
                type="button"
                className="-mr-1 shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
