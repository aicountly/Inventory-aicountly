import type { ReactNode } from 'react'

export type NoticeKind = 'error' | 'warning' | 'success' | 'info'

interface NoticeProps {
  kind?: NoticeKind
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

const ROLE: Record<NoticeKind, 'alert' | 'status'> = {
  error: 'alert',
  warning: 'status',
  success: 'status',
  info: 'status',
}

export function Notice({ kind = 'info', title, children, actions }: NoticeProps) {
  return (
    <div className={`notice notice-${kind}`} role={ROLE[kind]}>
      <div className="notice-body">
        {title ? <span className="notice-title">{title}</span> : null}
        {children}
      </div>
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  )
}
