import { useEffect, useRef } from 'react'
import type { KeyboardEventHandler, PointerEventHandler, WheelEventHandler } from 'react'
import { generateCrown, generateSkeleton } from './plant/generator.ts'
import { renderPlant } from './plant/renderer.ts'
import { computeBounds, computeViewTransform } from './plant/view.ts'
import type { Bounds, PlantConfig, PlantCrown, PlantSkeleton, ViewTransform } from './plant/types.ts'

type Scene = { skeleton: PlantSkeleton; crown: PlantCrown; bounds: Bounds }
type Pointer = { x: number; y: number }

const clampZoom = (scale: number) => Math.min(240, Math.max(0.02, scale))

export function PlantCanvas({ config, fitRequest }: { config: PlantConfig; fitRequest: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene | undefined>(undefined)
  const transformRef = useRef<ViewTransform | undefined>(undefined)
  const structuralKeyRef = useRef('')
  const fitRequestRef = useRef(-1)
  const pointersRef = useRef(new Map<number, Pointer>())
  const gestureRef = useRef<{ center: Pointer; distance: number } | undefined>(undefined)

  const draw = () => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx && sceneRef.current && transformRef.current) {
      renderPlant(ctx, sceneRef.current.skeleton, sceneRef.current.crown, transformRef.current)
    }
  }

  const fit = () => {
    const canvas = canvasRef.current
    const scene = sceneRef.current
    if (!canvas || !scene) return
    transformRef.current = computeViewTransform(scene.bounds, scene.skeleton.root, canvas, 0.12)
    draw()
  }

  const canvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * canvas.width / rect.width,
      y: (clientY - rect.top) * canvas.height / rect.height,
    }
  }

  const zoomAt = (point: Pointer, requestedFactor: number) => {
    const transform = transformRef.current
    if (!transform) return
    const scale = clampZoom(transform.scale * requestedFactor)
    const factor = scale / transform.scale
    transform.rootX = point.x + (transform.rootX - point.x) * factor
    transform.rootY = point.y + (transform.rootY - point.y) * factor
    transform.scale = scale
  }

  useEffect(() => {
    const skeleton = generateSkeleton(config)
    const crown = generateCrown(skeleton, config)
    const bounds = computeBounds([...skeleton.branches, ...crown.microBranches], crown.regions)
    sceneRef.current = { skeleton, crown, bounds }

    const structuralKey = `${config.seed}:${config.branching}:${config.curvature}`
    if (!transformRef.current || structuralKeyRef.current !== structuralKey || fitRequestRef.current !== fitRequest) {
      structuralKeyRef.current = structuralKey
      fitRequestRef.current = fitRequest
      fit()
    } else {
      draw()
    }
  }, [config, fitRequest])

  const resetGesture = () => {
    const points = [...pointersRef.current.values()]
    if (points.length === 0) gestureRef.current = undefined
    else if (points.length === 1) gestureRef.current = { center: points[0], distance: 0 }
    else {
      gestureRef.current = {
        center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      }
    }
  }

  const onPointerDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, canvasPoint(event.clientX, event.clientY))
    resetGesture()
  }

  const onPointerMove: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !transformRef.current || !gestureRef.current) return
    pointersRef.current.set(event.pointerId, canvasPoint(event.clientX, event.clientY))
    const points = [...pointersRef.current.values()]
    const previous = gestureRef.current

    if (points.length === 1) {
      transformRef.current.rootX += points[0].x - previous.center.x
      transformRef.current.rootY += points[0].y - previous.center.y
    } else {
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const oldRoot = { x: transformRef.current.rootX, y: transformRef.current.rootY }
      const oldScale = transformRef.current.scale
      zoomAt(previous.center, previous.distance > 0 ? distance / previous.distance : 1)
      const factor = transformRef.current.scale / oldScale
      transformRef.current.rootX = center.x + (oldRoot.x - previous.center.x) * factor
      transformRef.current.rootY = center.y + (oldRoot.y - previous.center.y) * factor
    }
    resetGesture()
    draw()
  }

  const onPointerEnd: PointerEventHandler<HTMLCanvasElement> = (event) => {
    pointersRef.current.delete(event.pointerId)
    resetGesture()
  }

  const onWheel: WheelEventHandler<HTMLCanvasElement> = (event) => {
    event.preventDefault()
    zoomAt(canvasPoint(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.0015))
    draw()
  }

  const onKeyDown: KeyboardEventHandler<HTMLCanvasElement> = (event) => {
    const transform = transformRef.current
    if (!transform) return
    const pan = 24
    if (event.key === 'ArrowLeft') transform.rootX += pan
    else if (event.key === 'ArrowRight') transform.rootX -= pan
    else if (event.key === 'ArrowUp') transform.rootY += pan
    else if (event.key === 'ArrowDown') transform.rootY -= pan
    else if (event.key === '+' || event.key === '=') zoomAt({ x: 320, y: 320 }, 1.15)
    else if (event.key === '-') zoomAt({ x: 320, y: 320 }, 1 / 1.15)
    else if (event.key.toLowerCase() === 'f') fit()
    else return
    event.preventDefault()
    draw()
  }

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={640}
      tabIndex={0}
      aria-label="Procedurally generated plant. Drag to pan, use wheel or pinch to zoom, and press F to fit."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    />
  )
}
