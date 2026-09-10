import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  src: string
  alt: string
  onError?: () => void
}

const MIN = 1
const MAX = 7

type ZoomState = { scale: number; x: number; y: number }

export function NbImageZoom({ src, alt, onError }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    x: number
    y: number
    panX: number
    panY: number
  } | null>(null)
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const reset = useCallback(() => {
    setZoom({ scale: 1, x: 0, y: 0 })
  }, [])

  useEffect(() => {
    reset()
  }, [src, reset])

  const zoomAt = useCallback((nextScale: number, cx: number, cy: number) => {
    const prev = zoomRef.current
    const scale = Math.min(MAX, Math.max(MIN, nextScale))
    if (scale <= MIN) {
      setZoom({ scale: 1, x: 0, y: 0 })
      return
    }
    const ratio = scale / prev.scale
    setZoom({
      scale,
      x: cx - (cx - prev.x) * ratio,
      y: cy - (cy - prev.y) * ratio,
    })
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      zoomAt(
        zoomRef.current.scale * factor,
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const bump = (dir: 1 | -1) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    zoomAt(
      zoomRef.current.scale * (dir > 0 ? 1.25 : 0.8),
      rect.width / 2,
      rect.height / 2,
    )
  }

  return (
    <div className="nb-zoom">
      <div className="nb-zoom-tools">
        <button
          type="button"
          className="btn btn-tiny"
          disabled={zoom.scale <= MIN}
          onClick={() => bump(-1)}
          aria-label="Alejar"
        >
          −
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={zoom.scale >= MAX}
          onClick={() => bump(1)}
          aria-label="Acercar"
        >
          +
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={zoom.scale <= MIN}
          onClick={reset}
        >
          Ajustar
        </button>
        <span className="muted nb-zoom-pct">{Math.round(zoom.scale * 100)}%</span>
      </div>
      <div
        ref={stageRef}
        className={`nb-zoom-stage${zoom.scale > 1 ? ' is-zoomed' : ''}`}
        onDoubleClick={(e) => {
          const stage = stageRef.current
          if (!stage) return
          const rect = stage.getBoundingClientRect()
          if (zoom.scale > 1) {
            reset()
            return
          }
          zoomAt(2.4, e.clientX - rect.left, e.clientY - rect.top)
        }}
        onPointerDown={(e) => {
          if (zoom.scale <= 1 || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            panX: zoom.x,
            panY: zoom.y,
          }
        }}
        onPointerMove={(e) => {
          const start = drag.current
          if (!start) return
          setZoom((z) => ({
            ...z,
            x: start.panX + (e.clientX - start.x),
            y: start.panY + (e.clientY - start.y),
          }))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onError={onError}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          }}
        />
      </div>
      <p className="muted nb-zoom-hint">
        Rueda: zoom · arrastrar: mover · doble clic: 240% / ajustar
      </p>
    </div>
  )
}
