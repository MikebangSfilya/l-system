import { useEffect, useRef } from 'react'
import { generatePlant } from './plant/generator.ts'
import { renderPlant } from './plant/renderer.ts'
import type { PlantConfig } from './plant/types.ts'

export function PlantCanvas({ config }: { config: PlantConfig }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) renderPlant(ctx, generatePlant(config))
  }, [config])

  return <canvas ref={ref} width={640} height={640} aria-label="Procedurally generated plant" />
}
