import type {
  Bounds,
  BranchLevel,
  BranchSegment,
  FoliageAnchor,
  GrowthCheckpointV1,
  GrowthScene,
  LegacyPlantConfig,
  PersistentId,
  PlantAppearance,
  PlantChunk,
  PlantConfig,
  PlantCrown,
  PlantMorphology,
  PlantPhase,
  PlantSkeleton,
} from './types.ts'

const TRUNK_SEGMENTS = 24
const ATTRACTION_POINTS = 240
const GROWTH_ROUNDS = 32
const MICRO_TWIGS = 3
const REGION_PARTICLES = 24
const AMBIENT_PARTICLES = 18
const MATURE_GROWTH_FLOOR = 0.18
const MATURE_GROWTH_DECAY = 0.035
const MAX_MATURE_FRONTIER = 64
const MAX_CROWN_REGIONS = 512

const PHASE_SCHEDULE = [
  [-0.06, 0.94, 0.08],
  [1, 0.78, 0.22],
  [2, 0.58, 0.22],
  [2.18, 0.62, 0.22],
  [3, 0.45, 0.22],
] as const
const WIDTH_MIN = [0.65, 0.25, 0.12, 0.07, 0.05] as const
const WIDTH_MAX = [1.8, 0.8, 0.4, 0.22, 0.12] as const
const WIDTH_GROWTH = [0.7, 0.5, 0.3, 0.18, 0.08] as const
const SEGMENT_LENGTH = [1.2, 1.25, 0.72, 0.48, 0.3] as const
const INERTIA = [0, 0.72, 0.64, 0.56] as const
const ATTRACTION = [0, 0.75, 0.9, 1] as const
const UPWARD = [0, 0.2, 0.15, 0.1] as const
const SAG = [0, 0.28, 0.18, 0.08] as const
const BEND_IMPULSE = [0.012, 0.05, 0.07, 0.095] as const
const STEERING_LIMIT = [0, 0.12, 0.18, 0.24] as const
const TURN_LIMIT = [0, 0.16, 0.24, 0.32] as const

const clamp = (value: number, min = 0, max = 1) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
const smoothstep = (value: number) => value * value * (3 - 2 * value)
const levelOf = (depth: number) => Math.min(depth, 4) as BranchLevel
const radians = (degrees: number) => degrees * Math.PI / 180
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

function random(seed: number) {
  let state = Math.trunc(seed) >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function hashKey(seed: number, key: string) {
  let hash = seed >>> 0
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const priorityOf = (seed: number, key: string) => random(hashKey(seed, key))()

function normalized(x: number, y: number, fallbackX = 0, fallbackY = 1) {
  const length = Math.hypot(x, y)
  return length > Number.EPSILON ? { x: x / length, y: y / length } : { x: fallbackX, y: fallbackY }
}

type CrownShape = {
  height: number
  bottom: number
  top: number
  drift: number
  wave: number
}

type Attractor = { x: number; y: number; alive: boolean }

type RawSegment = Omit<BranchSegment,
  'visibility' | 'width' | 'persistentId' | 'parentPersistentId' | 'branchPersistentId' | 'priority' | 'growthDuration'> & {
  rank: number
  densityThreshold: number
  birthProgress: number
}

type Bud = {
  x: number
  y: number
  dx: number
  dy: number
  originX: number
  originY: number
  parentId: number
  branchId: number
  depth: number
  level: BranchLevel
  step: number
  maxSteps: number
  bornRound: number
  baseDirection: number
  bendVelocity: number
  initialBendDirection: -1 | 1
  depthVisual: number
  tone: number
  densityThreshold: number
  spawnSteps: number[]
  nextSpawn: number
  outward: -1 | 0 | 1
}


function crownShape(seed: number, height: number): CrownShape {
  const next = random(seed ^ 0x243f6a88)
  return {
    height,
    bottom: height * 0.28,
    top: height * 1.04,
    drift: (next() - 0.5) * height * 0.1,
    wave: (next() - 0.5) * height * 0.08,
  }
}

function crownAt(shape: CrownShape, y: number) {
  const progress = clamp((y - shape.bottom) / (shape.top - shape.bottom))
  const center = shape.drift * progress + shape.wave * Math.sin(progress * Math.PI)
  const width = shape.height * (
    0.035 + 0.4 * Math.sin(progress * Math.PI) ** 0.68 * (0.78 + progress * 0.34)
  )
  return { center, width }
}

function makeAttractors(seed: number, shape: CrownShape) {
  const next = random(seed ^ 0xb7e15162)
  const points: Attractor[] = []
  const maxWidth = shape.height * 0.46

  // ponytail: naive rejection sampling is bounded at 240 points; use a spatial index only if generation becomes per-frame.
  while (points.length < ATTRACTION_POINTS) {
    const y = shape.bottom + next() * (shape.top - shape.bottom)
    const { center, width } = crownAt(shape, y)
    const x = center + (next() * 2 - 1) * maxWidth
    if (Math.abs(x - center) <= width) points.push({ x, y, alive: true })
  }
  return points
}

function childCount(seed: number, branchId: number, depth: number, branching: number) {
  const next = random(seed ^ 0x9e3779b9 ^ Math.imul(branchId + 1, 0x85ebca6b))
  if (depth === 1) return 1 + Math.floor(next() * (1.05 + branching * 2))
  if (depth === 2 && next() < 0.35 + branching * 0.55) return 1 + (next() < branching * 0.55 ? 1 : 0)
  return 0
}

function spawnSteps(seed: number, branchId: number, maxSteps: number, count: number) {
  const next = random(seed ^ 0x3c6ef372 ^ Math.imul(branchId + 1, 0x27d4eb2d))
  const steps: number[] = []
  for (let index = 0; index < count; index += 1) {
    const progress = 0.3 + (index + 1) / (count + 1) * 0.55 + (next() - 0.5) * 0.07
    const step = Math.max(2, Math.min(maxSteps - 2, Math.round(progress * maxSteps)))
    steps.push(steps.includes(step) ? Math.min(maxSteps - 2, step + 1) : step)
  }
  return steps.sort((left, right) => left - right)
}

function makeBud(
  seed: number,
  branching: number,
  branchId: number,
  depth: number,
  parentId: number,
  x: number,
  y: number,
  angle: number,
  maxSteps: number,
  bornRound: number,
  densityThreshold: number,
  outward: -1 | 0 | 1 = 0,
): Bud {
  const next = random(seed ^ 0xa54ff53a ^ Math.imul(branchId + 1, 0x7feb352d))
  const children = childCount(seed, branchId, depth, branching)
  return {
    x,
    y,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    originX: x,
    originY: y,
    parentId,
    branchId,
    depth,
    level: levelOf(depth),
    step: 0,
    maxSteps,
    bornRound,
    baseDirection: angle,
    bendVelocity: 0,
    initialBendDirection: next() < 0.5 ? -1 : 1,
    depthVisual: next(),
    tone: next(),
    densityThreshold,
    spawnSteps: spawnSteps(seed, branchId, maxSteps, children),
    nextSpawn: 0,
    outward,
  }
}

function normalizeConfig(input: LegacyPlantConfig): LegacyPlantConfig {
  return {
    ...input,
    phase: Math.trunc(clamp(input.phase, 0, 3)) as PlantPhase,
    phaseProgress: clamp(input.phaseProgress),
    branching: clamp(input.branching),
    density: clamp(input.density),
    curvature: clamp(input.curvature),
    vitality: clamp(input.vitality),
  }
}

function growBlueprint(config: LegacyPlantConfig) {
  const raw: RawSegment[] = []
  const trunkNext = random(config.seed ^ 0x6a09e667)
  const lean = (trunkNext() - 0.5) * radians(10)
  const trunkDirection = Math.PI / 2 + lean
  const trunkDepthVisual = trunkNext()
  const trunkTone = trunkNext()
  let trunkAngle = trunkDirection
  let bendVelocity = 0
  let x = 0
  let y = 0
  let parentId: number | null = null
  const trunkIds: number[] = []

  for (let step = 0; step < TRUNK_SEGMENTS; step += 1) {
    bendVelocity = bendVelocity * 0.82 + (trunkNext() * 2 - 1) * config.curvature * BEND_IMPULSE[0]
    trunkAngle += bendVelocity + angleDelta(trunkAngle, trunkDirection) * 0.08
    trunkAngle = Math.PI / 2 + clamp(angleDelta(Math.PI / 2, trunkAngle), -radians(10), radians(10))
    const length = SEGMENT_LENGTH[0] * (0.96 + trunkNext() * 0.08)
    const nextX = x + Math.cos(trunkAngle) * length
    const nextY = y + Math.sin(trunkAngle) * length
    const id = raw.length
    trunkIds.push(id)
    raw.push({
      id,
      parentId,
      branchId: 0,
      branchProgress: (step + 1) / TRUNK_SEGMENTS,
      x1: x,
      y1: y,
      x2: nextX,
      y2: nextY,
      rank: (step + 1) / TRUNK_SEGMENTS,
      densityThreshold: 0,
      depth: 0,
      level: 0,
      baseDirection: trunkDirection,
      bendStrength: Math.abs(angleDelta(trunkDirection, trunkAngle)),
      bendDirection: angleDelta(trunkDirection, trunkAngle) < 0 ? -1 : 1,
      depthVisual: trunkDepthVisual,
      tone: trunkTone,
      birthEpoch: -1,
      birthProgress: 0,
    })
    x = nextX
    y = nextY
    parentId = id
  }

  const height = y
  const shape = crownShape(config.seed, height)
  const attractors = makeAttractors(config.seed, shape)
  const primaryNext = random(config.seed ^ 0xbb67ae85)
  const primaryCount = 3 + Math.round(config.branching * 4)
  const originSet = new Set<number>()
  while (originSet.size < primaryCount) originSet.add(7 + Math.floor(primaryNext() * 15))
  const origins = [...originSet].sort((left, right) => left - right)

  const sides: Array<-1 | 1> = []
  let sideBalance = 0
  for (let index = 0; index < primaryCount; index += 1) {
    const side: -1 | 1 = sideBalance >= 2 ? -1 : sideBalance <= -2 ? 1 : primaryNext() < 0.5 ? -1 : 1
    sides.push(side)
    sideBalance += side
  }
  if (sides.every((value) => value === sides[0])) sides[sides.length - 1] = sides[0] === 1 ? -1 : 1

  let nextBranchId = 1
  let buds = origins.map((origin, index) => {
    const trunk = raw[trunkIds[origin]]
    const originProgress = (origin + 1) / TRUNK_SEGMENTS
    const branchAngle = radians(24 + originProgress * 12 + (primaryNext() - 0.5) * 18)
    const angle = sides[index] === 1 ? branchAngle : Math.PI - branchAngle
    const localWidth = crownAt(shape, trunk.y2).width / (height * 0.46)
    const maxSteps = Math.min(16, 10 + Math.round(localWidth * 4) + Math.floor(primaryNext() * 2))
    return makeBud(
      config.seed,
      config.branching,
      nextBranchId++,
      1,
      trunk.id,
      trunk.x2,
      trunk.y2,
      angle,
      maxSteps,
      0,
      0,
      sides[index],
    )
  })

  const influenceRadius2 = (height * 0.28) ** 2
  const killRadius2 = (height * 0.035) ** 2

  // ponytail: this O(points * buds * rounds) loop is intentionally simple and bounded; index points only if counts grow.
  for (let round = 0; round < GROWTH_ROUNDS && buds.length > 0; round += 1) {
    const assignments = buds.map(() => ({ x: 0, y: 0, count: 0 }))
    for (const point of attractors) {
      if (!point.alive) continue
      let bestIndex = -1
      let bestDistance = influenceRadius2
      for (const [index, bud] of buds.entries()) {
        const distance = (point.x - bud.x) ** 2 + (point.y - bud.y) ** 2
        if (distance < bestDistance) {
          bestIndex = index
          bestDistance = distance
        }
      }
      if (bestIndex >= 0) {
        assignments[bestIndex].x += point.x
        assignments[bestIndex].y += point.y
        assignments[bestIndex].count += 1
      }
    }

    const spawned: Bud[] = []
    const endpoints: Array<{ x: number; y: number }> = []
    for (const [index, bud] of buds.entries()) {
      const level = bud.depth as 1 | 2 | 3
      const assigned = assignments[index]
      const target = assigned.count > 0
        ? normalized(assigned.x / assigned.count - bud.x, assigned.y / assigned.count - bud.y, bud.dx, bud.dy)
        : normalized(crownAt(shape, bud.y).center - bud.x, shape.top - bud.y, bud.dx, bud.dy)
      const progress = (bud.step + 1) / bud.maxSteps
      const reach = Math.abs(bud.x - bud.originX) / height
      const sag = SAG[level] * progress ** 2 * reach * (0.35 + config.curvature * 0.65)
      const bendNext = random(config.seed ^ 0x510e527f ^ Math.imul(bud.branchId + 1, 0x9e3779b1) ^ bud.step)
      const impulse = config.curvature * BEND_IMPULSE[level] * (
        bud.initialBendDirection * 0.42 + (bendNext() * 2 - 1) * 0.32
      )
      bud.bendVelocity = bud.bendVelocity * 0.78 + impulse

      const boundary = crownAt(shape, bud.y)
      const outside = Math.max(0, Math.abs(bud.x - boundary.center) - boundary.width)
      const correction = outside > 0
        ? normalized(boundary.center - bud.x, shape.top - bud.y)
        : { x: 0, y: 0 }
      const desired = normalized(
        bud.dx * INERTIA[level] + target.x * ATTRACTION[level] + correction.x * 1.2,
        bud.dy * INERTIA[level] + target.y * ATTRACTION[level] + UPWARD[level] - sag + correction.y * 1.2,
        bud.dx,
        bud.dy,
      )
      const currentAngle = Math.atan2(bud.dy, bud.dx)
      const steering = clamp(
        angleDelta(currentAngle, Math.atan2(desired.y, desired.x)),
        -STEERING_LIMIT[level],
        STEERING_LIMIT[level],
      )
      const turn = clamp(steering + bud.bendVelocity, -TURN_LIMIT[level], TURN_LIMIT[level])
      const directionAngle = currentAngle + turn
      let direction = { x: Math.cos(directionAngle), y: Math.sin(directionAngle) }

      const minimumOutward = level === 1
        ? 0.18 * (1 - progress)
        : level === 2 && progress < 0.45 ? 0.08 * (1 - progress / 0.45) : 0
      if (bud.outward !== 0 && direction.x * bud.outward < minimumOutward) {
        direction = normalized(bud.outward * minimumOutward, Math.max(direction.y, 0.2))
      }
      const rise = level === 1 ? 0.06 : level === 2 ? 0.02 : 0
      const axisFloor = bud.originY + progress * bud.maxSteps * SEGMENT_LENGTH[level] * rise
      const floorDirection = rise > 0 ? (axisFloor - bud.y) / SEGMENT_LENGTH[level] : -1
      const minimumY = Math.max(
        level === 1 ? (progress < 0.68 ? 0.18 : -0.12) : level === 2 ? -0.25 : -0.45,
        floorDirection,
      )
      if (direction.y < minimumY) direction = normalized(direction.x, minimumY)

      const length = SEGMENT_LENGTH[bud.level] * (0.92 + bendNext() * 0.16)
      const nextX = bud.x + direction.x * length
      const nextY = bud.y + direction.y * length
      const id = raw.length
      const segmentAngle = Math.atan2(direction.y, direction.x)
      raw.push({
        id,
        parentId: bud.parentId,
        branchId: bud.branchId,
        branchProgress: progress,
        x1: bud.x,
        y1: bud.y,
        x2: nextX,
        y2: nextY,
        rank: bud.bornRound + progress,
        densityThreshold: bud.densityThreshold,
        depth: bud.depth,
        level: bud.level,
        baseDirection: bud.baseDirection,
        bendStrength: Math.abs(angleDelta(bud.baseDirection, segmentAngle)),
        bendDirection: angleDelta(bud.baseDirection, segmentAngle) === 0
          ? bud.initialBendDirection
          : angleDelta(bud.baseDirection, segmentAngle) < 0 ? -1 : 1,
        depthVisual: bud.depthVisual,
        tone: bud.tone,
        birthEpoch: -1,
        birthProgress: 0,
      })
      bud.x = nextX
      bud.y = nextY
      bud.dx = direction.x
      bud.dy = direction.y
      bud.parentId = id
      bud.step += 1
      endpoints.push({ x: nextX, y: nextY })

      if (bud.nextSpawn < bud.spawnSteps.length && bud.step >= bud.spawnSteps[bud.nextSpawn]) {
        const childIndex = bud.nextSpawn
        const childNext = random(config.seed ^ 0x1f83d9ab ^ Math.imul(bud.branchId + 1, 0x165667b1) ^ childIndex)
        const childDepth = bud.depth + 1
        const childSide = ((childIndex + (childNext() < 0.5 ? 0 : 1)) % 2 === 0 ? -1 : 1) as -1 | 1
        const offset = radians(32 + childNext() * 30) * childSide
        const crownCenter = crownAt(shape, nextY).center
        const childOutward = (nextX >= crownCenter ? 1 : -1) as -1 | 1
        let childAngle = childDepth === 2 && childNext() < 0.72
          ? childOutward === 1
            ? radians(28 + childNext() * 42)
            : Math.PI - radians(28 + childNext() * 42)
          : segmentAngle + offset
        if (Math.sin(childAngle) < 0.12) childAngle = Math.atan2(0.12, Math.cos(childAngle))
        const childSteps = childDepth === 2
          ? 5 + Math.floor(childNext() * 3) + Math.round(config.branching)
          : 3 + Math.floor(childNext() * 3) + Math.round(config.branching * 0.5)
        const densityThreshold = childDepth >= 3 ? childNext() : bud.densityThreshold
        spawned.push(makeBud(
          config.seed,
          config.branching,
          nextBranchId++,
          childDepth,
          id,
          nextX,
          nextY,
          childAngle,
          childSteps,
          round + 1,
          densityThreshold,
          childDepth === 2 ? childOutward : 0,
        ))
        bud.nextSpawn += 1
      }
    }

    for (const point of attractors) {
      if (point.alive && endpoints.some((end) => (point.x - end.x) ** 2 + (point.y - end.y) ** 2 <= killRadius2)) {
        point.alive = false
      }
    }
    buds = [...buds.filter((bud) => bud.step < bud.maxSteps), ...spawned]
  }

  return raw
}

function matureGrowthRate(epoch: number) {
  return MATURE_GROWTH_FLOOR + (1 - MATURE_GROWTH_FLOOR) * Math.exp(-MATURE_GROWTH_DECAY * epoch)
}


function widthBySupport(raw: RawSegment[]) {
  const children = raw.map(() => [] as number[])
  for (const segment of raw) if (segment.parentId !== null) children[segment.parentId].push(segment.id)
  const support = raw.map(() => 0)
  const widths = raw.map(() => 0)

  for (let id = raw.length - 1; id >= 0; id -= 1) {
    support[id] = children[id].length === 0
      ? 1
      : children[id].reduce((total, childId) => total + support[childId], 0)
    const segment = raw[id]
    const pipeWidth = (0.04 + 0.24 * support[id] ** (1 / 2.35)) * (1 - smoothstep(clamp(segment.branchProgress)) * 0.12)
    widths[id] = clamp(pipeWidth, WIDTH_MIN[segment.level], WIDTH_MAX[segment.level])
  }
  return widths
}

export function generateSkeleton(input: LegacyPlantConfig): PlantSkeleton {
  const config = normalizeConfig(input)
  const raw = growBlueprint(config)
  const matureAge = config.phase === 3 ? config.phaseProgress : 0
  const baseWidths = widthBySupport(raw)
  const stage = config.phase === 3 ? 3 + clamp(matureAge) : config.phase + config.phaseProgress
  const growthScale = 0.3 + 0.7 * (stage / 4) ** 0.65
  const rankRanges = new Map<number, { min: number; max: number }>()
  for (const segment of raw.filter(({ birthEpoch }) => birthEpoch < 0)) {
    const range = rankRanges.get(segment.depth)
    rankRanges.set(segment.depth, range
      ? { min: Math.min(range.min, segment.rank), max: Math.max(range.max, segment.rank) }
      : { min: segment.rank, max: segment.rank })
  }

  const branchesWithIds = raw.map((segment, index) => ({
    ...segment,
    persistentId: `segment:${segment.id}`,
    parentPersistentId: segment.parentId === null ? null : `segment:${segment.parentId}`,
    branchPersistentId: `branch:${segment.branchId}`,
    priority: priorityOf(config.seed, `segment:${segment.id}:priority`),
    growthDuration: segment.birthEpoch < 0 ? PHASE_SCHEDULE[segment.level][2] : 0.28,
    width: (() => {
      const birth = Math.max(0, PHASE_SCHEDULE[segment.level][0])
      const age = clamp((stage - birth) / (4 - birth))
      const branchAge = Math.max(0, matureAge - Math.max(0, segment.birthEpoch))
      const ageWidth = segment.level === 0
        ? Math.min(2.5, 1 + 0.08 * Math.log2(1 + branchAge))
        : segment.level === 1 ? Math.min(1.7, 1 + 0.04 * Math.log2(1 + branchAge)) : 1
      return baseWidths[index] * (0.55 + age * WIDTH_GROWTH[segment.level]) * ageWidth
    })(),
    visibility: (() => {
      if (segment.depth >= 3 && segment.densityThreshold > config.density) return 0
      if (segment.birthEpoch >= 0) {
        return clamp((matureAge - segment.birthEpoch - segment.birthProgress) / 0.28)
      }
      const range = rankRanges.get(segment.depth)!
      const order = range.max === range.min ? 0 : (segment.rank - range.min) / (range.max - range.min)
      const [start, spread, duration] = PHASE_SCHEDULE[segment.level]
      return clamp((stage - start - order * spread) / duration)
    })(),
  }))
  const branchesById = new Map(branchesWithIds.map((segment) => [segment.id, segment]))
  const sameAxisChildren = new Map<number, (typeof branchesWithIds)[number]>()
  const axesWithChildren = new Set<number>()
  for (const segment of branchesWithIds) {
    if (segment.parentId === null) continue
    const parent = branchesById.get(segment.parentId)!
    if (parent.branchId === segment.branchId) sameAxisChildren.set(parent.id, segment)
    else axesWithChildren.add(parent.branchId)
  }
  const foliageAnchors = branchesWithIds
    .filter((segment) => {
      const child = sameAxisChildren.get(segment.id)
      return (segment.depth > 0 || segment.branchId === 0)
        && (!child || (child.birthEpoch >= 0 && child.visibility < 1) || child.birthEpoch > segment.birthEpoch)
    })
    .map((segment) => {
      const child = sameAxisChildren.get(segment.id)
      return {
        id: segment.id,
        persistentId: segment.persistentId,
        x: segment.x2,
        y: segment.y2,
        angle: Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1),
        terminal: Boolean(child && ((child.birthEpoch >= 0 && child.visibility < 1) || child.birthEpoch > segment.birthEpoch))
          || segment.branchId === 0 || !axesWithChildren.has(segment.branchId),
        depth: segment.depth,
        level: segment.level,
        depthVisual: segment.depthVisual,
        visibility: segment.visibility,
        priority: priorityOf(config.seed, `${segment.persistentId}:foliage`),
        birthEpoch: segment.birthEpoch,
        birthProgress: segment.birthProgress,
        growthDuration: segment.growthDuration,
      }
    })
  const branches = branchesWithIds.map(({
    rank: _rank,
    densityThreshold: _densityThreshold,
    ...segment
  }) => segment)

  const bounds = branches.reduce((result, branch) => ({
    minX: Math.min(result.minX, branch.x1, branch.x2),
    minY: Math.min(result.minY, branch.y1, branch.y2),
    maxX: Math.max(result.maxX, branch.x1, branch.x2),
    maxY: Math.max(result.maxY, branch.y1, branch.y2),
  }), { minX: 0, minY: 0, maxX: 0, maxY: 0 })
  const chunk = {
    id: 0,
    epochStart: -3,
    epochEnd: -1,
    originX: 0,
    originY: 0,
    bounds,
    branches,
    microBranches: [],
    regions: [],
  }
  return {
    root: { x: 0, y: 0 },
    branches,
    chunks: [chunk],
    activeChunk: null,
    foliageAnchors,
    growthScale,
    time: { phase: config.phase, epoch: 0, progress: config.phaseProgress },
    supportByBranch: new Map(),
    activeSupportByBranch: new Map(),
    stats: { generatedEpochs: 0, activeSegments: 0, visitedHistoricalSegments: branches.length },
  }
}

export function generateCrown(skeleton: PlantSkeleton, input: LegacyPlantConfig): PlantCrown {
  const config = normalizeConfig(input)
  const density = config.density
  const crownDensity = smoothstep(density)
  const vitality = config.vitality
  const curvature = config.curvature
  const phase = config.phase
  const progress = config.phaseProgress
  const matureAge = phase === 3 ? progress : 0
  const smoothProgress = smoothstep(progress)
  const matureProgress = smoothstep(clamp(matureAge))
  const maturity = phase < 2 ? 0 : phase === 2 ? smoothProgress * 0.45 : 0.45 + matureProgress * 0.55
  const microProgress = phase === 3 ? matureProgress : 0
  const baseTreeHeight = Math.max(...skeleton.branches.filter((branch) => branch.birthEpoch < 0).map((branch) => branch.y2))
  const branchById = new Map(skeleton.branches.map((branch) => [branch.id, branch]))
  const candidateAnchors = skeleton.foliageAnchors
    .filter((anchor) => anchor.birthEpoch < 0
      ? anchor.depth === 0 || anchor.depth === 2 || (anchor.terminal && anchor.depth >= 2)
      : anchor.terminal && anchor.depth >= 1)
    .sort((left, right) => Number(right.terminal) - Number(left.terminal) || left.id - right.id)
  const crownCandidateCount = Math.min(candidateAnchors.length, MAX_CROWN_REGIONS)
  const crownCandidates = Array.from(
    { length: crownCandidateCount },
    (_, index) => candidateAnchors[Math.floor(index * candidateAnchors.length / crownCandidateCount)],
  )
  const crownAnchors = crownCandidates.reduce<typeof candidateAnchors>((selected, anchor) => {
    const minimumDistance = anchor.birthEpoch < 0
      ? baseTreeHeight * 0.035
      : Math.max(baseTreeHeight, anchor.y) * 0.025
    if (selected.length < MAX_CROWN_REGIONS && selected.every((other) => Math.hypot(anchor.x - other.x, anchor.y - other.y) >= minimumDistance)) {
      selected.push(anchor)
    }
    return selected
  }, []).sort((left, right) => left.id - right.id)
  const terminalAnchors = skeleton.foliageAnchors.filter((anchor) => anchor.terminal && anchor.depth >= 2)
  const microBranches: BranchSegment[] = []
  const regions: PlantCrown['regions'] = []
  const firstMicroBranchId = Math.max(...skeleton.branches.map((branch) => branch.branchId)) + 1
  const firstMicroId = Math.max(...skeleton.branches.map((branch) => branch.id)) + 1

  for (const anchor of crownAnchors) {
    const regionKey = branchById.get(anchor.id)?.branchId ?? anchor.id
    const next = random(config.seed ^ 0xc2b2ae35 ^ Math.imul(regionKey + 1, 0x27d4eb2d))
    const heightScale = 0.88 + smoothstep(clamp(anchor.y / baseTreeHeight)) * 0.25
    const regionScale = anchor.birthEpoch < 0 ? baseTreeHeight : Math.max(baseTreeHeight, anchor.y)
    const radiusX = regionScale * (anchor.birthEpoch < 0 ? 0.055 + next() * 0.038 : 0.026 + next() * 0.022) * heightScale
    const radiusY = radiusX * (0.58 + next() * 0.18)
    const depthVisual = clamp(anchor.depthVisual * 0.65 + next() * 0.35)
    const leaves = Array.from({ length: REGION_PARTICLES }, (_, leafIndex) => {
      const threshold = next()
      const direction = next() * Math.PI * 2
      const distance = Math.sqrt(next())
      return {
        threshold,
        id: `${anchor.persistentId}:leaf:${leafIndex}`,
        x: Math.cos(direction) * distance * radiusX,
        y: Math.sin(direction) * distance * radiusY,
        angle: anchor.angle + (next() - 0.5) * 1.8,
        size: 0.42 + next() * 0.5,
        opacity: anchor.visibility,
        vitality,
        depthVisual: clamp(depthVisual + (next() - 0.5) * 0.35),
        priority: threshold,
        birthEpoch: anchor.birthEpoch,
        birthProgress: Math.min(0.9, anchor.birthProgress + 0.08 + threshold * 0.18),
        growthDuration: 0.22,
      }
    }).filter((leaf) => leaf.threshold <= crownDensity * maturity * anchor.visibility * (0.25 + vitality * 0.75))
      .map(({ threshold: _threshold, ...leaf }) => leaf)

    regions.push({
      anchorId: anchor.id,
      anchorPersistentId: anchor.persistentId,
      x: anchor.x + Math.cos(anchor.angle) * radiusX * 0.12,
      y: anchor.y + Math.sin(anchor.angle) * radiusY * 0.12,
      radiusX,
      radiusY,
      depthVisual,
      visibility: anchor.visibility * crownDensity * maturity * (0.35 + vitality * 0.65),
      tone: next(),
      vitality,
      priority: anchor.priority,
      leaves,
    })
  }

  for (const [anchorIndex, anchor] of terminalAnchors.entries()) {
    const regionKey = branchById.get(anchor.id)?.branchId ?? anchor.id
    const next = random(config.seed ^ 0xd1310ba6 ^ Math.imul(regionKey + 1, 0x27d4eb2d))
    const localMicroProgress = anchor.birthEpoch < 0 ? microProgress : clamp(matureAge - anchor.birthEpoch)
    for (let twig = 0; twig < MICRO_TWIGS; twig += 1) {
      const threshold = next()
      const branchId = firstMicroBranchId + anchorIndex * MICRO_TWIGS + twig
      const offset = (next() - 0.5) * (0.8 + curvature * 0.55)
      const baseDirection = anchor.angle + offset
      const bendDirection = (next() < 0.5 ? -1 : 1) as -1 | 1
      const bendStrength = curvature * (0.12 + next() * 0.2)
      const angle1 = baseDirection + bendDirection * bendStrength * 0.42
      const angle2 = baseDirection + bendDirection * bendStrength
      const length1 = 0.4 + next() * 0.25
      const length2 = length1 * (0.48 + next() * 0.22)
      const x2 = anchor.x + Math.cos(angle1) * length1
      const y2 = anchor.y + Math.sin(angle1) * length1
      const x3 = x2 + Math.cos(angle2) * length2
      const y3 = y2 + Math.sin(angle2) * length2
      const start = 0.04 + threshold * 0.58
      const enabled = threshold <= density ? anchor.visibility : 0
      const depthVisual = clamp(anchor.depthVisual * 0.72 + next() * 0.28)
      const width = 0.12 + next() * 0.04
      const id = firstMicroId + microBranches.length
      microBranches.push(
        {
          id,
          persistentId: `${anchor.persistentId}:twig:${twig}:0`,
          parentId: anchor.id,
          parentPersistentId: anchor.persistentId,
          branchId,
          branchPersistentId: `${anchor.persistentId}:twig:${twig}`,
          branchProgress: 0.5,
          x1: anchor.x,
          y1: anchor.y,
          x2,
          y2,
          width: width * 0.9,
          depth: anchor.depth + 1,
          level: 4,
          baseDirection,
          bendStrength,
          bendDirection,
          depthVisual,
          visibility: enabled * clamp((localMicroProgress - start) / 0.18),
          tone: next(),
          priority: threshold,
          birthEpoch: anchor.birthEpoch,
          birthProgress: Math.min(0.88, anchor.birthProgress + start),
          growthDuration: 0.18,
        },
        {
          id: id + 1,
          persistentId: `${anchor.persistentId}:twig:${twig}:1`,
          parentId: id,
          parentPersistentId: `${anchor.persistentId}:twig:${twig}:0`,
          branchId,
          branchPersistentId: `${anchor.persistentId}:twig:${twig}`,
          branchProgress: 1,
          x1: x2,
          y1: y2,
          x2: x3,
          y2: y3,
          width: width * 0.66,
          depth: anchor.depth + 2,
          level: 4,
          baseDirection,
          bendStrength,
          bendDirection,
          depthVisual,
          visibility: enabled * clamp((localMicroProgress - start - 0.12) / 0.2),
          tone: next(),
          priority: threshold,
          birthEpoch: anchor.birthEpoch,
          birthProgress: Math.min(0.94, anchor.birthProgress + start + 0.12),
          growthDuration: 0.2,
        },
      )
    }
  }

  const ambientNext = random(config.seed ^ 0x94d049bb)
  const ambientParticles: PlantCrown['ambientParticles'] = []
  for (let index = 0; index < AMBIENT_PARTICLES && regions.length > 0; index += 1) {
    const region = regions[Math.floor(ambientNext() * regions.length)]
    const threshold = ambientNext()
    const direction = ambientNext() * Math.PI * 2
    const distance = 1.2 + ambientNext() * 1.4
    const particle = {
      x: region.x + Math.cos(direction) * region.radiusX * distance,
      y: region.y + Math.sin(direction) * region.radiusY * distance,
      size: 0.12 + ambientNext() * 0.2,
      alpha: (0.08 + ambientNext() * 0.18) * (0.35 + vitality * 0.65),
      depthVisual: ambientNext(),
    }
    if (threshold <= region.visibility * (0.2 + vitality * 0.45)) ambientParticles.push(particle)
  }

  return { microBranches, regions, activeMicroBranches: [], activeRegions: [], ambientParticles, density }
}

type EngineBud = {
  x: number
  y: number
  angle: number
  bendVelocity: number
  parentId: number
  parentPersistentId: PersistentId
  branchId: number
  branchPersistentId: PersistentId
  ancestors: PersistentId[]
  branchProgress: number
  baseDirection: number
  depth: number
  level: BranchLevel
  depthVisual: number
  tone: number
  outward: -1 | 0 | 1
  role: 'trunk' | 'edge' | 'branch'
  life: number
  lengthScale: number
}

type ActivePlan = {
  epoch: number
  segments: BranchSegment[]
  anchors: FoliageAnchor[]
  nextFrontier: EngineBud[]
  nextBranchId: number
  support: Array<{ source: PersistentId; branches: PersistentId[]; birthProgress: number; growthDuration: number }>
}

const emptyBounds = (): Bounds => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 })

function boundsOf(branches: BranchSegment[]): Bounds {
  return branches.reduce((bounds, branch) => ({
    minX: Math.min(bounds.minX, branch.x1, branch.x2),
    minY: Math.min(bounds.minY, branch.y1, branch.y2),
    maxX: Math.max(bounds.maxX, branch.x1, branch.x2),
    maxY: Math.max(bounds.maxY, branch.y1, branch.y2),
  }), emptyBounds())
}

function mergeBounds(left: Bounds, right: Bounds): Bounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  }
}

function boundsOfRegions(regions: PlantCrown['regions']): Bounds {
  return regions.reduce((bounds, region) => region.visibility <= 0 ? bounds : ({
    minX: Math.min(bounds.minX, region.x - region.radiusX),
    minY: Math.min(bounds.minY, region.y - region.radiusY),
    maxX: Math.max(bounds.maxX, region.x + region.radiusX),
    maxY: Math.max(bounds.maxY, region.y + region.radiusY),
  }), emptyBounds())
}

function initialEngineFrontier(branches: BranchSegment[], branching: number): EngineBud[] {
  const lastByBranch = new Map<number, BranchSegment>()
  for (const segment of branches) {
    const previous = lastByBranch.get(segment.branchId)
    if (!previous || segment.branchProgress > previous.branchProgress) lastByBranch.set(segment.branchId, segment)
  }
  const trunk = lastByBranch.get(0)!
  const primaryTips = [...lastByBranch.values()].filter((segment) => segment.depth === 1)
  const sideTip = (outward: -1 | 1) => primaryTips
    .filter((segment) => Math.sign(Math.cos(segment.baseDirection)) === outward)
    .reduce<BranchSegment | undefined>((best, segment) => !best || segment.id > best.id ? segment : best, undefined)
  const make = (segment: BranchSegment, role: EngineBud['role'], outward: EngineBud['outward']): EngineBud => ({
    x: segment.x2,
    y: segment.y2,
    angle: Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1),
    bendVelocity: 0,
    parentId: segment.id,
    parentPersistentId: segment.persistentId,
    branchId: segment.branchId,
    branchPersistentId: segment.branchPersistentId,
    ancestors: role === 'trunk' ? [segment.branchPersistentId] : ['branch:0', segment.branchPersistentId],
    branchProgress: segment.branchProgress,
    baseDirection: segment.baseDirection,
    depth: segment.depth,
    level: segment.level,
    depthVisual: segment.depthVisual,
    tone: segment.tone,
    outward,
    role,
    life: role === 'trunk' ? -1 : 10 + Math.round(branching * 8),
    lengthScale: 1,
  })
  const frontier = [make(trunk, 'trunk', 0)]
  const left = sideTip(-1)
  const right = sideTip(1)
  if (left) frontier.push(make(left, 'edge', -1))
  if (right && right.id !== left?.id) frontier.push(make(right, 'edge', 1))
  return frontier
}

function segmentVisibility(progress: number, birthProgress: number, duration: number) {
  return smoothstep(clamp((progress - birthProgress) / duration))
}

function anchorsForSegments(seed: number, segments: BranchSegment[]): FoliageAnchor[] {
  return segments.filter((segment) => segment.depth >= 1).map((segment) => ({
    id: segment.id,
    persistentId: `${segment.persistentId}:anchor`,
    x: segment.x2,
    y: segment.y2,
    angle: Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1),
    terminal: true,
    depth: segment.depth,
    level: segment.level,
    depthVisual: segment.depthVisual,
    visibility: 0,
    priority: priorityOf(seed, `${segment.persistentId}:foliage`),
    birthEpoch: segment.birthEpoch,
    birthProgress: segment.birthProgress,
    growthDuration: segment.growthDuration,
  }))
}

function planEpoch(
  morphology: PlantMorphology,
  epoch: number,
  frontier: EngineBud[],
  firstId: number,
  firstBranchId: number,
): ActivePlan {
  const growth = matureGrowthRate(epoch)
  const macroLean = (random(morphology.seed ^ 0x3bd39e10)() - 0.5) * radians(10)
  const segments: BranchSegment[] = []
  const continued: EngineBud[] = []
  const spawned: EngineBud[] = []
  const support: ActivePlan['support'] = []
  let nextBranchId = firstBranchId

  const extend = (bud: EngineBud, birthProgress: number, duration: number) => {
    const key = `${bud.branchPersistentId}:epoch:${epoch}`
    const next = random(hashKey(morphology.seed, `${key}:geometry`))
    const targetAngle = bud.role === 'trunk'
      ? Math.PI / 2 + macroLean + Math.sin(epoch * 0.11 + morphology.seed) * morphology.curvature * 0.08
      : bud.role === 'edge'
        ? radians(bud.outward === 1 ? 60 : 120)
        : bud.baseDirection + angleDelta(bud.baseDirection, Math.PI / 2) * 0.22
    const bendVelocity = bud.bendVelocity * 0.72 + (next() * 2 - 1) * morphology.curvature * (
      bud.role === 'trunk' ? 0.018 : bud.role === 'edge' ? 0.055 : 0.095
    )
    const turnLimit = bud.role === 'trunk' ? radians(4) : bud.role === 'edge' ? radians(9) : radians(15)
    let angle = bud.angle + clamp(angleDelta(bud.angle, targetAngle) * 0.18 + bendVelocity, -turnLimit, turnLimit)
    if (bud.role === 'trunk') {
      angle = Math.PI / 2 + clamp(angleDelta(Math.PI / 2, angle), -radians(12), radians(12))
    } else {
      const direction = normalized(Math.cos(angle), Math.max(0.18, Math.sin(angle)))
      angle = Math.atan2(direction.y, bud.outward * Math.max(0.12, Math.abs(direction.x)))
    }
    const baseLength = bud.role === 'trunk' ? 1.05 : bud.role === 'edge' ? 0.78 : 0.62
    const length = baseLength * growth * bud.lengthScale * (0.88 + next() * 0.24)
    const x2 = bud.x + Math.cos(angle) * length
    const y2 = bud.y + Math.sin(angle) * length
    const id = firstId + segments.length
    const persistentId = `${key}:segment`
    const segment: BranchSegment = {
      id,
      persistentId,
      parentId: bud.parentId,
      parentPersistentId: bud.parentPersistentId,
      branchId: bud.branchId,
      branchPersistentId: bud.branchPersistentId,
      branchProgress: bud.branchProgress + 1,
      x1: bud.x,
      y1: bud.y,
      x2,
      y2,
      width: WIDTH_MIN[bud.level],
      depth: bud.depth,
      level: bud.level,
      baseDirection: bud.baseDirection,
      bendStrength: Math.abs(angleDelta(bud.baseDirection, angle)),
      bendDirection: angleDelta(bud.baseDirection, angle) < 0 ? -1 : 1,
      depthVisual: bud.depthVisual,
      visibility: 0,
      tone: bud.tone,
      priority: priorityOf(morphology.seed, `${persistentId}:priority`),
      birthEpoch: epoch,
      birthProgress,
      growthDuration: duration,
    }
    segments.push(segment)
    return {
      ...bud,
      x: x2,
      y: y2,
      angle,
      bendVelocity,
      parentId: id,
      parentPersistentId: persistentId,
      branchProgress: bud.branchProgress + 1,
      life: bud.life < 0 ? -1 : bud.life - 1,
    }
  }

  for (const bud of frontier) {
    const schedule = random(hashKey(morphology.seed, `${bud.branchPersistentId}:epoch:${epoch}:schedule`))
    const birthProgress = schedule() * 0.32
    const duration = 0.34 + schedule() * 0.22
    const grown = extend(bud, birthProgress, duration)
    if (grown.life !== 0) continued.push(grown)

    const spawnChance = bud.role === 'trunk'
      ? (0.04 + morphology.branching * 0.28) * growth
      : bud.role === 'edge' ? morphology.branching * 0.08 : morphology.branching * 0.055
    const spawnNext = random(hashKey(morphology.seed, `${bud.branchPersistentId}:epoch:${epoch}:spawn`))
    const firstMatureBranch = epoch === 0 && priorityOf(morphology.seed, bud.branchPersistentId) < morphology.branching
    if (continued.length + spawned.length >= MAX_MATURE_FRONTIER || (!firstMatureBranch && spawnNext() >= spawnChance)) continue

    const outward = (spawnNext() < 0.5 ? -1 : 1) as -1 | 1
    const depth = bud.role === 'trunk' ? 1 : Math.min(4, bud.depth + 1)
    const spread = radians(18 + spawnNext() * 58)
    const childAngle = outward === 1 ? spread : Math.PI - spread
    const branchId = nextBranchId++
    const branchPersistentId = `${bud.branchPersistentId}:child:${epoch}`
    const childNext = random(hashKey(morphology.seed, `${branchPersistentId}:traits`))
    const life = depth === 1
      ? 16 + Math.floor(childNext() * 7 + morphology.branching * 6)
      : 4 + Math.floor(childNext() * 4 + morphology.branching * 3)
    const reachVariation = 0.62 + childNext() * 0.76
    const lengthScale = depth === 1
      ? Math.max(1, grown.y * (0.44 + morphology.branching * 0.38) * reachVariation
        * (0.72 + Math.sin(childAngle) * 0.28) / (life * 0.62 * growth))
      : bud.lengthScale * (0.38 + childNext() * 0.18)
    const child: EngineBud = {
      x: grown.x,
      y: grown.y,
      angle: childAngle,
      bendVelocity: 0,
      parentId: grown.parentId,
      parentPersistentId: grown.parentPersistentId,
      branchId,
      branchPersistentId,
      ancestors: [...bud.ancestors, branchPersistentId],
      branchProgress: 0,
      baseDirection: childAngle,
      depth,
      level: levelOf(depth),
      depthVisual: childNext(),
      tone: childNext(),
      outward,
      role: 'branch',
      life,
      lengthScale,
    }
    const childBirth = Math.min(0.78, birthProgress + duration * (0.62 + schedule() * 0.12))
    const childDuration = Math.max(0.16, 1 - childBirth)
    const grownChild = extend(child, childBirth, childDuration)
    if (grownChild.life !== 0) spawned.push(grownChild)
    support.push({ source: branchPersistentId, branches: bud.ancestors, birthProgress: childBirth, growthDuration: childDuration })
  }

  return {
    epoch,
    segments,
    anchors: anchorsForSegments(morphology.seed, segments),
    nextFrontier: [...continued, ...spawned].slice(0, MAX_MATURE_FRONTIER),
    nextBranchId,
    support,
  }
}

function makeIncrementalCrown(
  morphology: PlantMorphology,
  appearance: PlantAppearance,
  anchors: FoliageAnchor[],
  firstMicroId: number,
): PlantCrown {
  const regions: PlantCrown['regions'] = []
  const microBranches: BranchSegment[] = []
  for (const anchor of anchors) {
    if (anchor.priority > (anchor.depth === 1 ? 0.18 : 0.1)) continue
    const next = random(hashKey(morphology.seed, `${anchor.persistentId}:crown`))
    const radiusX = Math.max(0.3, Math.abs(anchor.y) * (0.018 + next() * 0.018))
    const radiusY = radiusX * (0.58 + next() * 0.18)
    const depthVisual = clamp(anchor.depthVisual * 0.65 + next() * 0.35)
    const leaves = Array.from({ length: REGION_PARTICLES }, (_, index) => {
      const priority = next()
      const direction = next() * Math.PI * 2
      const distance = Math.sqrt(next())
      return {
        id: `${anchor.persistentId}:leaf:${index}`,
        x: Math.cos(direction) * distance * radiusX,
        y: Math.sin(direction) * distance * radiusY,
        angle: anchor.angle + (next() - 0.5) * 1.8,
        size: 0.42 + next() * 0.5,
        opacity: 0,
        vitality: appearance.vitality,
        depthVisual: clamp(depthVisual + (next() - 0.5) * 0.35),
        priority,
        birthEpoch: anchor.birthEpoch,
        birthProgress: Math.min(0.92, anchor.birthProgress + 0.05 + priority * 0.16),
        growthDuration: Math.max(0.08, 1 - Math.min(0.92, anchor.birthProgress + 0.05 + priority * 0.16)),
      }
    })
    regions.push({
      anchorId: anchor.id,
      anchorPersistentId: anchor.persistentId,
      x: anchor.x + Math.cos(anchor.angle) * radiusX * 0.12,
      y: anchor.y + Math.sin(anchor.angle) * radiusY * 0.12,
      radiusX,
      radiusY,
      depthVisual,
      visibility: 0,
      tone: next(),
      vitality: appearance.vitality,
      priority: anchor.priority,
      leaves,
    })
    for (let twig = 0; twig < 2; twig += 1) {
      const branchPersistentId = `${anchor.persistentId}:twig:${twig}`
      const angle = anchor.angle + (next() - 0.5) * (0.8 + morphology.curvature * 0.55)
      const length = 0.35 + next() * 0.28
      const birthProgress = Math.min(0.9, anchor.birthProgress + 0.08 + next() * 0.2)
      microBranches.push({
        id: firstMicroId + microBranches.length,
        persistentId: `${branchPersistentId}:segment`,
        parentId: anchor.id,
        parentPersistentId: anchor.persistentId,
        branchId: firstMicroId + microBranches.length,
        branchPersistentId,
        branchProgress: 1,
        x1: anchor.x,
        y1: anchor.y,
        x2: anchor.x + Math.cos(angle) * length,
        y2: anchor.y + Math.sin(angle) * length,
        width: 0.1,
        depth: anchor.depth + 1,
        level: 4,
        baseDirection: angle,
        bendStrength: morphology.curvature * 0.15,
        bendDirection: next() < 0.5 ? -1 : 1,
        depthVisual,
        visibility: 0,
        tone: next(),
        priority: next(),
        birthEpoch: anchor.birthEpoch,
        birthProgress,
        growthDuration: Math.max(0.1, 1 - birthProgress),
      })
    }
  }
  return {
    microBranches,
    regions,
    activeMicroBranches: [],
    activeRegions: [],
    ambientParticles: [],
    density: appearance.density,
  }
}

export class TreeGrowthEngine {
  readonly morphology: PlantMorphology
  private appearance: PlantAppearance
  private time = { phase: 0 as PlantPhase, epoch: 0, progress: 0 }
  private completed: BranchSegment[]
  private chunks: PlantChunk[]
  private frontier: EngineBud[]
  private active: ActivePlan | null = null
  private nextId: number
  private nextBranchId: number
  private completedBounds: Bounds
  private completedCrownBounds: Bounds
  private support = new Map<PersistentId, number>()
  private activeSupport = new Map<PersistentId, number>()
  private crown: PlantCrown
  private activeCrown: PlantCrown = {
    microBranches: [],
    regions: [],
    activeMicroBranches: [],
    activeRegions: [],
    ambientParticles: [],
    density: 1,
  }
  private presentCrown: PlantCrown

  constructor(config: PlantConfig) {
    this.morphology = {
      seed: Math.trunc(Number.isFinite(config.seed) ? config.seed : 0),
      branching: clamp(config.branching),
      curvature: clamp(config.curvature),
    }
    this.appearance = { density: clamp(config.density), vitality: clamp(config.vitality) }
    const baseConfig = this.legacy(2, 1)
    const base = generateSkeleton(baseConfig)
    this.completed = base.branches
    this.completedBounds = boundsOf(this.completed)
    this.chunks = [{
      id: 0,
      epochStart: -3,
      epochEnd: -1,
      originX: 0,
      originY: 0,
      bounds: this.completedBounds,
      branches: [...this.completed],
      microBranches: [],
      regions: [],
    }]
    this.frontier = initialEngineFrontier(this.completed, this.morphology.branching)
    this.nextId = Math.max(...this.completed.map(({ id }) => id)) + 1
    this.nextBranchId = Math.max(...this.completed.map(({ branchId }) => branchId)) + 1
    this.crown = generateCrown(base, { ...baseConfig, phase: 3, phaseProgress: 1 })
    this.completedCrownBounds = boundsOfRegions(this.crown.regions)
    this.chunks[0].microBranches = this.crown.microBranches
    this.chunks[0].regions = this.crown.regions
    this.chunks[0].bounds = mergeBounds(this.chunks[0].bounds, boundsOfRegions(this.crown.regions))
    this.presentCrown = this.crown
  }

  private legacy(phase: PlantPhase, phaseProgress: number): LegacyPlantConfig {
    return { ...this.morphology, ...this.appearance, phase, phaseProgress }
  }

  private ensureActive() {
    if (this.active || this.time.phase < 3) return
    this.active = planEpoch(this.morphology, this.time.epoch, this.frontier, this.nextId, this.nextBranchId)
    this.activeCrown = makeIncrementalCrown(this.morphology, this.appearance, this.active.anchors, this.nextId + this.active.segments.length)
    this.presentCrown = {
      microBranches: this.crown.microBranches,
      regions: this.crown.regions,
      activeMicroBranches: this.activeCrown.microBranches,
      activeRegions: this.activeCrown.regions,
      ambientParticles: [],
      density: this.appearance.density,
    }
    this.updateActive(this.time.progress)
  }

  private replanActive() {
    if (!this.active || this.time.phase < 3) return
    const previous = this.active
    const replanned = planEpoch(this.morphology, this.time.epoch, this.frontier, this.nextId, this.nextBranchId)
    const previousSegments = new Map(previous.segments.map((segment) => [segment.persistentId, segment]))
    const replannedIds = new Set(replanned.segments.map(({ persistentId }) => persistentId))
    const frozenBranches = new Set<PersistentId>()
    const segments = replanned.segments.map((segment) => {
      const old = previousSegments.get(segment.persistentId)
      if (old?.visibility === 1) {
        frozenBranches.add(old.branchPersistentId)
        return old
      }
      if (!old) {
        segment.birthProgress = Math.max(segment.birthProgress, this.time.progress)
        segment.growthDuration = Math.max(0.08, 1 - segment.birthProgress)
      }
      return segment
    })
    for (const old of previous.segments) {
      if (!replannedIds.has(old.persistentId) && old.visibility > 0) {
        segments.push(old)
        frozenBranches.add(old.branchPersistentId)
      }
    }

    const previousBranchIds = new Map(previous.segments.map((segment) => [segment.branchPersistentId, segment.branchId]))
    const frontierBranchIds = new Map(this.frontier.map((bud) => [bud.branchPersistentId, bud.branchId]))
    const usedBranchIds = new Set([...previousBranchIds.values(), ...frontierBranchIds.values()])
    const branchIds = new Map<PersistentId, number>()
    let branchId = this.nextBranchId
    for (const segment of segments) {
      let stableId = branchIds.get(segment.branchPersistentId)
        ?? previousBranchIds.get(segment.branchPersistentId)
        ?? frontierBranchIds.get(segment.branchPersistentId)
      if (stableId === undefined) {
        while (usedBranchIds.has(branchId)) branchId += 1
        stableId = branchId++
        usedBranchIds.add(stableId)
      }
      branchIds.set(segment.branchPersistentId, stableId)
      segment.branchId = stableId
    }

    const activeIds = new Map<PersistentId, number>()
    segments.forEach((segment, index) => {
      segment.id = this.nextId + index
      activeIds.set(segment.persistentId, segment.id)
    })
    for (const segment of segments) {
      const parentId = segment.parentPersistentId === null ? undefined : activeIds.get(segment.parentPersistentId)
      if (parentId !== undefined) segment.parentId = parentId
    }

    const previousNext = new Map(previous.nextFrontier.map((bud) => [bud.branchPersistentId, bud]))
    const nextFrontier = replanned.nextFrontier.map((bud) => frozenBranches.has(bud.branchPersistentId)
      ? previousNext.get(bud.branchPersistentId) ?? bud
      : bud)
    const nextBranches = new Set(nextFrontier.map((bud) => bud.branchPersistentId))
    for (const bud of previous.nextFrontier) {
      if (frozenBranches.has(bud.branchPersistentId) && !nextBranches.has(bud.branchPersistentId)) nextFrontier.push(bud)
    }
    for (const bud of nextFrontier) {
      bud.branchId = branchIds.get(bud.branchPersistentId) ?? bud.branchId
      const parentId = activeIds.get(bud.parentPersistentId)
      if (parentId !== undefined) bud.parentId = parentId
    }

    const previousSupport = new Map(previous.support.map((addition) => [addition.source, addition]))
    const support = replanned.support.map((addition) => previousSupport.has(addition.source) ? addition : {
      ...addition,
      birthProgress: Math.max(addition.birthProgress, this.time.progress),
      growthDuration: Math.max(0.08, 1 - Math.max(addition.birthProgress, this.time.progress)),
    })
    const supportSources = new Set(support.map(({ source }) => source))
    for (const addition of previous.support) {
      const segment = previous.segments.find(({ branchPersistentId }) => branchPersistentId === addition.source)
      if (!supportSources.has(addition.source) && segment && segment.visibility > 0) support.push(addition)
    }

    this.active = {
      epoch: replanned.epoch,
      segments,
      anchors: anchorsForSegments(this.morphology.seed, segments),
      nextFrontier,
      nextBranchId: Math.max(previous.nextBranchId, replanned.nextBranchId, branchId),
      support,
    }
    const previousCrown = this.activeCrown
    const nextCrown = makeIncrementalCrown(this.morphology, this.appearance, this.active.anchors, this.nextId + segments.length)
    const previousRegions = new Map(previousCrown.regions.map((region) => [region.anchorPersistentId, region]))
    nextCrown.regions = nextCrown.regions.map((region) => {
      const old = previousRegions.get(region.anchorPersistentId)
      return old?.visibility === 1 ? old : region
    })
    const previousMicro = new Map(previousCrown.microBranches.map((branch) => [branch.persistentId, branch]))
    nextCrown.microBranches = nextCrown.microBranches.map((branch) => {
      const old = previousMicro.get(branch.persistentId)
      return old?.visibility === 1 ? old : branch
    })
    this.activeCrown = nextCrown
    this.presentCrown = {
      microBranches: this.crown.microBranches,
      regions: this.crown.regions,
      activeMicroBranches: nextCrown.microBranches,
      activeRegions: nextCrown.regions,
      ambientParticles: [],
      density: this.appearance.density,
    }
    this.updateActive(this.time.progress)
  }

  private updateActive(progress: number) {
    if (!this.active) return
    this.activeSupport.clear()
    for (const segment of this.active.segments) {
      segment.visibility = segmentVisibility(progress, segment.birthProgress, segment.growthDuration)
    }
    for (const anchor of this.active.anchors) {
      anchor.visibility = segmentVisibility(progress, anchor.birthProgress, anchor.growthDuration)
    }
    for (const addition of this.active.support) {
      const visible = segmentVisibility(progress, addition.birthProgress, addition.growthDuration)
      for (const branch of addition.branches) {
        this.activeSupport.set(branch, (this.activeSupport.get(branch) ?? 0) + visible)
      }
    }
    for (const branch of this.activeCrown.microBranches) {
      branch.visibility = segmentVisibility(progress, branch.birthProgress, branch.growthDuration)
    }
    for (const region of this.activeCrown.regions) {
      const anchor = this.active.anchors.find(({ persistentId }) => persistentId === region.anchorPersistentId)
      region.visibility = anchor?.visibility ?? 0
      region.vitality = this.appearance.vitality
      for (const leaf of region.leaves) {
        leaf.opacity = segmentVisibility(progress, leaf.birthProgress, leaf.growthDuration)
        leaf.vitality = this.appearance.vitality
      }
    }
  }

  private commitActive() {
    if (!this.active) return
    this.updateActive(1)
    this.completed.push(...this.active.segments)
    this.completedBounds = mergeBounds(this.completedBounds, boundsOf(this.active.segments))
    const group = Math.floor(this.active.epoch / 32)
    let chunk = this.chunks.at(-1)
    if (!chunk || chunk.id !== group + 1) {
      chunk = {
        id: group + 1,
        epochStart: this.active.epoch,
        epochEnd: this.active.epoch,
        originX: this.active.segments[0]?.x1 ?? 0,
        originY: this.active.segments[0]?.y1 ?? 0,
        bounds: boundsOf(this.active.segments),
        branches: [],
        microBranches: [],
        regions: [],
      }
      this.chunks.push(chunk)
    }
    chunk.branches.push(...this.active.segments)
    chunk.microBranches.push(...this.activeCrown.microBranches)
    chunk.regions.push(...this.activeCrown.regions)
    chunk.epochEnd = this.active.epoch
    chunk.bounds = mergeBounds(mergeBounds(chunk.bounds, boundsOf(this.active.segments)), boundsOfRegions(this.activeCrown.regions))
    for (const addition of this.active.support) {
      for (const branch of addition.branches) this.support.set(branch, (this.support.get(branch) ?? 0) + 1)
    }
    this.crown.microBranches.push(...this.activeCrown.microBranches)
    this.crown.regions.push(...this.activeCrown.regions)
    this.completedCrownBounds = mergeBounds(this.completedCrownBounds, boundsOfRegions(this.activeCrown.regions))
    this.frontier = this.active.nextFrontier
    this.nextId += this.active.segments.length
    this.nextBranchId = this.active.nextBranchId
    this.active = null
    this.activeCrown = {
      microBranches: [], regions: [], activeMicroBranches: [], activeRegions: [], ambientParticles: [], density: this.appearance.density,
    }
    this.presentCrown = this.crown
  }

  setAppearance(appearance: PlantAppearance) {
    const next = { density: clamp(appearance.density), vitality: clamp(appearance.vitality) }
    if (next.density === this.appearance.density && next.vitality === this.appearance.vitality) return this.scene()
    this.appearance = next
    for (const region of [...this.crown.regions, ...this.activeCrown.regions]) {
      region.vitality = this.appearance.vitality
      for (const leaf of region.leaves) leaf.vitality = this.appearance.vitality
    }
    this.crown.density = this.appearance.density
    this.presentCrown.density = this.appearance.density
    return this.scene()
  }

  setMorphology(morphology: Pick<PlantMorphology, 'branching' | 'curvature'>) {
    const branching = clamp(morphology.branching)
    const curvature = clamp(morphology.curvature)
    if (branching === this.morphology.branching && curvature === this.morphology.curvature) return this.scene()
    this.morphology.branching = branching
    this.morphology.curvature = curvature
    if (this.time.phase === 3) {
      this.ensureActive()
      this.replanActive()
    }
    return this.scene()
  }

  setProgress(value: number) {
    const progress = clamp(value)
    if (progress < this.time.progress) return this.scene()
    this.time.progress = progress
    if (this.time.phase === 3) {
      this.ensureActive()
      this.updateActive(progress)
    }
    if (progress < 1) return this.scene()

    if (this.time.phase < 3) {
      this.time.phase = (this.time.phase + 1) as PlantPhase
    }
    else {
      this.commitActive()
      this.time.epoch += 1
    }
    this.time.progress = 0
    this.ensureActive()
    return this.scene()
  }

  previewProgress(value: number) {
    const progress = clamp(value)
    if (progress < this.time.progress) return this.scene()
    this.time.progress = progress
    if (this.time.phase === 3) {
      this.ensureActive()
      this.updateActive(progress)
    }
    return this.scene()
  }

  setTotalGrowth(totalGrowth: number) {
    const target = Math.max(0, Number.isFinite(totalGrowth) ? totalGrowth : 0)
    const currentUnits = this.time.phase < 3 ? this.time.phase : 3 + this.time.epoch
    if (target < currentUnits + this.time.progress) return this.scene()
    const targetUnits = Math.floor(target)
    while ((this.time.phase < 3 ? this.time.phase : 3 + this.time.epoch) < targetUnits) this.setProgress(1)
    return this.setProgress(target - targetUnits)
  }

  scene(): GrowthScene {
    if (this.time.phase < 3) {
      const skeleton = generateSkeleton(this.legacy(this.time.phase, this.time.progress))
      const crown = generateCrown(skeleton, this.legacy(this.time.phase, this.time.progress))
      const branches = [...skeleton.branches, ...crown.microBranches].filter(({ visibility }) => visibility > 0)
      return { skeleton, crown, bounds: boundsOf(branches) }
    }
    this.ensureActive()
    const activeBranches = this.active?.segments ?? []
    const activeVisible = [...activeBranches, ...this.activeCrown.microBranches]
      .filter(({ visibility }) => visibility > 0).map((branch) => ({
      ...branch,
      x2: branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
      y2: branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
    }))
    const activeRegions = this.activeCrown.regions.filter(({ visibility }) => visibility > 0)
    const activeBounds = mergeBounds(boundsOf(activeVisible), boundsOfRegions(activeRegions))
    const activeChunk: PlantChunk | null = this.active ? {
      id: -1,
      epochStart: this.time.epoch,
      epochEnd: this.time.epoch,
      originX: this.active.segments[0]?.x1 ?? 0,
      originY: this.active.segments[0]?.y1 ?? 0,
      bounds: activeBounds,
      branches: activeBranches,
      microBranches: this.activeCrown.microBranches,
      regions: this.activeCrown.regions,
    } : null
    const maturity = this.time.epoch === 0 ? 0.45 + smoothstep(this.time.progress) * 0.55 : 1
    if (this.time.epoch === 0) {
      for (const region of this.crown.regions) {
        region.visibility = maturity
        for (const leaf of region.leaves) leaf.opacity = leaf.priority <= maturity ? maturity : 0
      }
    }
    const skeleton: PlantSkeleton = {
      root: { x: 0, y: 0 },
      branches: this.completed,
      chunks: this.chunks,
      activeChunk,
      foliageAnchors: [...(this.active?.anchors ?? [])],
      growthScale: 0.3 + 0.7 * ((3 + clamp(this.time.epoch + this.time.progress)) / 4) ** 0.65,
      time: { ...this.time },
      supportByBranch: this.support,
      activeSupportByBranch: this.activeSupport,
      stats: { generatedEpochs: 0, activeSegments: activeBranches.length, visitedHistoricalSegments: 0 },
    }
    return {
      skeleton,
      crown: this.presentCrown,
      bounds: mergeBounds(
        mergeBounds(this.completedBounds, activeBounds),
        mergeBounds(this.completedCrownBounds, boundsOfRegions(activeRegions)),
      ),
    }
  }

  createCheckpoint(): GrowthCheckpointV1 {
    return {
      version: 1,
      morphology: { ...this.morphology },
      appearance: { ...this.appearance },
      time: { ...this.time },
      completed: this.completed.map((segment) => ({ ...segment })),
      frontier: structuredClone(this.frontier),
      nextId: this.nextId,
      nextBranchId: this.nextBranchId,
      support: [...this.support],
      crown: structuredClone(this.crown),
    }
  }

  static restore(checkpoint: GrowthCheckpointV1) {
    if (checkpoint.version !== 1) throw new Error(`Unsupported growth checkpoint version: ${String(checkpoint.version)}`)
    const engine = new TreeGrowthEngine({ ...checkpoint.morphology, ...checkpoint.appearance, progress: 0 })
    engine.time = { ...checkpoint.time }
    engine.completed = checkpoint.completed.map((segment) => ({ ...segment }))
    engine.frontier = structuredClone(checkpoint.frontier) as EngineBud[]
    engine.nextId = checkpoint.nextId
    engine.nextBranchId = checkpoint.nextBranchId
    engine.support = new Map(checkpoint.support)
    engine.crown = structuredClone(checkpoint.crown)
    engine.presentCrown = engine.crown
    engine.completedBounds = boundsOf(engine.completed)
    engine.completedCrownBounds = boundsOfRegions(engine.crown.regions)
    const baseRegions = engine.crown.regions.filter((region) => region.leaves[0]?.birthEpoch < 0)
    engine.chunks = [{
      id: 0,
      epochStart: -3,
      epochEnd: -1,
      originX: 0,
      originY: 0,
      bounds: mergeBounds(boundsOf(engine.completed.filter(({ birthEpoch }) => birthEpoch < 0)), boundsOfRegions(baseRegions)),
      branches: engine.completed.filter(({ birthEpoch }) => birthEpoch < 0),
      microBranches: engine.crown.microBranches.filter(({ birthEpoch }) => birthEpoch < 0),
      regions: baseRegions,
    }]
    for (let start = 0; start < engine.time.epoch; start += 32) {
      const branches = engine.completed.filter(({ birthEpoch }) => birthEpoch >= start && birthEpoch < start + 32)
      if (branches.length > 0) {
        const regions = engine.crown.regions.filter((region) => {
          const epoch = region.leaves[0]?.birthEpoch ?? -1
          return epoch >= start && epoch < start + 32
        })
        engine.chunks.push({
          id: Math.floor(start / 32) + 1,
          epochStart: start,
          epochEnd: Math.min(engine.time.epoch - 1, start + 31),
          originX: branches[0].x1,
          originY: branches[0].y1,
          bounds: mergeBounds(boundsOf(branches), boundsOfRegions(regions)),
          branches,
          microBranches: engine.crown.microBranches.filter(({ birthEpoch }) => birthEpoch >= start && birthEpoch < start + 32),
          regions,
        })
      }
    }
    engine.active = null
    engine.activeCrown = {
      microBranches: [], regions: [], activeMicroBranches: [], activeRegions: [], ambientParticles: [], density: engine.appearance.density,
    }
    engine.presentCrown = engine.crown
    engine.ensureActive()
    engine.updateActive(engine.time.progress)
    return engine
  }
}
