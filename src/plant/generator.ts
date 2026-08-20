import LSystem from 'lindenmayer'
import type { BranchSegment, Leaf, PlantConfig, PlantGeometry } from './types.ts'

const ITERATIONS = 6

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

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
  const twigChance = clamp(config.density) * (0.08 + branching * 0.48)

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

type Turtle = { x: number; y: number; angle: number; path: number; depth: number }
type RawSegment = Omit<BranchSegment, 'visibility'> & { rank: number; depth: number }
type LeafCandidate = Leaf & { rank: number; depth: number }

export function generatePlant(input: PlantConfig): PlantGeometry {
  const config = {
    ...input,
    growth: clamp(input.growth),
    branching: clamp(input.branching),
    density: clamp(input.density),
    curvature: clamp(input.curvature),
    vitality: clamp(input.vitality),
  }
  const word = makeWord(config)
  const next = random(config.seed ^ 0x85ebca6b)
  const leafNext = random(config.seed ^ 0xc2b2ae35)
  const turn = (18 + config.branching * 22) * (Math.PI / 180)
  const turtle: Turtle = { x: 0, y: 0, angle: Math.PI / 2, path: 0, depth: 0 }
  const stack: Turtle[] = []
  const raw: RawSegment[] = []
  const leafCandidates: LeafCandidate[] = []
  let maxRank = 1

  for (const symbol of word) {
    if (symbol === 'F') {
      turtle.angle += (next() - 0.5) * config.curvature * 0.16
      const depthLength = turtle.depth === 0
        ? 1.18
        : (0.92 + config.branching * 0.22) * 0.93 ** (turtle.depth - 1)
      const length = (1 + next() * 0.26) * depthLength
      const x = turtle.x + Math.cos(turtle.angle) * length
      const y = turtle.y + Math.sin(turtle.angle) * length
      const rank = ++turtle.path + turtle.depth * 8
      maxRank = Math.max(maxRank, rank)
      raw.push({
        x1: turtle.x,
        y1: turtle.y,
        x2: x,
        y2: y,
        rank,
        depth: turtle.depth,
        width: Math.max(0.16, 2.8 * Math.max(0.45, 1 - turtle.path * 0.004) * 0.58 ** turtle.depth),
        tone: next(),
      })
      turtle.x = x
      turtle.y = y

      const leafChance = config.density * (0.12 + config.vitality * 0.76)
      const leafSlots = 1 + Number(leafNext() < config.density * 0.75)
      for (let slot = 0; turtle.depth > 0 && slot < leafSlots; slot += 1) {
        if (leafNext() < leafChance) {
          leafCandidates.push({
            x: x + (leafNext() - 0.5) * 0.58,
            y: y + (leafNext() - 0.5) * 0.42,
            angle: turtle.angle + (leafNext() - 0.5) * 1.6,
            size: (0.34 + leafNext() * 0.34) * (0.7 + config.vitality * 0.4),
            vitality: config.vitality,
            rank,
            depth: turtle.depth,
          })
        }
      }
    } else if (symbol === '+') {
      turtle.angle += turn + (next() - 0.5) * (0.08 + config.curvature * 0.2)
    } else if (symbol === '-') {
      turtle.angle -= turn + (next() - 0.5) * (0.08 + config.curvature * 0.2)
    } else if (symbol === '[') {
      stack.push({ ...turtle })
      turtle.depth += 1
    } else if (symbol === ']') {
      Object.assign(turtle, stack.pop()!)
    }
  }

  const sizeGrowth = 0.45 + 0.55 * config.growth ** 0.65
  const widthGrowth = 0.45 + 0.55 * config.growth ** 0.7
  const progress = config.growth ** 1.35 * maxRank
  const maxDepth = Math.min(ITERATIONS, 1 + Math.floor(config.growth * 5))
  const branches = raw
    .filter((segment) => segment.depth <= maxDepth)
    .map(({ rank, depth: _depth, ...segment }) => ({
      ...segment,
      x1: segment.x1 * sizeGrowth,
      y1: segment.y1 * sizeGrowth,
      x2: segment.x2 * sizeGrowth,
      y2: segment.y2 * sizeGrowth,
      width: segment.width * widthGrowth,
      visibility: clamp(progress - rank + 1),
    }))
    .filter((segment) => segment.visibility > 0)
  const leaves = leafCandidates
    .filter((leaf) => progress >= leaf.rank && leaf.depth <= maxDepth)
    .map(({ rank: _rank, depth: _depth, ...leaf }) => ({
      ...leaf,
      x: leaf.x * sizeGrowth,
      y: leaf.y * sizeGrowth,
      size: leaf.size * sizeGrowth,
    }))

  const bounds = raw.reduce(
    (box, branch) => ({
      minX: Math.min(box.minX, branch.x1, branch.x2),
      minY: Math.min(box.minY, branch.y1, branch.y2),
      maxX: Math.max(box.maxX, branch.x1, branch.x2),
      maxY: Math.max(box.maxY, branch.y1, branch.y2),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 1 },
  )

  return { branches, leaves, bounds }
}
