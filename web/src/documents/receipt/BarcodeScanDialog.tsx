import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, CheckCircle2, Loader2, ScanLine, XCircle } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorMessage, isAbortError } from '../../services/api'
import { lookupApi } from '../../services/lookupApi'
import type { ItemSearchRow } from '../../services/lookupApi'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { cx } from '../../ui/cx'
import { formatQty } from '../../utils/format'

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  /** Availability in the results is scoped to the warehouse the lines post to. */
  warehouseId: number | null
  /** Called for every resolved scan; the form adds or tops up the line. */
  onScanned: (item: ItemSearchRow) => void
}

interface ScanEntry {
  id: number
  code: string
  status: 'found' | 'missing' | 'ambiguous'
  label: string
}

/**
 * Barcode entry for a goods-inward desk.
 *
 * Two kinds of scanner, one workflow:
 *
 *  - a USB / Bluetooth gun, which is a keyboard: it types the code and presses
 *    Enter. The input is focused on open and refocused after every scan, so a
 *    clerk can work a whole pallet without touching the mouse.
 *  - the device camera, where the browser has BarcodeDetector (Chrome and Edge
 *    on Android and desktop). Where it does not, the camera button says so
 *    rather than opening a viewfinder that will never resolve anything.
 *
 * Typing the code by hand always works, and nothing here ever creates an item:
 * an unknown barcode is reported, because inventing an item master row at a
 * receiving desk is how duplicate items get made.
 */
export function BarcodeScanDialog({ open, onClose, warehouseId, onScanned }: BarcodeScanDialogProps) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<ScanEntry[]>([])
  const [choices, setChoices] = useState<ItemSearchRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const nextId = useRef(1)

  const cameraSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    if (!open) {
      setCode('')
      setLog([])
      setChoices([])
      setError(null)
      setCamera(false)
    }
  }, [open])

  const note = (entry: Omit<ScanEntry, 'id'>) => {
    setLog((list) => [{ id: nextId.current++, ...entry }, ...list].slice(0, 8))
  }

  const accept = (item: ItemSearchRow, scanned: string) => {
    onScanned(item)
    note({ code: scanned, status: 'found', label: item.print_name || item.item_name })
    setChoices([])
  }

  const resolve = async (raw: string) => {
    const scanned = raw.trim()
    if (!scanned || busy) return
    setBusy(true)
    setError(null)
    setCode('')
    try {
      const exact = await lookupApi.itemByBarcode(scanned, { warehouseId })
      if (exact) {
        accept(exact, scanned)
        return
      }
      const found = await lookupApi.searchItems(scanned, { warehouseId, limit: 8 })
      if (found.length === 1) accept(found[0], scanned)
      else if (found.length > 1) {
        setChoices(found)
        note({ code: scanned, status: 'ambiguous', label: `${found.length} items match` })
      } else {
        note({ code: scanned, status: 'missing', label: 'No item carries that code' })
      }
    } catch (err) {
      if (!isAbortError(err)) setError(errorMessage(err, 'Could not look that code up.'))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  // Camera scanning. Torn down on close, on unmount and when the user stops it,
  // because a live camera left running is a permission the user did not agree to.
  useEffect(() => {
    if (!open || !camera || !cameraSupported) return undefined
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    const DetectorCtor = (window as unknown as { BarcodeDetector: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
    const detector = new DetectorCtor({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] })

    const tick = async () => {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) return
      try {
        const codes = await detector.detect(video)
        const first = codes[0]?.rawValue?.trim()
        if (first) {
          stopped = true
          await resolve(first)
          stopped = false
        }
      } catch {
        /* a frame that cannot be read is not an error worth showing */
      }
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
        timer = window.setInterval(() => void tick(), 400)
      })
      .catch(() => {
        setError('The camera could not be opened. Check the browser permission, or use a scanner.')
        setCamera(false)
      })

    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
    // The detection loop reads refs and props only, so it does not need to be
    // rebuilt when `resolve` is re-created on a render.
  }, [open, camera, cameraSupported, warehouseId])

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Scan with a gun or type the code — every hit is added to the receipt straight away."
      onClose={onClose}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <label htmlFor="mr_scan_input" className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Barcode or SKU
          </label>
          <Input
            id="mr_scan_input"
            ref={inputRef}
            size="md"
            autoFocus
            autoComplete="off"
            leadingIcon={ScanLine}
            value={code}
            disabled={busy}
            placeholder="Scan here…"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void resolve(code)
              }
            }}
          />
        </div>
        <Button size="md" onClick={() => void resolve(code)} loading={busy} disabled={!code.trim()}>
          Add
        </Button>
      </div>

      <div className="mt-3">
        {cameraSupported ? (
          <Button variant="secondary" size="sm" icon={camera ? CameraOff : Camera} onClick={() => setCamera((c) => !c)}>
            {camera ? 'Stop camera' : 'Use camera'}
          </Button>
        ) : (
          <p className="text-[11px] text-gray-500 m-0">
            This browser cannot scan with the camera. A USB or Bluetooth scanner works here — it types the code and presses Enter.
          </p>
        )}
        {camera ? (
          <video ref={videoRef} muted playsInline className="mt-2 w-full max-h-56 rounded-xl bg-black object-cover" />
        ) : null}
      </div>

      {error ? <p className="mt-3 text-xs font-medium text-red-600">{error}</p> : null}

      {choices.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-800 m-0 mb-1.5">More than one item matches — pick the right one.</p>
          <ul className="space-y-1 list-none p-0 m-0">
            {choices.map((row) => (
              <li key={row.item_id}>
                <button
                  type="button"
                  onClick={() => accept(row, code || String(row.item_sku ?? row.item_id))}
                  className="w-full text-left rounded-lg bg-white px-2.5 py-1.5 hover:bg-primary-light transition-colors"
                >
                  <span className="block text-sm font-medium text-gray-900 truncate">{row.print_name || row.item_name}</span>
                  <span className="block text-[11px] text-gray-500">
                    {[row.item_sku, row.unit_symbol].filter(Boolean).join(' · ')}
                    {row.stock ? ` · ${formatQty(row.stock.on_hand)} on hand` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {log.length > 0 ? (
        <ul className="mt-3 space-y-1 list-none p-0 m-0 max-h-48 overflow-y-auto">
          {log.map((entry) => (
            <li
              key={entry.id}
              className={cx(
                'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                entry.status === 'found' ? 'bg-emerald-50 text-emerald-800' : entry.status === 'missing' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800',
              )}
            >
              {entry.status === 'found' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
              ) : (
                <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
              )}
              <span className="font-mono shrink-0">{entry.code}</span>
              <span className="truncate">{entry.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? (
        <p className="mt-2 text-[11px] text-gray-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Looking it up…
        </p>
      ) : null}
    </Modal>
  )
}

export default BarcodeScanDialog
