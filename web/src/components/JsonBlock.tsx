interface JsonBlockProps {
  value: unknown
  label?: string
  open?: boolean
}

/** Collapsible pretty-printed JSON (audit before / after, outbox payloads). */
export function JsonBlock({ value, label = 'Details', open = false }: JsonBlockProps) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return (
    <details className="json-block" open={open}>
      <summary>{label}</summary>
      <pre className="mono">{text}</pre>
    </details>
  )
}
