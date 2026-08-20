export type PlantConfig = {
  growth: number
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
}

export type FoliageCluster = {
  x: number
  y: number
  leaves: Leaf[]
}

export type PlantSkeleton = {
  branches: BranchSegment[]
  foliageAnchors: FoliageAnchor[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
