import { useEffect, useRef, useState } from 'react'
import type { KeyboardEventHandler, PointerEventHandler, WheelEventHandler } from 'react'
import { TreeGrowthEngine } from './plant/generator.ts'
import { clearGrowth, loadGrowth, saveGrowth } from './plant/growthStore.ts'
import {
  boundsOnScreen,
  effectiveBranchWidth,
  selectRenderableBranches,
  selectRenderableMicroBranches,
  selectRenderableRegions,
} from './plant/renderer.ts'
import { computeViewTransform, constrainViewTransform } from './plant/view.ts'
import type { BranchSegment, CrownRegion, GrowthCheckpointV1, GrowthScene, GrowthTime, PlantConfig, PlantSkeleton, ViewTransform } from './plant/types.ts'

const VIEW_SIZE = 640
const leafA = new URL('../assets/optimized/IMG_9553.webp', import.meta.url).href
const leafB = new URL('../assets/optimized/IMG_9554.webp', import.meta.url).href
const leafC = new URL('../assets/optimized/IMG_9555.webp', import.meta.url).href
const floraStrip = new URL('../assets/optimized/IMG_9557.webp', import.meta.url).href
const leafAssets = [leafA, leafB, leafC]

const starField = Array.from({ length: 126 }, (_, index) => {
  const arm = index % 3
  const step = Math.floor(index / 3) / 42
  const angle = arm * Math.PI * 2 / 3 + step * 8.4
  const radius = 16 + Math.pow(step, 1.18) * 500
  return {
    x: 330 + Math.cos(angle) * radius,
    y: 118 + Math.sin(angle) * radius * 0.72,
    radius: 0.45 + (index % 7) * 0.11,
    opacity: 0.28 + (index % 5) * 0.1,
    key: index,
  }
})

const starStreaks = Array.from({ length: 30 }, (_, index) => {
  const arm = index % 3
  const step = Math.floor(index / 3) / 10
  const angle = arm * Math.PI * 2 / 3 + step * 7.4
  const radius = 38 + step * 410
  const x = 330 + Math.cos(angle) * radius
  const y = 118 + Math.sin(angle) * radius * 0.72
  const length = 4 + (index % 4) * 2
  return { x, y, length, angle: angle * 180 / Math.PI + 16, opacity: 0.12 + (index % 4) * 0.04, key: index }
})

type Pointer = { x: number; y: number }
type RestoredConfig = PlantConfig & { time: GrowthTime }

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
    // The trunk needs its natural taper at every joint; averaging twelve segments makes a visible step.
    const chunkSize = visible[0].level === 0 ? 1 : Math.max(1, Math.ceil(visible.length / 12))
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
        width: Math.max(0.07, width * (inner ? 0.5 : 1.2) * depthWeight),
        color: inner
          ? `hsl(${28 + chunk[0].tone * 12} 39% ${40 + chunk[0].depthVisual * 9}%)`
          : `hsl(${20 + chunk[0].tone * 10} 36% ${25 + chunk[0].depthVisual * 8}%)`,
        key: `${chunk[0].branchPersistentId}-${index}-${inner}`,
      }
    }))
  })
}

function microPath(branches: BranchSegment[]) {
  return branches.map(pointPath).join(' ')
}

function regionLeaves(regions: CrownRegion[], density: number, screenScale: number) {
  return regions
    .filter((region) => Math.max(region.radiusX, region.radiusY) * screenScale >= 5)
    .flatMap((region) => region.leaves
      .filter((leaf) => leaf.priority <= density && leaf.opacity > 0)
      .map((leaf) => {
      const size = leaf.size * leaf.opacity * (0.65 + leaf.depthVisual * 0.35) * (0.55 + region.visibility * 0.45) * 1.3
      const x = region.x + leaf.x
      const y = region.y + leaf.y
      return {
        href: leafAssets[Math.min(leafAssets.length - 1, Math.floor(leaf.priority * leafAssets.length))],
        x: x - size,
        y: y - size,
        size: size * 2,
        cx: x,
        cy: y,
        angle: leaf.angle * 180 / Math.PI - 90,
        opacity: region.visibility * (0.9 + leaf.vitality * 0.1),
        key: leaf.id,
      }
    }))
}

export function PlantSvg({
  config,
  fitRequest,
  regenerateRequest,
  resetRequest,
  follow,
  serverGrowth,
  onTimeChange,
  onRestore,
}: {
  config: PlantConfig
  fitRequest: number
  regenerateRequest: number
  resetRequest: number
  follow: boolean
  serverGrowth?: number
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
  const serverGrowthRef = useRef<number | undefined>(undefined)
  const [scene, setScene] = useState(sceneRef.current)
  const [transform, setTransform] = useState<ViewTransform | undefined>(undefined)
  const [skyOffset, setSkyOffset] = useState(0)
  configRef.current = config

  const publish = (nextScene: GrowthScene) => {
    sceneRef.current = nextScene
    setScene(nextScene)
  }

  const applyTransform = (next: ViewTransform) => {
    const constrained = constrainViewTransform(
      next,
      { width: VIEW_SIZE, height: VIEW_SIZE },
    )
    transformRef.current = constrained
    setTransform(constrained)
  }

  const fit = () => {
    const next = computeViewTransform(sceneRef.current.bounds, sceneRef.current.skeleton.root, { width: VIEW_SIZE, height: VIEW_SIZE }, 0.12)
    applyTransform(next)
    setSkyOffset(0)
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
    const centerY = (active.bounds.minY + active.bounds.maxY) / 2
    const scale = currentTransform.scale * sceneRef.current.skeleton.growthScale
    const targetY = VIEW_SIZE * 0.44 + (centerY - sceneRef.current.skeleton.root.y) * scale
    const animate = () => {
      const current = transformRef.current
      if (!current) return
      const dy = targetY - current.rootY
      const next = { ...current, rootY: current.rootY + dy * 0.16 }
      applyTransform(next)
      if (Math.abs(targetY - transformRef.current!.rootY) > 0.5) followFrameRef.current = requestAnimationFrame(animate)
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
        if (serverGrowthRef.current !== undefined) {
          engineRef.current = new TreeGrowthEngine(configRef.current)
          publish(engineRef.current.setTotalGrowth(serverGrowthRef.current))
          checkpointRef.current = engineRef.current.createCheckpoint()
          storageReadyRef.current = true
          fit()
          return
        }
        const engine = stored.checkpoint
          ? TreeGrowthEngine.restore(stored.checkpoint)
          : new TreeGrowthEngine({ ...stored.morphology, ...stored.appearance, progress: 0 })
        engine.setMorphology(stored.morphology)
        engine.setAppearance(stored.appearance)
        engine.setTotalGrowth(totalGrowth(stored.time))
        engineRef.current = engine
        publish(engine.scene())
        checkpointRef.current = engine.createCheckpoint()
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
    if (serverGrowth !== undefined && serverGrowthRef.current !== serverGrowth) {
      serverGrowthRef.current = serverGrowth
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.setTotalGrowth(serverGrowth))
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      checkpointRef.current = engineRef.current.createCheckpoint()
      fit()
      persist(true)
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
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
  }, [config.progress, config.branching, config.curvature, config.density, config.vitality, fitRequest, regenerateRequest, resetRequest, follow, serverGrowth])

  const surfacePoint = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current!
    const rect = surface.getBoundingClientRect()
    return { x: (clientX - rect.left) * VIEW_SIZE / rect.width, y: (clientY - rect.top) * VIEW_SIZE / rect.height }
  }

  const moveSky = (distance: number) => setSkyOffset((current) => Math.max(-160, Math.min(960, current + distance)))

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
    if (points.length === 1) {
      moveSky(previous.center.y - points[0].y)
    } else {
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      moveSky(previous.center.y - center.y)
    }
    resetGesture()
  }

  const onPointerEnd: PointerEventHandler<SVGSVGElement> = (event) => {
    pointersRef.current.delete(event.pointerId)
    resetGesture()
  }

  const onWheel: WheelEventHandler<SVGSVGElement> = (event) => {
    event.preventDefault()
    moveSky(-event.deltaY * 0.35)
  }

  const onKeyDown: KeyboardEventHandler<SVGSVGElement> = (event) => {
    if (!transformRef.current) return
    if (event.key === 'ArrowUp') moveSky(24)
    else if (event.key === 'ArrowDown') moveSky(-24)
    else if (event.key.toLowerCase() === 'f') fit()
    else return
    event.preventDefault()
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
  const allChunksVisible = visibleChunks.length === plant.chunks.length
  const microSource = chunkedCrown
    ? [
      ...(allChunksVisible ? scene.crown.microBranches : visibleChunks.flatMap((chunk) => chunk.microBranches)),
      ...(plant.activeChunk?.microBranches ?? []),
    ]
    : scene.crown.microBranches
  const regionSource = chunkedCrown
    ? [
      ...(allChunksVisible ? scene.crown.regions : visibleChunks.flatMap((chunk) => chunk.regions)),
      ...(plant.activeChunk?.regions ?? []),
    ]
    : scene.crown.regions
  const micro = currentTransform
    ? selectRenderableMicroBranches(
      microSource,
      scene.crown.density,
      plant,
      currentTransform,
      width,
      height,
    )
    : []
  const regions = currentTransform
    ? selectRenderableRegions(regionSource, scene.crown.density, plant, currentTransform, width, height)
    : []
  const screenScale = currentTransform ? currentTransform.scale * plant.growthScale : 0
  const paths = branchPaths(plant, branches)
  const leaves = regionLeaves(regions, scene.crown.density, screenScale)
  const undergrowthOpacity = plant.time.phase < 2 ? 0 : 0.12 + Math.min(0.08, plant.time.phase === 3 ? plant.time.progress * 0.08 : 0.04)
  const sceneOffset = skyOffset

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
    <desc id="plant-description">Drag vertically or use the wheel to travel through the sky. Press F to reset the view.</desc>
    <defs>
      <linearGradient id="plant-background" x1="0" y1="0" x2="0.08" y2="1">
        <stop offset="0" stopColor="#060817" />
        <stop offset="0.48" stopColor="#11162e" />
        <stop offset="0.75" stopColor="#202141" />
        <stop offset="1" stopColor="#302b48" />
      </linearGradient>
      <radialGradient id="vortex-halo" cx="52%" cy="18%" r="62%">
        <stop offset="0" stopColor="#adc8ff" stopOpacity="0.22" />
        <stop offset="0.3" stopColor="#536aac" stopOpacity="0.1" />
        <stop offset="1" stopColor="#081021" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="moonlight" cx="50%" cy="16%" r="70%">
        <stop offset="0" stopColor="#b6c7ff" stopOpacity="0.16" />
        <stop offset="0.58" stopColor="#6b6fbe" stopOpacity="0.045" />
        <stop offset="1" stopColor="#080914" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="far-hills" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#252b4d" />
        <stop offset="1" stopColor="#141b34" />
      </linearGradient>
      <linearGradient id="meadow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#293a42" />
        <stop offset="0.55" stopColor="#172b32" />
        <stop offset="1" stopColor="#0d1a25" />
      </linearGradient>
      <radialGradient id="tree-shadow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#02050b" stopOpacity="0.72" />
        <stop offset="1" stopColor="#02050b" stopOpacity="0" />
      </radialGradient>
      <filter id="branch-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.25" dy="0.6" stdDeviation="0.45" floodColor="#02030a" floodOpacity="0.72" />
      </filter>
      <filter id="star-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.2" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <clipPath id="flora-left"><path d="M 0 492 Q 86 452 190 480 L 184 640 L 0 640 Z" /></clipPath>
      <clipPath id="flora-middle"><path d="M 194 504 Q 315 456 434 492 L 438 640 L 190 640 Z" /></clipPath>
      <clipPath id="flora-right"><path d="M 442 482 Q 555 446 640 492 L 640 640 L 438 640 Z" /></clipPath>
    </defs>
    <rect width={width} height={height} fill="url(#plant-background)" />
    <rect width={width} height={height} fill="url(#vortex-halo)" />
    <g filter="url(#star-glow)" aria-hidden="true">
      {starStreaks.map((star) => <rect
        key={`streak-${star.key}`}
        x={star.x}
        y={star.y}
        width={star.length}
        height="0.7"
        rx="0.35"
        fill="#c7dcff"
        opacity={star.opacity}
        transform={`rotate(${star.angle} ${star.x} ${star.y})`}
      />)}
      {starField.map((star) => <circle key={`star-${star.key}`} cx={star.x} cy={star.y} r={star.radius} fill="#e6edff" opacity={star.opacity} />)}
    </g>
    <rect width={width} height={height} fill="url(#moonlight)" />
    <g transform={`translate(0 ${sceneOffset})`}>
    <path d="M 0 445 Q 84 386 177 433 T 360 417 T 640 427 L 640 640 L 0 640 Z" fill="url(#far-hills)" opacity="0.95" />
    <path d="M 0 485 Q 90 445 172 480 T 340 458 T 505 482 T 640 452 L 640 640 L 0 640 Z" fill="url(#meadow)" />
    <path d="M 0 528 Q 90 487 185 518 T 360 500 T 520 522 T 640 495 L 640 640 L 0 640 Z" fill="#102730" opacity="0.94" />
    <g opacity={undergrowthOpacity}>
      <g clipPath="url(#flora-left)"><image href={floraStrip} x="-145" y="444" width="780" height="311" preserveAspectRatio="none" /></g>
      <g clipPath="url(#flora-middle)"><image href={floraStrip} x="-286" y="454" width="870" height="347" preserveAspectRatio="none" /></g>
      <g clipPath="url(#flora-right)"><image href={floraStrip} x="-444" y="438" width="920" height="366" preserveAspectRatio="none" /></g>
    </g>
    <g opacity={Math.min(0.95, undergrowthOpacity * 4)}>
      <path d="M 0 570 Q 104 535 206 564 T 402 552 T 640 562 L 640 640 L 0 640 Z" fill="#0a1b25" />
      <g clipPath="url(#flora-left)"><image href={floraStrip} x="-62" y="494" width="756" height="301" preserveAspectRatio="none" /></g>
      <g clipPath="url(#flora-middle)"><image href={floraStrip} x="-314" y="500" width="880" height="350" preserveAspectRatio="none" /></g>
      <g clipPath="url(#flora-right)"><image href={floraStrip} x="-457" y="486" width="842" height="335" preserveAspectRatio="none" /></g>
    </g>
    {currentTransform && <g transform={`translate(${currentTransform.rootX} ${currentTransform.rootY})`} aria-hidden="true">
      <ellipse cx="0" cy="10" rx="112" ry="17" fill="url(#tree-shadow)" />
      <path d="M -92 25 Q -72 -1 -35 7 Q -6 -9 26 5 Q 65 -2 91 25 Q 76 41 40 39 Q 5 47 -34 40 Q -73 43 -92 25 Z" fill="#3d3240" />
      <path d="M -76 25 Q -47 8 -19 17 Q 8 1 36 15 Q 63 10 78 27 Q 47 35 23 29 Q -13 40 -42 30 Q -64 35 -76 25 Z" fill="#57445a" opacity="0.75" />
      <ellipse cx="-51" cy="29" rx="13" ry="6" fill="#705b61" opacity="0.65" />
      <ellipse cx="48" cy="28" rx="11" ry="5" fill="#766066" opacity="0.58" />
      <path d="M -18 7 l -7 -15 M -10 6 l 1 -17 M 19 7 l 7 -14 M 30 9 l 12 -11" fill="none" stroke="#667d69" strokeWidth="1.4" strokeLinecap="round" />
    </g>}
    {currentTransform && <g transform={`translate(${currentTransform.rootX} ${currentTransform.rootY}) scale(${currentTransform.scale * plant.growthScale} ${-currentTransform.scale * plant.growthScale}) translate(${-plant.root.x} ${-plant.root.y})`}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#branch-shadow)">
        {paths.map((path) => <path key={path.key} d={path.d} stroke={path.color} strokeWidth={path.width} />)}
      </g>
      <g fill="none" strokeLinecap="round">
        {[false, true].flatMap((near) => [false, true].map((tip) => {
          const layer = micro.filter((branch) => (branch.depthVisual >= 0.5) === near && (branch.branchProgress === 1) === tip)
          if (layer.length === 0) return null
          const width = layer.reduce((total, branch) => total + branch.width, 0) / layer.length
          return <path
            key={`micro-${near}-${tip}`}
            d={microPath(layer)}
            stroke={near ? 'rgba(151, 111, 77, 0.86)' : 'rgba(177, 146, 112, 0.5)'}
            strokeWidth={width * (near ? 1.05 : 0.82)}
          />
        }))}
      </g>
      <g>
        {regions.filter((region) => Math.max(region.radiusX, region.radiusY) * screenScale < 1.5).map((region) => (
          <ellipse key={`soft-${region.id}`} cx={region.x} cy={region.y} rx={region.radiusX} ry={region.radiusY} fill="#4d9a39" fillOpacity="0.2" />
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
            transform={`rotate(${leaf.angle} ${leaf.cx} ${leaf.cy}) translate(0 ${leaf.cy * 2}) scale(1 -1)`}
            opacity={leaf.opacity}
            aria-hidden="true"
          />
        ))}
      </g>
    </g>}
    </g>
  </svg>
}
