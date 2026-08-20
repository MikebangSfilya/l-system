import LSystem from 'lindenmayer'
import type { BranchSegment, FoliageCluster, PlantConfig, PlantPhase, PlantSkeleton } from './types.ts'

const ITERATIONS = 6

const clamp = (value: number, min = 0, max = 1) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

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

type Turtle = {
  x: number
  y: number
  angle: number
  path: number
  depth: number
  age: number
  parent: number | null
  densityThreshold: number
}
type RawSegment = Omit<BranchSegment, 'visibility'> & {
  id: number
  parent: number | null
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
  const next = random(config.seed ^ 0x85ebca6b)
  const detailNext = random(config.seed ^ 0x165667b1)
  const lean = (random(config.seed ^ 0x27d4eb2f)() - 0.5) * 10 * Math.PI / 180
  const turn = (28 + config.branching * 28) * (Math.PI / 180)
  const turtle: Turtle = {
    x: 0,
    y: 0,
    angle: Math.PI / 2 + lean,
    path: 0,
    depth: 0,
    age: 0,
    parent: null,
    densityThreshold: 0,
  }
  const stack: Turtle[] = []
  const raw: RawSegment[] = []

  for (const symbol of word) {
    if (symbol === 'F') {
      const curvatureScale = [0.28, 0.45, 0.65][turtle.depth] ?? 1
      turtle.angle = shapeAngle(
        turtle.angle + (next() - 0.5) * config.curvature * 0.16 * curvatureScale,
        turtle.depth,
      )
      const depthLength = turtle.depth === 0
        ? 1.18
        : (1.6 + config.branching * 0.65) * 0.78 ** (turtle.depth - 1)
      const verticalLength = turtle.depth === 1 || turtle.depth === 2
        ? 0.72 + Math.abs(Math.sin(turtle.angle)) * 0.28
        : 1
      const length = (1 + next() * 0.26) * depthLength * verticalLength
      const x = turtle.x + Math.cos(turtle.angle) * length
      const y = turtle.y + Math.sin(turtle.angle) * length
      const duration = 0.0015 + turtle.depth ** 2 * 0.0065
      turtle.age += duration
      const rank = turtle.age
      const id = raw.length
      turtle.path += 1
      raw.push({
        id,
        parent: turtle.parent,
        x1: turtle.x,
        y1: turtle.y,
        x2: x,
        y2: y,
        rank,
        depth: turtle.depth,
        densityThreshold: turtle.densityThreshold,
        width: Math.max(0.16, 2.8 * Math.max(0.45, 1 - turtle.path * 0.004) * 0.58 ** turtle.depth),
        tone: next(),
      })
      turtle.x = x
      turtle.y = y
      turtle.parent = id
    } else if (symbol === '+') {
      turtle.angle += turn + (next() - 0.5) * (0.08 + config.curvature * 0.2)
    } else if (symbol === '-') {
      turtle.angle -= turn + (next() - 0.5) * (0.08 + config.curvature * 0.2)
    } else if (symbol === '[') {
      stack.push({ ...turtle })
      turtle.depth += 1
      if (turtle.depth >= 2) turtle.densityThreshold = Math.max(turtle.densityThreshold, detailNext())
      turtle.age += 0.006 + turtle.depth * 0.004
    } else if (symbol === ']') {
      Object.assign(turtle, stack.pop()!)
    }
  }

  const stage = config.phase + config.phaseProgress
  const lifeProgress = stage / 4
  const growthScale = 0.3 + 0.7 * lifeProgress ** 0.65
  const thickness = 0.55 + 0.45 * lifeProgress ** 0.8
  const rankRanges = new Map<number, { min: number; max: number }>()
  for (const segment of raw) {
    const range = rankRanges.get(segment.depth)
    rankRanges.set(segment.depth, range
      ? { min: Math.min(range.min, segment.rank), max: Math.max(range.max, segment.rank) }
      : { min: segment.rank, max: segment.rank })
  }
  const branchesWithIds = raw.map((segment) => ({
    ...segment,
    width: segment.width * thickness,
    visibility: (() => {
      if (segment.depth >= 2 && segment.densityThreshold > 0.25 + config.density * 0.75) return 0
      const range = rankRanges.get(segment.depth)!
      const order = range.max === range.min ? 0 : (segment.rank - range.min) / (range.max - range.min)
      const [start, spread, duration] = PHASE_SCHEDULE[segment.depth] ?? [3.15, 0.62, 0.2]
      return clamp((stage - start - order * spread) / duration)
    })(),
  }))
  const parentsWithChildren = new Set(branchesWithIds.flatMap((segment) =>
    segment.parent === null ? [] : [segment.parent]
  ))
  const branchesById = new Map(branchesWithIds.map((segment) => [segment.id, segment]))
  const parentsWithSameDepthChildren = new Set(branchesWithIds.flatMap((segment) => {
    const parent = segment.parent === null ? undefined : branchesById.get(segment.parent)
    return parent?.depth === segment.depth ? [parent.id] : []
  }))
  const anchorSegments = new Map<number, { terminal: boolean }>()

  for (const segment of branchesWithIds) {
    if (segment.depth === 0 || parentsWithSameDepthChildren.has(segment.id)) continue
    anchorSegments.set(segment.id, { terminal: !parentsWithChildren.has(segment.id) })
    const parent = segment.parent === null ? undefined : branchesById.get(segment.parent)
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
        visibility: segment.visibility,
      }
    })
  const branches = branchesWithIds.map(({ id: _id, parent: _parent, rank: _rank, densityThreshold: _densityThreshold, ...segment }) => segment)

  return { root: { x: 0, y: 0 }, branches, foliageAnchors, growthScale }
}

export function generateFoliage(skeleton: PlantSkeleton, input: PlantConfig): FoliageCluster[] {
  const density = clamp(input.density)
  const vitality = clamp(input.vitality)
  const phase = Math.trunc(clamp(input.phase, 0, 3))
  const progress = clamp(input.phaseProgress)
  const smoothProgress = progress * progress * (3 - 2 * progress)
  const maturity = phase < 2 ? 0 : phase === 2 ? smoothProgress * 0.55 : 0.55 + smoothProgress * 0.45
  if (density === 0 || maturity === 0) return []

  const clusters: FoliageCluster[] = []

  for (const anchor of skeleton.foliageAnchors) {
    const next = random(input.seed ^ 0xc2b2ae35 ^ Math.imul(anchor.id + 1, 0x27d4eb2d))
    const chance = density * maturity * anchor.visibility * (0.25 + 0.75 * vitality) * (anchor.terminal ? 1 : 0.55)
    if (next() >= chance) continue

    const count = 3 + Math.floor(next() * 2 + density * 2 + vitality * 2 + maturity * 2)
    const radius = (0.9 + density * 2.1) * (0.75 + maturity * 0.25)
    const leaves = Array.from({ length: count }, () => {
      const direction = next() * Math.PI * 2
      const distance = Math.sqrt(next()) * radius
      return {
        x: Math.cos(direction) * distance,
        y: Math.sin(direction) * distance,
        angle: anchor.angle + (next() - 0.5) * 1.8,
        size: (0.5 + next() * 0.35) * (0.78 + vitality * 0.22) * (0.78 + maturity * 0.22),
        vitality,
      }
    })
    clusters.push({ x: anchor.x, y: anchor.y, leaves })
  }

  return clusters
}
