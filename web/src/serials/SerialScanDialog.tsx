import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react'
import { Modal } from '../components/Modal'
import { Notice } from '../components/Notice'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Field } from './Field'

/**
 * Scan a code, by whatever means this device actually has.
 *
 * Three input paths, in the order they are likely to exist:
 *
 *  1. **A hardware scanner.** It behaves as a keyboard, so the field below is
 *     already the whole of it: the gun types the code and sends Enter. This is
 *     what a warehouse desktop has, and it needs no permission and no camera.
 *  2. **The camera**, where the browser has `BarcodeDetector`. Chrome and Edge
 *     on Android and desktop do; Safari and Firefox do not, and a button that
 *     opened a dead viewfinder would be worse than one that is not offered.
 *  3. **Typing it.** Always available, always the fallback, never hidden behind
 *     a permission prompt.
 *
 * The camera is deliberately NOT required for the workspace to be usable —
 * every path ends in the same `onDetected`.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

type DetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): DetectorCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

export interface SerialScanDialogProps {
  open: boolean
  onClose: () => void
  /** A code was read or typed. The page decides what to do with it. */
  onDetected: (value: string) => void
  title?: string
  description?: string
}

export function SerialScanDialog({
  open,
  onClose,
  onDetected,
  title = 'Scan a barcode',
  description = 'Point the camera at a code, use a handheld scanner, or type the number.',
}: SerialScanDialogProps) {
  const [manual, setManual] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [detected, setDetected] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const supportsCamera = detectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  useEffect(() => {
    if (!open) {
      setManual('')
      setDetected(null)
      setCameraError(null)
      stopCamera()
      return undefined
    }
    // The typed field takes focus, which is also where a handheld scanner's
    // keystrokes will land.
    const id = window.setTimeout(() => manualRef.current?.focus(), 60)
    return () => window.clearTimeout(id)
  }, [open, stopCamera])

  useEffect(() => () => stopCamera(), [stopCamera])

  const startCamera = async () => {
    const Ctor = detectorCtor()
    if (!Ctor) return
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setCameraOn(true)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }
      const detector = new Ctor()
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          const value = codes[0]?.rawValue?.trim()
          if (value) {
            setDetected(value)
            setManual(value)
            stopCamera()
            return
          }
        } catch {
          // A frame that cannot be decoded is the normal case between codes,
          // not an error worth showing.
        }
        window.setTimeout(() => void tick(), 220)
      }
      void tick()
    } catch (err) {
      // Permission refused, no camera, or another tab holding it. Said plainly,
      // with the typed field still right there.
      setCameraError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'The browser refused access to the camera. Type or scan the number instead.'
          : 'The camera could not be opened on this device. Type or scan the number instead.',
      )
      stopCamera()
    }
  }

  const accept = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    stopCamera()
    onDetected(trimmed)
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" icon={ScanLine} onClick={() => accept(manual)} disabled={manual.trim() === ''}>
            Use this code
          </Button>
        </>
      }
    >
      {cameraError ? (
        <div className="mb-3">
          <Notice kind="warning">{cameraError}</Notice>
        </div>
      ) : null}

      {detected ? (
        <div className="mb-3">
          <Notice kind="success" title="Code read">
            <span className="font-mono">{detected}</span>
          </Notice>
        </div>
      ) : null}

      {supportsCamera ? (
        <div className="mb-3">
          {cameraOn ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live viewfinder has no captions */}
              <video
                ref={videoRef}
                className="aspect-video w-full rounded-lg bg-black object-cover"
                muted
                playsInline
                aria-label="Camera viewfinder"
              />
              <Button variant="secondary" size="sm" icon={CameraOff} onClick={stopCamera} className="mt-2">
                Stop the camera
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" icon={Camera} onClick={() => void startCamera()}>
              Use the camera
            </Button>
          )}
        </div>
      ) : (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-gray-500">
          <Keyboard className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This browser cannot decode barcodes from the camera. A handheld scanner still works — it types into the box
          below and presses Enter.
        </p>
      )}

      <Field label="Serial or barcode" hint="A handheld scanner ends with Enter, which is the same as pressing the button.">
        <Input
          ref={manualRef}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              accept(e.currentTarget.value)
            }
          }}
          placeholder="SN-AP-MBP-00125"
          className="font-mono"
        />
      </Field>
    </Modal>
  )
}

export default SerialScanDialog
