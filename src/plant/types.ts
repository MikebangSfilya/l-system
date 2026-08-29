export type PlantPhase = 0 | 1 | 2 | 3
export type BranchLevel = 0 | 1 | 2 | 3 | 4
export type PersistentId = string

export type PlantMorphology = { branching: number; curvature: number; seed: number }
export type PlantAppearance = { density: number; vitality: number }
export type PlantConfig = PlantMorphology & PlantAppearance & { progress: number }

export type LegacyPlantConfig = PlantMorphology & PlantAppearance & {
  phase: PlantPhase
  phaseProgress: number
}

export type BranchSegment = {
  id: number
  persistentId: PersistentId
  parentId: number | null
  parentPersistentId: PersistentId | null
  branchId: number
  branchPersistentId: PersistentId
  branchProgress: number
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  depth: number
  level: BranchLevel
  baseDirection: number
  bendStrength: number
  bendDirection: -1 | 1
  depthVisual: number
  visibility: number
  tone: number
  priority: number
  birthEpoch: number
  birthProgress: number
  growthDuration: number
}

export type Leaf = {
  id: PersistentId
  x: number
  y: number
  angle: number
  size: number
  opacity: number
  vitality: number
  depthVisual: number
  priority: number
  birthEpoch: number
  birthProgress: number
  growthDuration: number
}

export type FoliageAnchor = {
  id: number
  persistentId: PersistentId
  x: number
  y: number
  angle: number
  terminal: boolean
  depth: number
  level: BranchLevel
  depthVisual: number
  visibility: number
  priority: number
  birthEpoch: number
  birthProgress: number
  growthDuration: number
}

export type CrownRegion = {
  id: PersistentId
  anchorId: number
  anchorPersistentId: PersistentId
  x: number
  y: number
  radiusX: number
  radiusY: number
  depthVisual: number
  visibility: number
  tone: number
  vitality: number
  priority: number
  leaves: Leaf[]
}

export type AmbientParticle = { x: number; y: number; size: number; alpha: number; depthVisual: number }
export type PlantCrown = {
  microBranches: BranchSegment[]
  regions: CrownRegion[]
  activeMicroBranches: BranchSegment[]
  activeRegions: CrownRegion[]
  ambientParticles: AmbientParticle[]
  density: number
}
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

export type PlantChunk = {
  id: number
  epochStart: number
  epochEnd: number
  originX: number
  originY: number
  bounds: Bounds
  branches: BranchSegment[]
  microBranches: BranchSegment[]
  regions: CrownRegion[]
}

export type GrowthTime = { phase: PlantPhase; epoch: number; progress: number }
export type GrowthStats = { generatedEpochs: number; activeSegments: number; visitedHistoricalSegments: number }

export type PlantSkeleton = {
  root: { x: number; y: number }
  branches: BranchSegment[]
  chunks: PlantChunk[]
  activeChunk: PlantChunk | null
  foliageAnchors: FoliageAnchor[]
  growthScale: number
  time: GrowthTime
  supportByBranch: ReadonlyMap<PersistentId, number>
  activeSupportByBranch: ReadonlyMap<PersistentId, number>
  stats: GrowthStats
}

export type GrowthCheckpointV1 = {
  version: 1
  crownVersion?: 10
  morphology: PlantMorphology
  appearance: PlantAppearance
  time: GrowthTime
  completed: BranchSegment[]
  frontier: unknown[]
  nextId: number
  nextBranchId: number
  support: Array<[PersistentId, number]>
  crown: PlantCrown
}

export type GrowthScene = { skeleton: PlantSkeleton; crown: PlantCrown; bounds: Bounds }
export type ViewTransform = { rootX: number; rootY: number; scale: number }
