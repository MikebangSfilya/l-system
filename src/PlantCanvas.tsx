import { useEffect, useRef } from 'react'
import { generateFoliage, generateSkeleton } from './plant/generator.ts'
import { renderPlant } from './plant/renderer.ts'
import type { PlantConfig } from './plant/types.ts'

export function PlantCanvas({ config }: { config: PlantConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) {
      const skeleton = generateSkeleton(config)
      renderPlant(ctx, skeleton, generateFoliage(skeleton, config))
    }
  }, [config])

  return <canvas ref={ref} width={640} height={640} aria-label="Procedurally generated plant" />
}
