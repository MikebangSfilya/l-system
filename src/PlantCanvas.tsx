import { useEffect, useRef } from 'react'
import { generateFoliage, generateSkeleton } from './plant/generator.ts'
import { renderPlant } from './plant/renderer.ts'
import { computeBounds, computeViewTransform } from './plant/view.ts'
import type { PlantConfig } from './plant/types.ts'

export function PlantCanvas({ config }: { config: PlantConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) {
      const skeleton = generateSkeleton(config)
      const foliage = generateFoliage(skeleton, config)
      const bounds = computeBounds(skeleton.branches)
      const transform = computeViewTransform(bounds, skeleton.root, ctx.canvas, 0.12)
      renderPlant(ctx, skeleton, foliage, transform)
    }
  }, [config])

  return <canvas ref={ref} width={640} height={640} aria-label="Procedurally generated plant" />
}
