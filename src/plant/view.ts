import type { Bounds, BranchSegment, PlantSkeleton, ViewTransform } from './types.ts'

export function computeBounds(segments: BranchSegment[]): Bounds {
  return segments.reduce(
    (bounds, segment) => ({
      minX: Math.min(bounds.minX, segment.x1, segment.x2),
      minY: Math.min(bounds.minY, segment.y1, segment.y2),
      maxX: Math.max(bounds.maxX, segment.x1, segment.x2),
      maxY: Math.max(bounds.maxY, segment.y1, segment.y2),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  )
}

export function computeViewTransform(
  bounds: Bounds,
  root: PlantSkeleton['root'],
  canvasSize: { width: number; height: number },
  padding: number,
): ViewTransform {
  const paddingX = canvasSize.width * padding
  const paddingY = canvasSize.height * padding
  const horizontalExtent = Math.max(root.x - bounds.minX, bounds.maxX - root.x, Number.EPSILON)
  const height = Math.max(bounds.maxY - root.y, Number.EPSILON)

  return {
    rootX: canvasSize.width / 2,
    rootY: canvasSize.height - paddingY,
    scale: Math.min(
      (canvasSize.width - paddingX * 2) / (horizontalExtent * 2),
      (canvasSize.height - paddingY * 2) / height,
    ),
  }
}
