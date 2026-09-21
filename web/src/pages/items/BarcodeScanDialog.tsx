import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { Notice } from '../../components/Notice'
import { Button } from '../../ui/Button'

/**
 * Reading a barcode with the device camera, where the browser can do it.
 *
 * `BarcodeDetector` is the only scanner here: no library was added for this.
 * Chrome and Edge on Android and desktop have it; Safari and Firefox do not.
 * So `barcodeScanSupported()` gates the button that opens this dialog — where
 * the API is missing the button is not rendered at all and the field is an
 * ordinary text input, which is what a USB scanner types into anyway.
 */

interface DetectedBarcode {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

export function barcodeScanSupported(): boolean {
  return detectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export interface BarcodeScanDialogProps {
  open: boolean
  onClose: () => void
  onDetected: (value: string) => void
}

export function BarcodeScanDialog({ open, onClose, onDetected }: BarcodeScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const Ctor = detectorCtor()
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera to scan. Type or paste the barcode instead.')
      return undefined
    }

    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    const detector = new Ctor()

    const tick = async () => {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) {
        frame = requestAnimationFrame(() => void tick())
        return
      }
      try {
        const found = await detector.detect(video)
        const value = found.find((b) => b.rawValue?.trim())?.rawValue.trim()
        if (value) {
          stopped = true
          onDetected(value)
          onClose()
          return
        }
      } catch {
        // A frame that cannot be decoded is the normal case, not an error.
      }
      frame = requestAnimationFrame(() => void tick())
    }

    setError(null)
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
        setError('The camera could not be opened. Check the site permission, or type the barcode instead.')
      })

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, onClose, onDetected])

  return (
    <Modal
      open={open}
      title="Scan barcode"
      description="Hold the barcode inside the frame. The field fills as soon as it is read."
      size="sm"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {error ? (
        <Notice kind="warning">{error}</Notice>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline aria-label="Camera preview" />
        </div>
      )}
    </Modal>
  )
}

export default BarcodeScanDialog
