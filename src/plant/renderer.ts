import type { PlantGeometry } from './types.ts'

export function renderPlant(ctx: CanvasRenderingContext2D, plant: PlantGeometry) {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#f4f1e8'
  ctx.fillRect(0, 0, width, height)

  const plantWidth = Math.max(1, plant.bounds.maxX - plant.bounds.minX)
  const plantHeight = Math.max(1, plant.bounds.maxY - plant.bounds.minY)
  const scale = Math.min((width - 52) / plantWidth, (height - 50) / plantHeight)
  const centerX = (plant.bounds.minX + plant.bounds.maxX) / 2

  ctx.save()
  ctx.translate(width / 2 - centerX * scale, height - 22)
  ctx.scale(scale, -scale)
  ctx.lineCap = 'round'

  for (const branch of plant.branches) {
    ctx.beginPath()
    ctx.moveTo(branch.x1, branch.y1)
    ctx.lineTo(
      branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
      branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
    )
    ctx.lineWidth = branch.width
    ctx.strokeStyle = `hsl(${28 + branch.tone * 8} 38% ${27 + branch.tone * 8}%)`
    ctx.stroke()
  }

  for (const leaf of plant.leaves) {
    ctx.save()
    ctx.translate(leaf.x, leaf.y)
    ctx.rotate(leaf.angle)
    ctx.beginPath()
    ctx.ellipse(0, 0, leaf.size, leaf.size * 0.42, 0, 0, Math.PI * 2)
    ctx.fillStyle = `hsl(${58 + leaf.vitality * 55} ${35 + leaf.vitality * 30}% ${32 + leaf.vitality * 10}%)`
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}
