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
  depthVisual: number
  visibility: number
  tone: number
}

export type Leaf = {
  x: number
  y: number
  angle: number
  size: number
  vitality: number
  depthVisual: number
}

export type FoliageAnchor = {
  id: number
  x: number
  y: number
  angle: number
  terminal: boolean
  depth: number
  depthVisual: number
  visibility: number
}

export type CrownRegion = {
  anchorId: number
  x: number
  y: number
  radiusX: number
  radiusY: number
  depthVisual: number
  visibility: number
  tone: number
  vitality: number
  leaves: Leaf[]
}

export type AmbientParticle = {
  x: number
  y: number
  size: number
  alpha: number
  depthVisual: number
}

export type PlantCrown = {
  microBranches: BranchSegment[]
  regions: CrownRegion[]
  ambientParticles: AmbientParticle[]
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
