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

export type PlantGeometry = {
  branches: BranchSegment[]
  leaves: Leaf[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
