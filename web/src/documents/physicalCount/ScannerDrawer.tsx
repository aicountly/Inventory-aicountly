import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CameraOff, Minus, Plus, ScanBarcode } from 'lucide-react'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { Input } from '../../ui/Input'
import { Notice } from '../../components/Notice'
import { cx } from '../../ui/cx'
import { formatQty, toNumber } from '../../utils/format'
import type { LineDraft } from '../formModel'
import type { CountRow } from './countModel'

/**
 * Counting with a scanner.
 *
 * The default path is a keyboard wedge — the gun types the code and presses
 * Enter — because that is what is actually strapped to a warehouse trolley. The
 * field re-focuses itself after every scan so a hundred units go in without a
 * hand leaving the trolley, and a scan that matches nothing is REPORTED rather
 * than swallowed: a silent no-match is how a count ends up short by exactly the
 * units somebody thought they had scanned.
 *
 * The camera is offered only where the browser has `BarcodeDetector`, and only
 * starts on an explicit click. Nothing on this page asks for a camera on load.
 */

type ScanOutcome = 'counted' | 'not_found' | 'ambiguous'

interface ScanEvent {
  id: number
  term: string
  outcome: ScanOutcome
  lineKey: string | null
  label: string
}

/** Minimal shape of the Barcode Detection API — not in lib.dom yet. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function barcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

export interface ScannerDrawerProps {
  open: boolean
  onClose: () => void
  rows: readonly CountRow[]
  onPatchLine: (key: string, patch: Partial<LineDraft>) => void
  /** Reveals the row in the sheet behind the drawer. */
  onHighlight: (lineKey: string) => void
  warehouseName: (id: number | null | undefined) => string
  disabled?: boolean
}

export function ScannerDrawer({
  open,
  onClose,
  rows,
  onPatchLine,
  onHighlight,
  warehouseName,
  disabled = false,
}: ScannerDrawerProps) {
  const [term, setTerm] = useState('')
  const [addOnePerScan, setAddOnePerScan] = useState(true)
  const [current, setCurrent] = useState<string | null>(null)
  const [events, setEvents] = useState<ScanEvent[]>([])
  const [message, setMessage] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const nextId = useRef(1)

  const currentRow = useMemo(() => rows.find((r) => r.line.key === current) ?? null, [rows, current])

  /** Every string that should find a line, mapped to the lines it finds. */
  const index = useMemo(() => {
    const map = new Map<string, CountRow[]>()
    const add = (value: string | null | undefined, row: CountRow) => {
      const key = (value ?? '').trim().toLowerCase()
      if (!key) return
      map.set(key, [...(map.get(key) ?? []), row])
    }
    for (const row of rows) {
      add(row.line.item_sku, row)
      add(row.line.item_name, row)
      add(row.line.batch_no, row)
      for (const s of row.line.serials) add(s.serial_no, row)
    }
    return map
  }, [rows])

  const record = useCallback((event: Omit<ScanEvent, 'id'>) => {
    setEvents((list) => [{ ...event, id: nextId.current++ }, ...list].slice(0, 12))
  }, [])

  const handleScan = useCallback(
    (raw: string) => {
      const value = raw.trim()
      if (!value) return
      setTerm('')
      const matches = index.get(value.toLowerCase()) ?? []

      if (matches.length === 0) {
        setMessage({ kind: 'error', text: `No line on this count sheet matches “${value}”.` })
        record({ term: value, outcome: 'not_found', lineKey: null, label: 'No match' })
        return
      }
      if (matches.length > 1) {
        setMessage({
          kind: 'warning',
          text: `“${value}” matches ${matches.length} lines. Pick the warehouse in the sheet and count it there.`,
        })
        record({ term: value, outcome: 'ambiguous', lineKey: null, label: `${matches.length} lines` })
        return
      }

      const row = matches[0]
      setCurrent(row.line.key)
      onHighlight(row.line.key)

      if (addOnePerScan) {
        const next = (toNumber(row.line.physical_qty) ?? 0) + 1
        onPatchLine(row.line.key, { physical_qty: String(next) })
        setMessage({ kind: 'success', text: `${row.line.item_name} — counted ${formatQty(next)}.` })
      } else {
        setMessage({ kind: 'success', text: `${row.line.item_name} selected. Enter the counted quantity.` })
      }
      record({
        term: value,
        outcome: 'counted',
        lineKey: row.line.key,
        label: row.line.item_sku ?? row.line.item_name,
      })
    },
    [index, addOnePerScan, onPatchLine, onHighlight, record],
  )

  // Keep the cursor in the scan field: a wedge scanner types wherever focus is,
  // and a stray keystroke landing in the sheet is a wrong count.
  useEffect(() => {
    if (open && !cameraOn) inputRef.current?.focus()
  }, [open, cameraOn, events.length])

  // --- camera path, started only by the button below ---
  useEffect(() => {
    if (!cameraOn) return undefined
    const Detector = barcodeDetectorCtor()
    if (!Detector) {
      setCameraError('This browser cannot decode barcodes from a camera.')
      setCameraOn(false)
      return undefined
    }
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    const detector = new Detector()

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream = media
        if (videoRef.current) {
          videoRef.current.srcObject = media
          void videoRef.current.play()
        }
        timer = setInterval(async () => {
          const video = videoRef.current
          if (!video || video.readyState < 2) return
          try {
            const found = await detector.detect(video)
            if (found.length > 0) handleScan(found[0].rawValue)
          } catch {
            // A frame that cannot be decoded is the normal case, not an error.
          }
        }, 500)
      })
      .catch(() => {
        if (!stopped) {
          setCameraError('Camera access was refused. Scanning with the handheld still works.')
          setCameraOn(false)
        }
      })

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [cameraOn, handleScan])

  // Never leave the camera running behind a closed drawer.
  useEffect(() => {
    if (!open) setCameraOn(false)
  }, [open])

  const cameraSupported = barcodeDetectorCtor() !== null
  const counted = currentRow ? (toNumber(currentRow.line.physical_qty) ?? 0) : 0

  const step = (delta: number) => {
    if (!currentRow) return
    const next = Math.max(0, counted + delta)
    onPatchLine(currentRow.line.key, { physical_qty: String(next) })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Scan items"
      description="Scan with a handheld or type a code and press Enter. Counts update in the sheet as you go."
      width="md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            {events.filter((e) => e.outcome === 'counted').length} scan
            {events.filter((e) => e.outcome === 'counted').length === 1 ? '' : 's'} counted this session
          </span>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          ref={inputRef}
          size="md"
          leadingIcon={ScanBarcode}
          value={term}
          disabled={disabled}
          placeholder="Scan barcode, item code, batch or serial…"
          aria-label="Scan a barcode"
          autoComplete="off"
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleScan(term)
            }
          }}
        />

        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-primary focus:ring-primary/30"
            checked={addOnePerScan}
            onChange={(e) => setAddOnePerScan(e.target.checked)}
          />
          Add one to the count on every scan
        </label>

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {currentRow ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{currentRow.line.item_name}</p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                  {[
                    currentRow.line.item_sku,
                    currentRow.snapshot.warehouseName ?? warehouseName(currentRow.line.warehouse_id),
                    currentRow.line.batch_no ? `Batch ${currentRow.line.batch_no}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Badge tone="neutral" size="xs">
                Book {formatQty(currentRow.line.book_qty)}
              </Badge>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Minus}
                aria-label="Decrease counted quantity"
                disabled={disabled || counted <= 0}
                onClick={() => step(-1)}
              />
              <Input
                className="w-24 text-center"
                inputMode="decimal"
                aria-label="Counted quantity"
                value={currentRow.line.physical_qty}
                disabled={disabled}
                onChange={(e) => onPatchLine(currentRow.line.key, { physical_qty: e.target.value })}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                aria-label="Increase counted quantity"
                disabled={disabled}
                onClick={() => step(1)}
              />
              <span
                className={cx(
                  'ml-auto text-xs font-semibold tabular-nums',
                  currentRow.difference === null
                    ? 'text-gray-400'
                    : currentRow.difference < 0
                      ? 'text-red-600'
                      : currentRow.difference > 0
                        ? 'text-emerald-600'
                        : 'text-gray-500',
                )}
              >
                {currentRow.difference === null
                  ? '—'
                  : `${currentRow.difference > 0 ? '+' : ''}${formatQty(currentRow.difference)}`}
              </span>
            </div>
          </div>
        ) : null}

        {cameraSupported ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon={cameraOn ? CameraOff : Camera}
              onClick={() => {
                setCameraError(null)
                setCameraOn((on) => !on)
              }}
            >
              {cameraOn ? 'Stop camera' : 'Scan with camera'}
            </Button>
            {cameraOn ? (
              <video
                ref={videoRef}
                muted
                playsInline
                className="mt-2 w-full rounded-lg border border-gray-200 bg-black"
                style={{ maxHeight: 200 }}
              />
            ) : null}
            {cameraError ? <p className="mt-1 text-[11px] text-amber-700">{cameraError}</p> : null}
          </div>
        ) : null}

        {events.length > 0 ? (
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Recent scans</h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                  <span className="font-mono text-gray-700">{e.term}</span>
                  <span className="ml-auto truncate text-gray-500">{e.label}</span>
                  <Badge
                    tone={e.outcome === 'counted' ? 'success' : e.outcome === 'ambiguous' ? 'warning' : 'danger'}
                    size="xs"
                  >
                    {e.outcome === 'counted' ? 'Counted' : e.outcome === 'ambiguous' ? 'Ambiguous' : 'Not found'}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

export default ScannerDrawer
