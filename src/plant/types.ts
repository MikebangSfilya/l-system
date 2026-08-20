export type PlantPhase = 0 | 1 | 2 | 3

export type PlantConfig = {
  phase: PlantPhase
  phaseProgress: number
  branching: number
  density: number
  curvature: number
  vitality: number
  seed: number
}

export type BranchSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  depth: number
  visibility: number
  tone: number
}

export type Leaf = {
  x: number
  y: number
  angle: number
  size: number
  vitality: number
}

export type FoliageAnchor = {
  id: number
  x: number
  y: number
  angle: number
  terminal: boolean
  visibility: number
}

export type FoliageCluster = {
  x: number
  y: number
  leaves: Leaf[]
}

export type PlantSkeleton = {
  root: { x: number; y: number }
  branches: BranchSegment[]
  foliageAnchors: FoliageAnchor[]
  growthScale: number
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export type ViewTransform = {
  rootX: number
  rootY: number
  scale: number
}
