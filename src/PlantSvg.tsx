import { useEffect, useRef, useState } from 'react'
import type { KeyboardEventHandler, PointerEventHandler, WheelEventHandler } from 'react'
import { TreeGrowthEngine } from './plant/generator.ts'
import {
  boundsOnScreen,
  effectiveBranchWidth,
  selectRenderableBranches,
  selectRenderableMicroBranches,
  selectRenderableRegions,
} from './plant/renderer.ts'
import { computeViewTransform, constrainViewTransform, verticalTravelLimit, zoomViewTransform } from './plant/view.ts'
import type { BranchSegment, CrownRegion, GrowthScene, GrowthTime, PlantConfig, PlantSkeleton, ViewTransform } from './plant/types.ts'

const VIEW_SIZE = 640
const leafA = new URL('../assets/optimized/IMG_9553.webp', import.meta.url).href
const leafB = new URL('../assets/optimized/IMG_9554.webp', import.meta.url).href
const leafC = new URL('../assets/optimized/IMG_9555.webp', import.meta.url).href
const floraStrip = new URL('../assets/optimized/IMG_9557.webp', import.meta.url).href
const cosmicGarden = new URL('../assets/optimized/cosmic-garden-v1.png', import.meta.url).href
const moonlitMoss = new URL('../assets/optimized/moonlit-moss-v2.png', import.meta.url).href
const leafAssets = [leafA, leafB, leafC]

type Pointer = { x: number; y: number }
type GrowthRequest = { total: number; version: number }

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
          ? `hsl(${31 + chunk[0].tone * 10} 34% ${52 + chunk[0].depthVisual * 10}%)`
          : `hsl(${24 + chunk[0].tone * 9} 33% ${31 + chunk[0].depthVisual * 10}%)`,
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
  growthRequest,
  zoomRequest,
  onTimeChange,
}: {
  config: PlantConfig
  fitRequest: number
  regenerateRequest: number
  resetRequest: number
  follow: boolean
  growthRequest: GrowthRequest
  zoomRequest: number
  onTimeChange: (time: GrowthTime) => void
}) {
  const surfaceRef = useRef<SVGSVGElement>(null)
  const engineRef = useLazyRef(() => new TreeGrowthEngine(config))
  const sceneRef = useLazyRef<GrowthScene>(() => engineRef.current.scene())
  const transformRef = useRef<ViewTransform | undefined>(undefined)
  const fitRequestRef = useRef(-1)
  const regenerateRequestRef = useRef(regenerateRequest)
  const resetRequestRef = useRef(resetRequest)
  const pointersRef = useRef(new Map<number, Pointer>())
  const gestureRef = useRef<{ center: Pointer; distance: number } | undefined>(undefined)
  const morphologyRequestRef = useRef({ branching: config.branching, curvature: config.curvature })
  const followFrameRef = useRef<number | undefined>(undefined)
  const growthRequestRef = useRef(-1)
  const zoomRequestRef = useRef(zoomRequest)
  const [scene, setScene] = useState(sceneRef.current)
  const [transform, setTransform] = useState<ViewTransform | undefined>(undefined)
  const [treeOffset, setTreeOffset] = useState(0)
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
    setTreeOffset(0)
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
    if (growthRequestRef.current !== growthRequest.version) {
      growthRequestRef.current = growthRequest.version
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.setTotalGrowth(growthRequest.total))
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      if (!transformRef.current || fitRequestRef.current !== fitRequest) {
        fitRequestRef.current = fitRequest
        fit()
      }
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
    if (resetRequestRef.current !== resetRequest) {
      resetRequestRef.current = resetRequest
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.scene())
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      fit()
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
    if (regenerateRequestRef.current !== regenerateRequest) {
      regenerateRequestRef.current = regenerateRequest
      const growth = totalGrowth(sceneRef.current.skeleton.time)
      engineRef.current = new TreeGrowthEngine(config)
      publish(engineRef.current.setTotalGrowth(growth))
      morphologyRequestRef.current = { branching: config.branching, curvature: config.curvature }
      fit()
      onTimeChange(sceneRef.current.skeleton.time)
      return
    }
    const engine = engineRef.current
    if (morphologyRequestRef.current.branching !== config.branching
      || morphologyRequestRef.current.curvature !== config.curvature) {
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
  }, [config.progress, config.branching, config.curvature, config.density, config.vitality, fitRequest, regenerateRequest, resetRequest, follow, growthRequest])

  useEffect(() => () => cancelAnimationFrame(followFrameRef.current ?? 0), [])

  const surfacePoint = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current!
    const rect = surface.getBoundingClientRect()
    return { x: (clientX - rect.left) * VIEW_SIZE / rect.width, y: (clientY - rect.top) * VIEW_SIZE / rect.height }
  }

  const zoomAt = (requestedFactor: number) => {
    const current = transformRef.current
    if (!current) return
    const scale = clampZoom(current.scale * requestedFactor)
    const next = zoomViewTransform(current, scale)
    transformRef.current = next
    setTransform(next)
    setTreeOffset((offset) => Math.min(offset, verticalTravelLimit(
      sceneRef.current.bounds,
      sceneRef.current.skeleton.root,
      next,
      sceneRef.current.skeleton.growthScale,
      VIEW_SIZE,
      0.12,
    )))
  }

  useEffect(() => {
    const steps = zoomRequest - zoomRequestRef.current
    if (steps === 0) return
    zoomRequestRef.current = zoomRequest
    zoomAt(1.2 ** steps)
  }, [zoomRequest])

  const moveTree = (distance: number) => {
    const currentTransform = transformRef.current
    if (!currentTransform) return
    const limit = verticalTravelLimit(
      sceneRef.current.bounds,
      sceneRef.current.skeleton.root,
      currentTransform,
      sceneRef.current.skeleton.growthScale,
      VIEW_SIZE,
      0.12,
    )
    setTreeOffset((current) => Math.max(0, Math.min(limit, current + distance)))
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
    if (points.length === 1) {
      moveTree(previous.center.y - points[0].y)
    } else {
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      zoomAt(previous.distance > 0 ? distance / previous.distance : 1)
    }
    resetGesture()
  }

  const onPointerEnd: PointerEventHandler<SVGSVGElement> = (event) => {
    pointersRef.current.delete(event.pointerId)
    resetGesture()
  }

  const onWheel: WheelEventHandler<SVGSVGElement> = (event) => {
    event.preventDefault()
    zoomAt(Math.exp(-event.deltaY * 0.0015))
  }

  const onKeyDown: KeyboardEventHandler<SVGSVGElement> = (event) => {
    if (!transformRef.current) return
    if (event.key === 'ArrowUp') moveTree(24)
    else if (event.key === 'ArrowDown') moveTree(-24)
    else if (event.key === '+' || event.key === '=') zoomAt(1.2)
    else if (event.key === '-') zoomAt(1 / 1.2)
    else if (event.key.toLowerCase() === 'f') fit()
    else return
    event.preventDefault()
  }

  const width = VIEW_SIZE
  const height = VIEW_SIZE
  const currentTransform = transform
  const sceneOffset = currentTransform ? Math.min(treeOffset, verticalTravelLimit(
    scene.bounds,
    scene.skeleton.root,
    currentTransform,
    scene.skeleton.growthScale,
    VIEW_SIZE,
    0.12,
  )) : 0
  const treeTransform = currentTransform ? { ...currentTransform, rootY: currentTransform.rootY + sceneOffset } : undefined
  const plant = scene.skeleton
  const branches = treeTransform ? selectRenderableBranches(plant, treeTransform, width, height) : []
  const visibleChunks = treeTransform
    ? plant.chunks.filter((chunk) => boundsOnScreen(chunk.bounds, plant, treeTransform, width, height))
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
  const micro = treeTransform
    ? selectRenderableMicroBranches(
      microSource,
      scene.crown.density,
      plant,
      treeTransform,
      width,
      height,
    )
    : []
  const regions = treeTransform
    ? selectRenderableRegions(regionSource, scene.crown.density, plant, treeTransform, width, height)
    : []
  const screenScale = treeTransform ? treeTransform.scale * plant.growthScale : 0
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
    <desc id="plant-description">Drag vertically to travel through the sky, use the wheel or pinch to zoom, and press F to fit the tree.</desc>
    <defs>
      <linearGradient id="sky-wash" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#071026" stopOpacity="0.08" />
        <stop offset="0.54" stopColor="#08142b" stopOpacity="0.16" />
        <stop offset="1" stopColor="#061224" stopOpacity="0.62" />
      </linearGradient>
      <radialGradient id="moonlight" cx="50%" cy="40%" r="58%">
        <stop offset="0" stopColor="#dce7ff" stopOpacity="0.28" />
        <stop offset="0.32" stopColor="#8ea4dc" stopOpacity="0.1" />
        <stop offset="1" stopColor="#4d5d98" stopOpacity="0" />
      </radialGradient>
      <filter id="branch-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.25" dy="0.6" stdDeviation="0.45" floodColor="#02030a" floodOpacity="0.72" />
      </filter>
      <filter id="moon-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="10" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <clipPath id="moss-ground"><path d="M 0 492 Q 92 452 182 482 T 350 470 T 520 486 T 640 458 L 640 640 L 0 640 Z" /></clipPath>
    </defs>
    <image href={cosmicGarden} x="0" y="0" width={width} height={height} preserveAspectRatio="xMidYMid slice" aria-hidden="true" />
    <rect width={width} height={height} fill="url(#sky-wash)" />
    <ellipse cx="320" cy="250" rx="230" ry="190" fill="url(#moonlight)" filter="url(#moon-glow)" aria-hidden="true" />
    <g clipPath="url(#moss-ground)">
      <image href={moonlitMoss} x="0" y="454" width={width} height="256" preserveAspectRatio="xMidYMid slice" opacity="0.72" aria-hidden="true" />
      <rect x="0" y="454" width={width} height="256" fill="#102d35" opacity="0.24" />
    </g>
    <path d="M 0 492 Q 92 452 182 482 T 350 470 T 520 486 T 640 458" fill="none" stroke="#7d9c9b" strokeOpacity="0.24" strokeWidth="1.5" />
    <g opacity={Math.min(0.92, undergrowthOpacity * 4)}>
      <image href={floraStrip} x="0" y="454" width={width} height="256" preserveAspectRatio="xMidYMid meet" aria-hidden="true" />
    </g>
    {treeTransform && <g transform={`translate(${treeTransform.rootX} ${treeTransform.rootY}) scale(${treeTransform.scale * plant.growthScale} ${-treeTransform.scale * plant.growthScale}) translate(${-plant.root.x} ${-plant.root.y})`}>
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
            stroke={near ? 'rgba(183, 148, 112, 0.9)' : 'rgba(143, 126, 106, 0.62)'}
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
  </svg>
}
