import { useEffect, useRef, useState } from 'react'
import type { KeyboardEventHandler, PointerEventHandler, WheelEventHandler } from 'react'
import { TreeGrowthEngine } from './plant/generator.ts'
import { clearGrowth, loadGrowth, saveGrowth } from './plant/growthStore.ts'
import {
  boundsOnScreen,
  effectiveBranchWidth,
  leafBudget,
  selectRenderableBranches,
  selectRenderableMicroBranches,
  selectRenderableRegions,
} from './plant/renderer.ts'
import { computeViewTransform } from './plant/view.ts'
import type { BranchSegment, CrownRegion, GrowthCheckpointV1, GrowthScene, GrowthTime, PlantConfig, PlantSkeleton, ViewTransform } from './plant/types.ts'

const VIEW_SIZE = 640
const leafA = new URL('../assets/optimized/IMG_9553.webp', import.meta.url).href
const leafB = new URL('../assets/optimized/IMG_9554.webp', import.meta.url).href
const leafC = new URL('../assets/optimized/IMG_9555.webp', import.meta.url).href
const floraStrip = new URL('../assets/optimized/IMG_9557.webp', import.meta.url).href
const leafAssets = [leafA, leafB, leafC]

type Pointer = { x: number; y: number }
type RestoredConfig = PlantConfig & { time: GrowthTime }

const clampZoom = (scale: number) => Math.min(240, Math.max(0.02, scale))
const totalGrowth = ({ phase, epoch, progress }: GrowthTime) => phase < 3 ? phase + progress : 3 + epoch + progress

function useLazyRef<Value>(create: () => Value) {
  const ref = useRef<Value | null>(null)
  if (ref.current === null) ref.current = create()
  return ref as { current: Value }
}

function pointPath(branch: BranchSegment) {
  return `M ${branch.x1} ${branch.y1} L ${branch.x1 + (branch.x2 - branch.x1) * branch.visibility} ${branch.y1 + (branch.y2 - branch.y1) * branch.visibility}`
}

function branchPaths(plant: PlantSkeleton, branches: BranchSegment[]) {
  const groups = new Map<number, BranchSegment[]>()
  for (const branch of branches) {
    const group = groups.get(branch.branchId)
    if (group) group.push(branch)
    else groups.set(branch.branchId, [branch])
  }
  const ordered = [...groups.values()]
    .map((segments) => segments.sort((left, right) => left.branchProgress - right.branchProgress))
    .sort((left, right) => left[0].depthVisual - right[0].depthVisual)

  return ordered.flatMap((segments) => {
    const visible = segments.filter(({ visibility }) => visibility > 0)
    if (visible.length === 0) return []
    const depthWeight = 0.72 + visible[0].depthVisual * 0.34
    const chunkSize = Math.max(1, Math.ceil(visible.length / 6))
    return [false, true].flatMap((inner) => Array.from({ length: Math.ceil(visible.length / chunkSize) }, (_, index) => {
      const chunk = visible.slice(index * chunkSize, (index + 1) * chunkSize)
      let d = ''
      let previous: BranchSegment | undefined
      for (const branch of chunk) {
        d += (!previous || branch.parentId !== previous.id ? `M ${branch.x1} ${branch.y1}` : '')
          + ` L ${branch.x1 + (branch.x2 - branch.x1) * branch.visibility} ${branch.y1 + (branch.y2 - branch.y1) * branch.visibility}`
        if (branch.visibility < 1) break
        previous = branch
      }
      const width = chunk.reduce((total, branch) => total + effectiveBranchWidth(branch, plant), 0) / chunk.length
      return {
        d,
        width: Math.max(0.07, width * (inner ? 0.55 : 1.45) * depthWeight),
        color: inner
          ? `hsl(${27 + chunk[0].tone * 10} 48% ${32 + chunk[0].depthVisual * 8}%)`
          : `hsl(${19 + chunk[0].tone * 9} 48% ${18 + chunk[0].depthVisual * 6}%)`,
        key: `${chunk[0].branchPersistentId}-${index}-${inner}`,
      }
    }))
  })
}

function microPath(branches: BranchSegment[]) {
  return branches.map(pointPath).join(' ')
}

function regionLeaves(regions: CrownRegion[], density: number, screenScale: number) {
  let leavesLeft = leafBudget
  return regions.flatMap((region) => {
    if (leavesLeft <= 0 || Math.max(region.radiusX, region.radiusY) * screenScale < 5) return []
    const leaves = region.leaves.filter((leaf) => leaf.priority <= density && leaf.opacity > 0).slice(0, leavesLeft)
    leavesLeft -= leaves.length
    return leaves.map((leaf) => {
      const size = leaf.size * leaf.opacity * (0.65 + leaf.depthVisual * 0.35) * (0.55 + region.visibility * 0.45) * 1.7
      const x = region.x + leaf.x
      const y = region.y + leaf.y
      return {
        href: leafAssets[Math.min(leafAssets.length - 1, Math.floor(leaf.priority * leafAssets.length))],
        x: x - size,
        y: y - size,
        size: size * 2,
        cx: x,
        cy: y,
        angle: -leaf.angle * 180 / Math.PI,
        opacity: region.visibility * (0.42 + leaf.vitality * 0.46) * (0.78 + leaf.depthVisual * 0.22),
        key: leaf.id,
      }
    })
  })
}

export function PlantSvg({
  config,
  fitRequest,
  regenerateRequest,
  resetRequest,
  follow,
  onTimeChange,
  onRestore,
}: {
  config: PlantConfig
  fitRequest: number
  regenerateRequest: number
  resetRequest: number
  follow: boolean
  onTimeChange: (time: GrowthTime) => void
  onRestore: (config: RestoredConfig) => void
}) {
  const surfaceRef = useRef<SVGSVGElement>(null)
  const engineRef = useLazyRef(() => new TreeGrowthEngine(config))
  const sceneRef = useLazyRef<GrowthScene>(() => engineRef.current.scene())
  const checkpointRef = useLazyRef<GrowthCheckpointV1>(() => engineRef.current.createCheckpoint())
  const transformRef = useRef<ViewTransform | undefined>(undefined)
  const fitRequestRef = useRef(-1)
  const regenerateRequestRef = useRef(regenerateRequest)
  const resetRequestRef = useRef(resetRequest)
  const pointersRef = useRef(new Map<number, Pointer>())
  const gestureRef = useRef<{ center: Pointer; distance: number } | undefined>(undefined)
  const configRef = useRef(config)
  const morphologyRequestRef = useRef({ branching: config.branching, curvature: config.curvature })
  const storageReadyRef = useRef(false)
  const persistTimerRef = useRef<number | undefined>(undefined)
  const followFrameRef = useRef<number | undefined>(undefined)
  const [scene, setScene] = useState(sceneRef.current)
  const [transform, setTransform] = useState<ViewTransform | undefined>(undefined)
  configRef.current = config

  const publish = (nextScene: GrowthScene) => {
    sceneRef.current = nextScene
    setScene(nextScene)
  }

  const fit = () => {
    const next = computeViewTransform(sceneRef.current.bounds, sceneRef.current.skeleton.root, { width: VIEW_SIZE, height: VIEW_SIZE }, 0.12)
    transformRef.current = next
    setTransform(next)
  }

  const persist = (immediate = false) => {
    if (!storageReadyRef.current) return
    window.clearTimeout(persistTimerRef.current)
    const run = () => {
      const engine = engineRef.current
      const currentScene = sceneRef.current
      const { time } = currentScene.skeleton
      if (time.progress === 0 && (time.phase < 3 || time.epoch % 100 === 0)) checkpointRef.current = engine.createCheckpoint()
      void saveGrowth({
        morphology: {
          seed: engine.morphology.seed,
          branching: configRef.current.branching,
          curvature: configRef.current.curvature,
        },
        appearance: { density: configRef.current.density, vitality: configRef.current.vitality },
        time,
        checkpoint: checkpointRef.current,
      }).catch((error) => console.warn('Could not persist tree growth', error))
    }
    if (immediate) run()
    else persistTimerRef.current = window.setTimeout(run, 200)
  }

  const followActive = () => {
    cancelAnimationFrame(followFrameRef.current ?? 0)
    const active = sceneRef.current.skeleton.activeChunk
    const currentTransform = transformRef.current
    if (!follow || !active || !currentTransform) return
    const centerX = (active.bounds.minX + active.bounds.maxX) / 2
    const centerY = (active.bounds.minY + active.bounds.maxY) / 2
    const scale = currentTransform.scale * sceneRef.current.skeleton.growthScale
    const targetX = VIEW_SIZE / 2 - (centerX - sceneRef.current.skeleton.root.x) * scale
    const targetY = VIEW_SIZE * 0.44 + (centerY - sceneRef.current.skeleton.root.y) * scale
    const animate = () => {
      const current = transformRef.current
      if (!current) return
      const dx = targetX - current.rootX
      const dy = targetY - current.rootY
      const next = { ...current, rootX: current.rootX + dx * 0.16, rootY: current.rootY + dy * 0.16 }
      transformRef.current = next
      setTransform(next)
      if (Math.hypot(dx, dy) > 0.5) followFrameRef.current = requestAnimationFrame(animate)
    }
    followFrameRef.current = requestAnimationFrame(animate)
  }

  useEffect(() => {
    let cancelled = false
    const loadedRegenerateRequest = regenerateRequestRef.current
    const loadedResetRequest = resetRequestRef.current
    void loadGrowth().then((stored) => {
      if (cancelled) return
      if (regenerateRequestRef.current !== loadedRegenerateRequest || resetRequestRef.current !== loadedResetRequest) {
        storageReadyRef.current = true
        persist(true)
        return
      }
      if (!stored) {
        storageReadyRef.current = true
        if (!transformRef.current) fit()
        return
      }
      try {
        const engine = stored.checkpoint
          ? TreeGrowthEngine.restore(stored.checkpoint)
          : new TreeGrowthEngine({ ...stored.morphology, ...stored.appearance, progress: 0 })
        engine.setMorphology(stored.morphology)
        engine.setAppearance(stored.appearance)
        engine.setTotalGrowth(totalGrowth(stored.time))
        engineRef.current = engine
        publish(engine.scene())
        checkpointRef.current = stored.checkpoint ?? engine.createCheckpoint()
        storageReadyRef.current = true
        onRestore({ ...stored.morphology, ...stored.appearance, progress: stored.time.progress, time: stored.time })
        fit()
      } catch (error) {
        console.warn('Could not restore tree growth', error)
        void clearGrowth()
        storageReadyRef.current = true
        fit()
      }
    }).catch((error) => {
      console.warn('Could not load tree growth', error)
      storageReadyRef.current = true
      if (!transformRef.current) fit()
    })
    return () => {
      cancelled = true
      window.clearTimeout(persistTimerRef.current)
      cancelAnimationFrame(followFrameRef.current ?? 0)
    }
  }, [])

  useEffect(() => {
    if (resetRequestRef.current !== resetRequest) {
      resetRequestRef.current = resetRequest
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.scene())
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      checkpointRef.current = engineRef.current.createCheckpoint()
      fit()
      persist(true)
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
    if (regenerateRequestRef.current !== regenerateRequest) {
      regenerateRequestRef.current = regenerateRequest
      const growth = totalGrowth(sceneRef.current.skeleton.time)
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.setTotalGrowth(growth))
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      checkpointRef.current = engineRef.current.createCheckpoint()
      fit()
      persist(true)
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
    const engine = engineRef.current
    if (morphologyRequestRef.current.branching !== config.branching
      || morphologyRequestRef.current.curvature !== config.curvature) {
      checkpointRef.current = engine.createCheckpoint()
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
    }
    engine.setMorphology({ branching: config.branching, curvature: config.curvature })
    engine.setAppearance({ density: config.density, vitality: config.vitality })
    const nextScene = engine.setProgress(config.progress)
    publish(nextScene)
    onTimeChange(nextScene.skeleton.time)
    if (fitRequestRef.current !== fitRequest) {
      fitRequestRef.current = fitRequest
      fit()
    } else followActive()
    persist(nextScene.skeleton.time.progress === 0)
  }, [config.progress, config.branching, config.curvature, config.density, config.vitality, fitRequest, regenerateRequest, resetRequest, follow])

  const surfacePoint = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current!
    const rect = surface.getBoundingClientRect()
    return { x: (clientX - rect.left) * VIEW_SIZE / rect.width, y: (clientY - rect.top) * VIEW_SIZE / rect.height }
  }

  const zoomAt = (point: Pointer, requestedFactor: number) => {
    const current = transformRef.current
    if (!current) return
    const scale = clampZoom(current.scale * requestedFactor)
    const factor = scale / current.scale
    const next = {
      ...current,
      rootX: point.x + (current.rootX - point.x) * factor,
      rootY: point.y + (current.rootY - point.y) * factor,
      scale,
    }
    transformRef.current = next
    setTransform(next)
  }

  const resetGesture = () => {
    const points = [...pointersRef.current.values()]
    if (points.length === 0) gestureRef.current = undefined
    else if (points.length === 1) gestureRef.current = { center: points[0], distance: 0 }
    else gestureRef.current = {
      center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
    }
  }

  const onPointerDown: PointerEventHandler<SVGSVGElement> = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, surfacePoint(event.clientX, event.clientY))
    resetGesture()
  }

  const onPointerMove: PointerEventHandler<SVGSVGElement> = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !transformRef.current || !gestureRef.current) return
    pointersRef.current.set(event.pointerId, surfacePoint(event.clientX, event.clientY))
    const points = [...pointersRef.current.values()]
    const previous = gestureRef.current
    const current = transformRef.current
    if (points.length === 1) {
      const next = { ...current, rootX: current.rootX + points[0].x - previous.center.x, rootY: current.rootY + points[0].y - previous.center.y }
      transformRef.current = next
      setTransform(next)
    } else {
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      zoomAt(previous.center, previous.distance > 0 ? distance / previous.distance : 1)
      const zoomed = transformRef.current!
      const next = { ...zoomed, rootX: zoomed.rootX + center.x - previous.center.x, rootY: zoomed.rootY + center.y - previous.center.y }
      transformRef.current = next
      setTransform(next)
    }
    resetGesture()
  }

  const onPointerEnd: PointerEventHandler<SVGSVGElement> = (event) => {
    pointersRef.current.delete(event.pointerId)
    resetGesture()
  }

  const onWheel: WheelEventHandler<SVGSVGElement> = (event) => {
    event.preventDefault()
    zoomAt(surfacePoint(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.0015))
  }

  const onKeyDown: KeyboardEventHandler<SVGSVGElement> = (event) => {
    const current = transformRef.current
    if (!current) return
    const next = { ...current }
    if (event.key === 'ArrowLeft') next.rootX += 24
    else if (event.key === 'ArrowRight') next.rootX -= 24
    else if (event.key === 'ArrowUp') next.rootY += 24
    else if (event.key === 'ArrowDown') next.rootY -= 24
    else if (event.key === '+' || event.key === '=') zoomAt({ x: VIEW_SIZE / 2, y: VIEW_SIZE / 2 }, 1.15)
    else if (event.key === '-') zoomAt({ x: VIEW_SIZE / 2, y: VIEW_SIZE / 2 }, 1 / 1.15)
    else if (event.key.toLowerCase() === 'f') fit()
    else return
    event.preventDefault()
    if (next.rootX !== current.rootX || next.rootY !== current.rootY) {
      transformRef.current = next
      setTransform(next)
    }
  }

  const width = VIEW_SIZE
  const height = VIEW_SIZE
  const currentTransform = transform
  const plant = scene.skeleton
  const branches = currentTransform ? selectRenderableBranches(plant, currentTransform, width, height) : []
  const visibleChunks = currentTransform
    ? plant.chunks.filter((chunk) => boundsOnScreen(chunk.bounds, plant, currentTransform, width, height))
    : []
  const chunkedCrown = plant.time.phase === 3
  const microSource = chunkedCrown
    ? [...visibleChunks.flatMap((chunk) => chunk.microBranches), ...(plant.activeChunk?.microBranches ?? [])]
    : scene.crown.microBranches
  const regionSource = chunkedCrown
    ? [...visibleChunks.flatMap((chunk) => chunk.regions), ...(plant.activeChunk?.regions ?? [])]
    : scene.crown.regions
  const micro = currentTransform
    ? selectRenderableMicroBranches(microSource, plant, currentTransform, width, height)
    : []
  const regions = currentTransform
    ? selectRenderableRegions(regionSource, plant, currentTransform, width, height)
    : []
  const screenScale = currentTransform ? currentTransform.scale * plant.growthScale : 0
  const paths = branchPaths(plant, branches)
  const leaves = regionLeaves(regions, scene.crown.density, screenScale)
  const undergrowthOpacity = plant.time.phase < 2 ? 0 : 0.12 + Math.min(0.08, plant.time.phase === 3 ? plant.time.progress * 0.08 : 0.04)

  return <svg
    ref={surfaceRef}
    className="plant-surface"
    viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
    role="img"
    aria-labelledby="plant-title plant-description"
    tabIndex={0}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerEnd}
    onPointerCancel={onPointerEnd}
    onWheel={onWheel}
    onKeyDown={onKeyDown}
  >
    <title id="plant-title">Procedurally generated tree</title>
    <desc id="plant-description">Drag to pan, use wheel or pinch to zoom, and press F to fit.</desc>
    <defs>
      <linearGradient id="plant-background" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f7f5ec" />
        <stop offset="0.52" stopColor="#e7efe0" />
        <stop offset="1" stopColor="#c4d1b9" />
      </linearGradient>
      <radialGradient id="plant-light" cx="48%" cy="26%" r="78%">
        <stop offset="0" stopColor="#fffdf4" stopOpacity="0.75" />
        <stop offset="0.68" stopColor="#f0f3e5" stopOpacity="0.12" />
        <stop offset="1" stopColor="#849879" stopOpacity="0.22" />
      </radialGradient>
      <radialGradient id="plant-ground" cx="50%" cy="100%" r="45%">
        <stop offset="0" stopColor="#476732" stopOpacity="0.18" />
        <stop offset="1" stopColor="#476732" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="crown-cloud" cx="50%" cy="45%" r="65%">
        <stop offset="0" stopColor="#6e9e55" stopOpacity="0.2" />
        <stop offset="0.58" stopColor="#5c914c" stopOpacity="0.08" />
        <stop offset="1" stopColor="#3b7030" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="tree-shadow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#34452c" stopOpacity="0.24" />
        <stop offset="1" stopColor="#34452c" stopOpacity="0" />
      </radialGradient>
      <filter id="branch-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.25" dy="0.5" stdDeviation="0.35" floodColor="#2b211b" floodOpacity="0.28" />
      </filter>
    </defs>
    <rect width={width} height={height} fill="url(#plant-background)" />
    <rect width={width} height={height} fill="url(#plant-light)" />
    <rect y={height * 0.82} width={width} height={height * 0.18} fill="url(#plant-ground)" />
    <ellipse cx={width * 0.5} cy={height * 0.84} rx={width * 0.25} ry={height * 0.035} fill="url(#tree-shadow)" />
    <image
      href={floraStrip}
      x="0"
      y={height * 0.7}
      width={width}
      height={height * 0.3}
      preserveAspectRatio="xMidYMax slice"
      opacity={undergrowthOpacity}
      aria-hidden="true"
    />
    {currentTransform && <g transform={`translate(${currentTransform.rootX} ${currentTransform.rootY}) scale(${currentTransform.scale * plant.growthScale} ${-currentTransform.scale * plant.growthScale}) translate(${-plant.root.x} ${-plant.root.y})`}>
      <g>
        {regions.filter((region) => Math.max(region.radiusX, region.radiusY) * screenScale < 1.5).map((region) => (
          <ellipse key={`soft-${region.anchorPersistentId}`} cx={region.x} cy={region.y} rx={region.radiusX} ry={region.radiusY} fill="#4d9a39" fillOpacity="0.2" />
        ))}
        {regions.filter((region) => Math.max(region.radiusX, region.radiusY) * screenScale >= 1.5).map((region) => (
          <ellipse key={`cloud-${region.anchorPersistentId}`} cx={region.x} cy={region.y} rx={region.radiusX} ry={region.radiusY} fill="url(#crown-cloud)" opacity={region.visibility * (0.34 + region.depthVisual * 0.2)} />
        ))}
        {leaves.map((leaf) => (
          <image
            key={leaf.key}
            href={leaf.href}
            x={leaf.x}
            y={leaf.y}
            width={leaf.size}
            height={leaf.size}
            preserveAspectRatio="xMidYMid meet"
            transform={`rotate(${leaf.angle} ${leaf.cx} ${leaf.cy})`}
            opacity={leaf.opacity}
            aria-hidden="true"
          />
        ))}
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#branch-shadow)">
        {paths.map((path) => <path key={path.key} d={path.d} stroke={path.color} strokeWidth={path.width} />)}
      </g>
      <g fill="none" strokeLinecap="round">
        {[false, true].map((near) => {
          const layer = micro.filter((branch) => (branch.depthVisual >= 0.5) === near)
          if (layer.length === 0) return null
          const width = layer.reduce((total, branch) => total + branch.width, 0) / layer.length
          return <path
            key={`micro-${near}`}
            d={microPath(layer)}
            stroke={near ? 'rgba(91, 55, 29, 0.78)' : 'rgba(113, 77, 48, 0.45)'}
            strokeWidth={width * (near ? 1.05 : 0.82)}
          />
        })}
      </g>
    </g>}
  </svg>
}
