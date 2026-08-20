import LSystem from 'lindenmayer'
import type { BranchLevel, BranchSegment, PlantConfig, PlantCrown, PlantPhase, PlantSkeleton } from './types.ts'

const ITERATIONS = 6
const MICRO_TWIGS = 5
const REGION_PARTICLES = 28
const AMBIENT_PARTICLES = 18

const clamp = (value: number, min = 0, max = 1) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
const smoothstep = (value: number) => value * value * (3 - 2 * value)
const levelOf = (depth: number) => Math.min(depth, 4) as BranchLevel
const CURVATURE_BY_LEVEL = [0.12, 0.45, 0.8, 1.2, 1.5] as const
const LENGTH_BY_LEVEL = [1.45, 1, 0.72, 0.58, 0.34] as const
const WIDTH_BY_LEVEL = [3, 1.55, 0.8, 0.4, 0.2] as const
const TAPER_BY_LEVEL = [0.5, 0.5, 0.45, 0.4, 0.35] as const
const WIDTH_GROWTH_BY_LEVEL = [0.7, 0.5, 0.3, 0.18, 0.08] as const

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

function makeWord(config: PlantConfig) {
  const next = random(config.seed ^ 0x9e3779b9)
  const branching = clamp(config.branching)
  const branchChance = 0.06 + branching * 0.88
  const twigChance = branching * 0.16

  const system = new LSystem({
    axiom: 'X',
    productions: {
      F: 'FF',
      X: () => {
        let result = 'F'
        if (next() < branchChance) result += '[+X]'
        if (next() < branchChance) result += '[-X]'
        if (next() < twigChance) result += next() < 0.5 ? '[++X]' : '[--X]'
        return `${result}FX`
      },
    },
  })

  return system.iterate(ITERATIONS)
}

function countBranchSegments(word: string) {
  const counts = [0]
  const stack: number[] = []
  let branchId = 0
  let nextBranchId = 1

  for (const symbol of word) {
    if (symbol === 'F') counts[branchId] += 1
    else if (symbol === '[') {
      stack.push(branchId)
      branchId = nextBranchId
      counts[branchId] = 0
      nextBranchId += 1
    } else if (symbol === ']') branchId = stack.pop()!
  }

  return counts
}

function branchTraits(seed: number, branchId: number, level: BranchLevel, curvature: number) {
  const next = random(seed ^ 0x51ed270b ^ Math.imul(branchId + 1, 0x7feb352d))
  return {
    bendDirection: (next() < 0.5 ? -1 : 1) as -1 | 1,
    bendStrength: curvature * 0.32 * CURVATURE_BY_LEVEL[level] * (0.72 + next() * 0.28),
    angleVariation: (next() - 0.5) * (0.06 + curvature * 0.08),
    lengthScale: 0.92 + next() * 0.16,
  }
}

type Turtle = {
  x: number
  y: number
  angle: number
  depth: number
  age: number
  parentId: number | null
  densityThreshold: number
  branchId: number
  branchStep: number
  baseDirection: number
  bendStrength: number
  bendDirection: -1 | 1
  angleVariation: number
  lengthScale: number
  crownProgress: number
}
type RawSegment = Omit<BranchSegment, 'visibility'> & {
  rank: number
  densityThreshold: number
}

const PHASE_SCHEDULE = [
  [-0.06, 0.94, 0.08],
  [0.94, 0.82, 0.3],
  [2, 0.58, 0.22],
  [2.18, 0.62, 0.22],
  [3, 0.45, 0.22],
] as const

const verticalDifference = (angle: number) => Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))

function shapeAngle(angle: number, depth: number) {
  const attraction = [0.03, 0.008, 0.004][depth] ?? 0.001
  const limit = ([12, 58, 68][depth] ?? 82) * Math.PI / 180
  return Math.PI / 2 + clamp(verticalDifference(angle) * (1 - attraction), -limit, limit)
}

export function generateSkeleton(input: PlantConfig): PlantSkeleton {
  const config = {
    ...input,
    phase: Math.trunc(clamp(input.phase, 0, 3)) as PlantPhase,
    phaseProgress: clamp(input.phaseProgress),
    branching: clamp(input.branching),
    density: clamp(input.density),
    curvature: clamp(input.curvature),
    vitality: clamp(input.vitality),
  }
  const word = makeWord(config)
  const branchLengths = countBranchSegments(word)
  const next = random(config.seed ^ 0x85ebca6b)
  const detailNext = random(config.seed ^ 0x165667b1)
  const lean = (random(config.seed ^ 0x27d4eb2f)() - 0.5) * 10 * Math.PI / 180
  const turn = (28 + config.branching * 28) * (Math.PI / 180)
  const trunkTraits = branchTraits(config.seed, 0, 0, config.curvature)
  const turtle: Turtle = {
    x: 0,
    y: 0,
    angle: Math.PI / 2 + lean,
    depth: 0,
    age: 0,
    parentId: null,
    densityThreshold: 0,
    branchId: 0,
    branchStep: 0,
    baseDirection: Math.PI / 2 + lean,
    crownProgress: 0,
    ...trunkTraits,
  }
  const stack: Turtle[] = []
  const raw: RawSegment[] = []
  let nextBranchId = 1

  for (const symbol of word) {
    if (symbol === 'F') {
      const level = levelOf(turtle.depth)
      const branchProgress = (turtle.branchStep + 1) / branchLengths[turtle.branchId]
      turtle.angle = shapeAngle(
        turtle.baseDirection + turtle.bendDirection * turtle.bendStrength * smoothstep(branchProgress),
        turtle.depth,
      )
      const verticalLength = turtle.depth === 1 || turtle.depth === 2
        ? 0.72 + Math.abs(Math.sin(turtle.angle)) * 0.28
        : 1
      const crownScale = level === 0
        ? 1
        : level === 1
          ? clamp((turtle.crownProgress - 0.22) * 2.7, 0.08, 1.45)
          : 0.18 + 1.15 * smoothstep(turtle.crownProgress)
      const length = (0.94 + next() * 0.12) * LENGTH_BY_LEVEL[level] * crownScale * turtle.lengthScale * verticalLength
      const x = turtle.x + Math.cos(turtle.angle) * length
      const y = turtle.y + Math.sin(turtle.angle) * length
      const duration = 0.0015 + turtle.depth ** 2 * 0.0065
      turtle.age += duration
      const rank = turtle.age
      const id = raw.length
      raw.push({
        id,
        parentId: turtle.parentId,
        branchId: turtle.branchId,
        branchProgress,
        x1: turtle.x,
        y1: turtle.y,
        x2: x,
        y2: y,
        rank,
        depth: turtle.depth,
        level,
        baseDirection: turtle.baseDirection,
        bendStrength: turtle.bendStrength,
        bendDirection: turtle.bendDirection,
        depthVisual: random(config.seed ^ Math.imul(id + 1, 0x7feb352d))(),
        densityThreshold: turtle.densityThreshold,
        width: WIDTH_BY_LEVEL[level] * (1 - TAPER_BY_LEVEL[level] * smoothstep(branchProgress)),
        tone: next(),
      })
      turtle.x = x
      turtle.y = y
      turtle.parentId = id
      turtle.branchStep += 1
    } else if (symbol === '+') {
      turtle.baseDirection += turn + turtle.angleVariation
      turtle.angle = turtle.baseDirection
    } else if (symbol === '-') {
      turtle.baseDirection -= turn + turtle.angleVariation
      turtle.angle = turtle.baseDirection
    } else if (symbol === '[') {
      stack.push({ ...turtle })
      const depth = turtle.depth + 1
      const branchId = nextBranchId
      const parentProgress = turtle.branchStep / branchLengths[turtle.branchId]
      nextBranchId += 1
      Object.assign(turtle, {
        depth,
        age: turtle.age + 0.006 + depth * 0.004,
        densityThreshold: depth >= 2 ? Math.max(turtle.densityThreshold, detailNext()) : turtle.densityThreshold,
        branchId,
        branchStep: 0,
        crownProgress: depth === 1 ? parentProgress : turtle.crownProgress,
        baseDirection: turtle.angle,
        ...branchTraits(config.seed, branchId, levelOf(depth), config.curvature),
      })
    } else if (symbol === ']') {
      Object.assign(turtle, stack.pop()!)
    }
  }

  const stage = config.phase + config.phaseProgress
  const lifeProgress = stage / 4
  const growthScale = 0.3 + 0.7 * lifeProgress ** 0.65
  const rankRanges = new Map<number, { min: number; max: number }>()
  for (const segment of raw) {
    const range = rankRanges.get(segment.depth)
    rankRanges.set(segment.depth, range
      ? { min: Math.min(range.min, segment.rank), max: Math.max(range.max, segment.rank) }
      : { min: segment.rank, max: segment.rank })
  }
  const branchesWithIds = raw.map((segment) => ({
    ...segment,
    width: (() => {
      const birth = Math.max(0, PHASE_SCHEDULE[segment.level][0])
      const age = clamp((stage - birth) / (4 - birth))
      return segment.width * (0.55 + age * WIDTH_GROWTH_BY_LEVEL[segment.level])
    })(),
    visibility: (() => {
      if (segment.depth >= 2 && segment.densityThreshold > 0.25 + config.density * 0.75) return 0
      const range = rankRanges.get(segment.depth)!
      const order = range.max === range.min ? 0 : (segment.rank - range.min) / (range.max - range.min)
      const [start, spread, duration] = PHASE_SCHEDULE[segment.depth] ?? [3.15, 0.62, 0.2]
      return clamp((stage - start - order * spread) / duration)
    })(),
  }))
  const parentsWithChildren = new Set(branchesWithIds.flatMap((segment) =>
    segment.parentId === null ? [] : [segment.parentId]
  ))
  const branchesById = new Map(branchesWithIds.map((segment) => [segment.id, segment]))
  const parentsWithSameDepthChildren = new Set(branchesWithIds.flatMap((segment) => {
    const parent = segment.parentId === null ? undefined : branchesById.get(segment.parentId)
    return parent?.depth === segment.depth ? [parent.id] : []
  }))
  const anchorSegments = new Map<number, { terminal: boolean }>()

  for (const segment of branchesWithIds) {
    if (segment.depth === 0 || parentsWithSameDepthChildren.has(segment.id)) continue
    anchorSegments.set(segment.id, { terminal: !parentsWithChildren.has(segment.id) })
    const parent = segment.parentId === null ? undefined : branchesById.get(segment.parentId)
    if (parent && parent.depth > 0 && !anchorSegments.has(parent.id)) {
      anchorSegments.set(parent.id, { terminal: false })
    }
  }

  const foliageAnchors = [...anchorSegments]
    .sort(([left], [right]) => left - right)
    .map(([id, { terminal }]) => {
      const segment = branchesById.get(id)!
      return {
        id,
        x: segment.x2,
        y: segment.y2,
        angle: Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1),
        terminal,
        depth: segment.depth,
        level: segment.level,
        depthVisual: segment.depthVisual,
        visibility: segment.visibility,
      }
    })
  const branches = branchesWithIds.map(({ rank: _rank, densityThreshold: _densityThreshold, ...segment }) => segment)

  return { root: { x: 0, y: 0 }, branches, foliageAnchors, growthScale }
}

export function generateCrown(skeleton: PlantSkeleton, input: PlantConfig): PlantCrown {
  const density = clamp(input.density)
  const vitality = clamp(input.vitality)
  const curvature = clamp(input.curvature)
  const phase = Math.trunc(clamp(input.phase, 0, 3))
  const progress = clamp(input.phaseProgress)
  const smoothProgress = progress * progress * (3 - 2 * progress)
  const maturity = phase < 2 ? 0 : phase === 2 ? smoothProgress * 0.45 : 0.45 + smoothProgress * 0.55
  const microProgress = phase === 3 ? smoothProgress : 0
  const terminalAnchors = skeleton.foliageAnchors.filter((anchor) => anchor.terminal)
  const microBranches: BranchSegment[] = []
  const regions: PlantCrown['regions'] = []
  const firstMicroBranchId = Math.max(...skeleton.branches.map((branch) => branch.branchId)) + 1

  for (const [anchorIndex, anchor] of terminalAnchors.entries()) {
    const next = random(input.seed ^ 0xc2b2ae35 ^ Math.imul(anchor.id + 1, 0x27d4eb2d))
    const radiusX = 4.8 + next() * 3.2
    const radiusY = 3.5 + next() * 2.3
    const depthVisual = clamp(anchor.depthVisual * 0.65 + next() * 0.35)
    const leaves = Array.from({ length: REGION_PARTICLES }, () => {
      const threshold = next()
      const direction = next() * Math.PI * 2
      const distance = Math.sqrt(next())
      return {
        threshold,
        x: Math.cos(direction) * distance * radiusX,
        y: Math.sin(direction) * distance * radiusY,
        angle: anchor.angle + (next() - 0.5) * 1.8,
        size: 0.45 + next() * 0.5,
        vitality,
        depthVisual: clamp(depthVisual + (next() - 0.5) * 0.35),
      }
    }).filter((leaf) => leaf.threshold <= density * maturity * anchor.visibility * (0.25 + vitality * 0.75))
      .map(({ threshold: _threshold, ...leaf }) => leaf)

    regions.push({
      anchorId: anchor.id,
      x: anchor.x + Math.cos(anchor.angle) * radiusX * 0.12,
      y: anchor.y + Math.sin(anchor.angle) * radiusY * 0.12,
      radiusX,
      radiusY,
      depthVisual,
      visibility: anchor.visibility * density * maturity * (0.35 + vitality * 0.65),
      tone: next(),
      vitality,
      leaves,
    })

    for (let twig = 0; twig < MICRO_TWIGS; twig += 1) {
      const threshold = next()
      const branchId = firstMicroBranchId + anchorIndex * MICRO_TWIGS + twig
      const traits = branchTraits(input.seed, branchId, 4, curvature)
      const fan = (twig / (MICRO_TWIGS - 1) - 0.5) * 1.25
      const baseDirection = anchor.angle + fan + traits.angleVariation
      const angle1 = baseDirection + traits.bendDirection * traits.bendStrength * smoothstep(0.5)
      const angle2 = baseDirection + traits.bendDirection * traits.bendStrength
      const length1 = (0.22 + next() * 0.18) * traits.lengthScale
      const length2 = length1 * (0.48 + next() * 0.2)
      const x2 = anchor.x + Math.cos(angle1) * length1
      const y2 = anchor.y + Math.sin(angle1) * length1
      const x3 = x2 + Math.cos(angle2) * length2
      const y3 = y2 + Math.sin(angle2) * length2
      const start = 0.04 + threshold * 0.58
      const enabled = threshold <= density ? anchor.visibility : 0
      const twigDepth = clamp(depthVisual + (next() - 0.5) * 0.3)
      const width = (0.14 + next() * 0.05) * (0.85 + microProgress * 0.15)
      const tone = next()
      const id = skeleton.branches.length + microBranches.length
      microBranches.push(
        {
          id,
          parentId: anchor.id,
          branchId,
          branchProgress: 0.5,
          x1: anchor.x,
          y1: anchor.y,
          x2,
          y2,
          width: width * (1 - TAPER_BY_LEVEL[4] * smoothstep(0.5)),
          depth: anchor.depth + 1,
          level: 4,
          baseDirection,
          bendStrength: traits.bendStrength,
          bendDirection: traits.bendDirection,
          depthVisual: twigDepth,
          visibility: enabled * clamp((microProgress - start) / 0.18),
          tone,
        },
        {
          id: id + 1,
          parentId: id,
          branchId,
          branchProgress: 1,
          x1: x2,
          y1: y2,
          x2: x3,
          y2: y3,
          width: width * (1 - TAPER_BY_LEVEL[4]),
          depth: anchor.depth + 2,
          level: 4,
          baseDirection,
          bendStrength: traits.bendStrength,
          bendDirection: traits.bendDirection,
          depthVisual: twigDepth,
          visibility: enabled * clamp((microProgress - start - 0.12) / 0.2),
          tone,
        },
      )
    }
  }

  const ambientNext = random(input.seed ^ 0x94d049bb)
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

  return { microBranches, regions, ambientParticles }
}
