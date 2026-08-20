import type { FoliageCluster, PlantSkeleton } from './types.ts'

export function renderPlant(ctx: CanvasRenderingContext2D, plant: PlantSkeleton, foliage: FoliageCluster[]) {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  const background = ctx.createRadialGradient(width * 0.52, height * 0.42, 0, width * 0.5, height * 0.5, width * 0.75)
  background.addColorStop(0, '#07365c')
  background.addColorStop(0.55, '#021d35')
  background.addColorStop(1, '#000b16')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  const ground = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, width * 0.45)
  ground.addColorStop(0, 'rgba(0, 174, 255, 0.13)')
  ground.addColorStop(1, 'rgba(0, 174, 255, 0)')
  ctx.fillStyle = ground
  ctx.fillRect(0, height * 0.82, width, height * 0.18)

  const plantWidth = Math.max(1, plant.bounds.maxX - plant.bounds.minX)
  const plantHeight = Math.max(1, plant.bounds.maxY - plant.bounds.minY)
  const scale = Math.min((width - 52) / plantWidth, (height - 50) / plantHeight)
  const centerX = (plant.bounds.minX + plant.bounds.maxX) / 2

  ctx.save()
  ctx.translate(width / 2 - centerX * scale, height - 22)
  ctx.scale(scale, -scale)
  ctx.lineCap = 'round'
  ctx.globalCompositeOperation = 'lighter'

  for (const branch of plant.branches) {
    ctx.beginPath()
    ctx.moveTo(branch.x1, branch.y1)
    ctx.lineTo(
      branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
      branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
    )
    ctx.shadowColor = '#00bfff'
    ctx.shadowBlur = 12
    ctx.lineWidth = branch.width * 3.4
    ctx.strokeStyle = `hsla(${195 + branch.tone * 12} 100% 55% / 0.08)`
    ctx.stroke()
    ctx.shadowBlur = 5
    ctx.lineWidth = branch.width * 1.35
    ctx.strokeStyle = `hsla(${190 + branch.tone * 15} 100% 58% / 0.52)`
    ctx.stroke()
    ctx.shadowBlur = 1
    ctx.lineWidth = Math.max(0.09, branch.width * 0.3)
    ctx.strokeStyle = `hsla(${185 + branch.tone * 12} 100% 86% / 0.76)`
    ctx.stroke()
  }

  for (const cluster of foliage) {
    for (const leaf of cluster.leaves) {
      const star = leaf.size > 0.82
      const radius = leaf.size * (star ? 0.34 : 0.22)
      ctx.save()
      ctx.translate(cluster.x + leaf.x, cluster.y + leaf.y)
      ctx.shadowColor = '#16d8ff'
      ctx.shadowBlur = star ? 12 : 5
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${185 + leaf.vitality * 18} 100% ${62 + leaf.vitality * 24}% / ${0.35 + leaf.vitality * 0.65})`
      ctx.fill()
      if (star) {
        ctx.beginPath()
        ctx.moveTo(-radius * 4, 0)
        ctx.lineTo(radius * 4, 0)
        ctx.moveTo(0, -radius * 4)
        ctx.lineTo(0, radius * 4)
        ctx.lineWidth = 0.08
        ctx.strokeStyle = 'rgba(210, 249, 255, 0.9)'
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  ctx.restore()
}
