import type { Bounds, BranchSegment, CrownRegion, PlantSkeleton, ViewTransform } from './types.ts'

export function computeBounds(segments: BranchSegment[], regions: CrownRegion[] = []): Bounds {
  const branchBounds = segments.reduce(
    (bounds, segment) => ({
      minX: Math.min(bounds.minX, segment.x1, segment.x2),
      minY: Math.min(bounds.minY, segment.y1, segment.y2),
      maxX: Math.max(bounds.maxX, segment.x1, segment.x2),
      maxY: Math.max(bounds.maxY, segment.y1, segment.y2),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  )
  return regions.reduce((bounds, region) => ({
    minX: Math.min(bounds.minX, region.x - region.radiusX),
    minY: Math.min(bounds.minY, region.y - region.radiusY),
    maxX: Math.max(bounds.maxX, region.x + region.radiusX),
    maxY: Math.max(bounds.maxY, region.y + region.radiusY),
  }), branchBounds)
}

export function computeViewTransform(
  bounds: Bounds,
  root: PlantSkeleton['root'],
  viewportSize: { width: number; height: number },
  padding: number,
): ViewTransform {
  const paddingX = viewportSize.width * padding
  const paddingY = viewportSize.height * padding
  const horizontalExtent = Math.max(root.x - bounds.minX, bounds.maxX - root.x, Number.EPSILON)
  const height = Math.max(bounds.maxY - root.y, Number.EPSILON)

  return {
    rootX: viewportSize.width / 2,
    rootY: viewportSize.height - paddingY,
    scale: Math.min(
      (viewportSize.width - paddingX * 2) / (horizontalExtent * 2),
      (viewportSize.height - paddingY * 2) / height,
    ),
  }
}
