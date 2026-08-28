import type { BranchSegment, CrownRegion, PlantSkeleton, ViewTransform } from './types.ts'

const MAJOR_AXIS_BUDGET = 4000
const DETAIL_AXIS_BUDGET = 2000
const MICRO_BRANCH_BUDGET = 2000
const REGION_BUDGET = 1000
const LEAF_BUDGET = 900

function screenPoint(x: number, y: number, plant: PlantSkeleton, transform: ViewTransform) {
  const scale = transform.scale * plant.growthScale
  return { x: transform.rootX + (x - plant.root.x) * scale, y: transform.rootY - (y - plant.root.y) * scale }
}

export function boundsOnScreen(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  plant: PlantSkeleton,
  transform: ViewTransform,
  width: number,
  height: number,
) {
  const left = screenPoint(bounds.minX, bounds.minY, plant, transform)
  const right = screenPoint(bounds.maxX, bounds.maxY, plant, transform)
  const margin = 24
  return Math.max(left.x, right.x) >= -margin && Math.min(left.x, right.x) <= width + margin
    && Math.max(left.y, right.y) >= -margin && Math.min(left.y, right.y) <= height + margin
}

export function branchOnScreen(
  branch: BranchSegment,
  plant: PlantSkeleton,
  transform: ViewTransform,
  width: number,
  height: number,
) {
  return boundsOnScreen({
    minX: Math.min(branch.x1, branch.x2),
    minY: Math.min(branch.y1, branch.y2),
    maxX: Math.max(branch.x1, branch.x2),
    maxY: Math.max(branch.y1, branch.y2),
  }, plant, transform, width, height)
}

function stableAxes(items: BranchSegment[], limit: number) {
  const axes = new Map<string, BranchSegment[]>()
  for (const item of items) {
    const axis = axes.get(item.branchPersistentId)
    if (axis) axis.push(item)
    else axes.set(item.branchPersistentId, [item])
  }
  return [...axes.values()]
    .sort((left, right) => left[0].birthEpoch - right[0].birthEpoch || left[0].id - right[0].id)
    .slice(0, limit).flat()
}

export function effectiveBranchWidth(branch: BranchSegment, plant: PlantSkeleton) {
  const support = (plant.supportByBranch.get(branch.branchPersistentId) ?? 0)
    + (plant.activeSupportByBranch.get(branch.branchPersistentId) ?? 0)
  const matureAge = plant.time.phase === 3 ? plant.time.epoch + plant.time.progress : 0
  const age = branch.birthEpoch < 0
    ? matureAge
    : Math.max(0, matureAge - branch.birthEpoch)
  const supportScale = 1 + Math.log2(1 + support) * (branch.level <= 1 ? 0.09 : 0.045)
  const ageScale = branch.level === 0
    ? Math.min(2.5, 1 + 0.08 * Math.log2(1 + age))
    : branch.level === 1 ? Math.min(1.7, 1 + 0.04 * Math.log2(1 + age)) : 1
  return branch.width * supportScale * ageScale * (0.55 + branch.visibility * 0.45)
}

export function selectRenderableBranches(
  plant: PlantSkeleton,
  transform: ViewTransform,
  width: number,
  height: number,
) {
  const screenScale = transform.scale * plant.growthScale
  const historical = plant.chunks
    .filter((chunk) => boundsOnScreen(chunk.bounds, plant, transform, width, height))
    .flatMap((chunk) => chunk.branches)
    .filter((branch) => branch.visibility > 0
      && branchOnScreen(branch, plant, transform, width, height)
      && (branch.level <= 2 || Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1) * screenScale >= 0.75))
  const active = (plant.activeChunk?.branches ?? []).filter((branch) => branch.visibility > 0
    && branchOnScreen(branch, plant, transform, width, height))
  const major = stableAxes(historical.filter(({ level }) => level <= 2), MAJOR_AXIS_BUDGET)
  const detail = stableAxes(historical.filter(({ level }) => level > 2), DETAIL_AXIS_BUDGET)
  return major.concat(detail, active)
}

export function selectRenderableRegions(
  candidates: CrownRegion[],
  plant: PlantSkeleton,
  transform: ViewTransform,
  width: number,
  height: number,
) {
  const scale = transform.scale * plant.growthScale
  return candidates.filter((region) => {
    if (region.visibility <= 0) return false
    const center = screenPoint(region.x, region.y, plant, transform)
    return center.x + region.radiusX * scale >= 0 && center.x - region.radiusX * scale <= width
      && center.y + region.radiusY * scale >= 0 && center.y - region.radiusY * scale <= height
  }).sort((left, right) => left.anchorId - right.anchorId).slice(0, REGION_BUDGET)
    .sort((left, right) => left.depthVisual - right.depthVisual)
}

export function selectRenderableMicroBranches(
  branches: BranchSegment[],
  plant: PlantSkeleton,
  transform: ViewTransform,
  width: number,
  height: number,
) {
  const screenScale = transform.scale * plant.growthScale
  return branches.filter((branch) => branch.visibility > 0
    && Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1) * screenScale >= 1
    && branchOnScreen(branch, plant, transform, width, height))
    .sort((left, right) => left.birthEpoch - right.birthEpoch || left.id - right.id).slice(0, MICRO_BRANCH_BUDGET)
}

export const leafBudget = LEAF_BUDGET
