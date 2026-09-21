import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../../components/Modal'
import { Notice } from '../../../components/Notice'

/**
 * The browser's own barcode reader.
 *
 * `BarcodeDetector` is shipped by Chromium (which is what the cPanel-hosted app
 * is used in) and absent from Firefox and Safari. Rather than install a
 * megabyte of WASM decoder for a button most users reach past, the Scan button
 * is only offered where the platform can honour it — `barcodeScanSupported()`
 * gates it — and a hardware scanner, which types into the search box and
 * presses Enter, keeps working everywhere with no code at all.
 */
interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

export function barcodeScanSupported(): boolean {
  return typeof window !== 'undefined' && detectorCtor() !== null && Boolean(navigator.mediaDevices?.getUserMedia)
}

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  /** Fired once, with the first code read. */
  onDetected: (code: string) => void
}

export function BarcodeScanDialog({ open, onClose, onDetected }: BarcodeScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const Ctor = detectorCtor()
    if (!Ctor) {
      setError('This browser cannot scan barcodes. Type the code into the search box, or use a handheld scanner.')
      return undefined
    }

    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    const detector = new Ctor()
    setError(null)

    const tick = async () => {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) {
        frame = requestAnimationFrame(() => void tick())
        return
      }
      try {
        const found = await detector.detect(video)
        const code = found[0]?.rawValue?.trim()
        if (code) {
          stopped = true
          onDetected(code)
          return
        }
      } catch {
        // A single unreadable frame is not a failure; the next one is along in
        // 16ms. Only getUserMedia failing is worth telling the user about.
      }
      frame = requestAnimationFrame(() => void tick())
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
        frame = requestAnimationFrame(() => void tick())
      })
      .catch(() => {
        setError('The camera could not be opened. Check the browser’s camera permission, or type the code into the search box.')
      })

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, onDetected])

  return (
    <Modal open={open} title="Scan a barcode" onClose={onClose} size="sm">
      <div className="space-y-3">
        {error ? (
          <Notice kind="warning">{error}</Notice>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live camera preview has no caption track */}
              <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
            </div>
            <p className="text-xs text-gray-500">
              Hold the barcode inside the frame. The item opens as soon as it is read.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
