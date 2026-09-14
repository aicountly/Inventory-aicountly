import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useAccess } from '../access/AccessContext'
import { collectNavLeaves } from '../config/navRegistry'
import type { NavLeaf } from '../config/navRegistry'
import { COMMAND_PALETTE_EVENT } from '../keyboard/shortcutRegistry'
import { Kbd } from '../ui/Kbd'
import { cx } from '../ui/cx'

interface Command {
  id: string
  label: string
  section: string
  description?: string
  path: string
  icon?: NavLeaf['icon']
  permissions?: readonly string[]
  /** Lower-cased haystack, built once. */
  haystack: string
}

/**
 * Score a command against the query. Word-prefix matches rank above
 * mid-word ones so typing "st" finds "Stock" before "Cost layers", and a
 * subsequence match still keeps fuzzy typing ("wrhs") working.
 */
function score(cmd: Command, query: string): number {
  if (!query) return 0
  const label = cmd.label.toLowerCase()
  if (label === query) return 1000
  if (label.startsWith(query)) return 800
  const words = label.split(/\s+/)
  if (words.some((w) => w.startsWith(query))) return 600
  const idx = cmd.haystack.indexOf(query)
  if (idx >= 0) return 400 - Math.min(idx, 200)
  // Subsequence fallback.
  let pos = -1
  for (const ch of query) {
    pos = cmd.haystack.indexOf(ch, pos + 1)
    if (pos === -1) return -1
  }
  return 100
}

/**
 * Ctrl+K palette over the whole navigation model.
 *
 * It is opened by a CustomEvent rather than a prop so anything — the topbar
 * button, a keyboard shortcut, an empty state — can summon it without the
 * shell threading a callback through the tree.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const { can, loading } = useAccess()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const commands = useMemo<Command[]>(() => {
    return collectNavLeaves()
      .filter(({ leaf }) => Boolean(leaf.path))
      .filter(({ leaf }) => loading || !leaf.permissions || can(leaf.permissions))
      .map(({ section, leaf }) => ({
        id: `${section}:${leaf.label}:${leaf.path}`,
        label: leaf.label,
        section,
        description: leaf.description,
        path: leaf.path as string,
        icon: leaf.icon,
        permissions: leaf.permissions,
        haystack: `${leaf.label} ${section} ${leaf.description ?? ''}`.toLowerCase(),
      }))
  }, [can, loading])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 12)
    return commands
      .map((cmd) => ({ cmd, s: score(cmd, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((r) => r.cmd)
  }, [commands, query])

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ filter?: string }>).detail
      setQuery(detail?.filter ?? '')
      setActiveIndex(0)
      setOpen(true)
    }
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpen)
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const run = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return
      setOpen(false)
      navigate(cmd.path)
    },
    [navigate],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      run(results[activeIndex])
    }
  }

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open) return null

  return (
    <div
      className="aic fixed inset-0 z-[110] flex items-start justify-center bg-gray-900/50 p-4 pt-[12vh] backdrop-blur-sm print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
      data-keyboard-overlay="true"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-keyboard-overlay="true"
        className="flex max-h-[60vh] w-full max-w-xl animate-rise-in flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-overlay"
        onKeyDown={onKeyDown}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          {/* Focus never leaves the input — the highlight below is announced
              through aria-activedescendant, which is the only way a screen
              reader learns that ArrowDown moved anything. */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a screen…"
            aria-label="Search screens"
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <p role="status" className="sr-only">
          {results.length === 0
            ? 'No screens match'
            : `${results.length} ${results.length === 1 ? 'screen' : 'screens'}`}
        </p>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Screens"
          className="min-h-0 flex-1 overflow-auto scrollbar-thin p-1.5"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-8 text-center text-sm text-gray-500">
              Nothing matches “{query}”.
            </li>
          ) : null}
          {results.map((cmd, index) => {
            const Icon = cmd.icon
            const active = index === activeIndex
            return (
              <li key={cmd.id} role="presentation" data-index={index}>
                <button
                  type="button"
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  // Not a tab stop: the input owns focus for the whole widget.
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(cmd)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-primary-light text-primary' : 'text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{cmd.label}</span>
                    <span className="block truncate text-[11px] text-gray-500">{cmd.section}</span>
                  </span>
                  {active ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex shrink-0 items-center gap-3 border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Enter</Kbd> to open
          </span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
