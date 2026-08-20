import { useEffect, useRef } from 'react'
import { generateCrown, generateSkeleton } from './plant/generator.ts'
import { renderPlant } from './plant/renderer.ts'
import { computeBounds, computeViewTransform } from './plant/view.ts'
import type { PlantConfig } from './plant/types.ts'

export function PlantCanvas({ config }: { config: PlantConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) {
      const skeleton = generateSkeleton(config)
      const crown = generateCrown(skeleton, config)
      const bounds = computeBounds([...skeleton.branches, ...crown.microBranches], crown.regions)
      const transform = computeViewTransform(bounds, skeleton.root, ctx.canvas, 0.12)
      renderPlant(ctx, skeleton, crown, transform)
    }
  }, [config])

  return <canvas ref={ref} width={640} height={640} aria-label="Procedurally generated plant" />
}
