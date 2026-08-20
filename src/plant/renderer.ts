import type { BranchSegment, PlantCrown, PlantSkeleton, ViewTransform } from './types.ts'

function branchPath(ctx: CanvasRenderingContext2D, branch: BranchSegment) {
  ctx.moveTo(branch.x1, branch.y1)
  ctx.lineTo(
    branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
    branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
  )
}

function renderBranches(ctx: CanvasRenderingContext2D, branches: BranchSegment[]) {
  for (const branch of branches.filter(({ visibility }) => visibility > 0).sort((a, b) => a.depthVisual - b.depthVisual)) {
    const depthWeight = 0.62 + branch.depthVisual * 0.5
    ctx.beginPath()
    branchPath(ctx, branch)
    ctx.shadowColor = '#00bfff'
    ctx.shadowBlur = 7 + branch.depthVisual * 8
    ctx.lineWidth = branch.width * 3.4 * depthWeight
    ctx.strokeStyle = `hsla(${195 + branch.tone * 12} 100% 55% / ${0.035 + branch.depthVisual * 0.07})`
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = branch.width * 1.35 * depthWeight
    ctx.strokeStyle = `hsla(${190 + branch.tone * 15} 100% 58% / ${0.28 + branch.depthVisual * 0.36})`
    ctx.stroke()
    ctx.lineWidth = Math.max(0.08, branch.width * 0.3 * depthWeight)
    ctx.strokeStyle = `hsla(${185 + branch.tone * 12} 100% 86% / ${0.55 + branch.depthVisual * 0.35})`
    ctx.stroke()
  }
}

function renderMicroBranches(ctx: CanvasRenderingContext2D, branches: BranchSegment[]) {
  for (const near of [false, true]) {
    const layer = branches.filter((branch) => branch.visibility > 0 && (branch.depthVisual >= 0.5) === near)
    if (layer.length === 0) continue
    const width = layer.reduce((total, branch) => total + branch.width, 0) / layer.length
    ctx.beginPath()
    for (const branch of layer) branchPath(ctx, branch)
    ctx.shadowColor = '#16d8ff'
    ctx.shadowBlur = near ? 7 : 3
    ctx.lineWidth = width * (near ? 3.2 : 2.5)
    ctx.strokeStyle = near ? 'rgba(18, 205, 255, 0.28)' : 'rgba(9, 132, 196, 0.16)'
    ctx.stroke()
    ctx.shadowBlur = near ? 2 : 0
    ctx.lineWidth = width * (near ? 0.9 : 0.65)
    ctx.strokeStyle = near ? 'rgba(205, 249, 255, 0.78)' : 'rgba(118, 218, 248, 0.42)'
    ctx.stroke()
  }
}

export function renderPlant(
  ctx: CanvasRenderingContext2D,
  plant: PlantSkeleton,
  crown: PlantCrown,
  transform: ViewTransform,
) {
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

  ctx.save()
  ctx.translate(transform.rootX, transform.rootY)
  ctx.scale(transform.scale * plant.growthScale, -transform.scale * plant.growthScale)
  ctx.translate(-plant.root.x, -plant.root.y)
  ctx.lineCap = 'round'
  ctx.globalCompositeOperation = 'lighter'

  for (const region of crown.regions.filter(({ visibility }) => visibility > 0).sort((a, b) => a.depthVisual - b.depthVisual)) {
    ctx.save()
    ctx.translate(region.x, region.y)
    ctx.scale(region.radiusX, region.radiusY)
    const cloud = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    cloud.addColorStop(0, `hsla(${188 + region.tone * 18} 100% 62% / ${region.visibility * (0.08 + region.depthVisual * 0.08)})`)
    cloud.addColorStop(0.55, `hsla(${190 + region.tone * 14} 100% 54% / ${region.visibility * 0.045})`)
    cloud.addColorStop(1, 'rgba(0, 174, 255, 0)')
    ctx.fillStyle = cloud
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  for (const particle of crown.ambientParticles) {
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(52, 198, 255, ${particle.alpha * (0.55 + particle.depthVisual * 0.45)})`
    ctx.fill()
  }

  renderBranches(ctx, plant.branches)
  renderMicroBranches(ctx, crown.microBranches)

  for (const region of crown.regions) {
    if (region.visibility <= 0 || region.leaves.length === 0) continue
    ctx.beginPath()
    for (const leaf of region.leaves) {
      const radius = leaf.size * (0.18 + leaf.depthVisual * 0.2) * (0.55 + region.visibility * 0.45)
      ctx.moveTo(region.x + leaf.x + radius, region.y + leaf.y)
      ctx.arc(region.x + leaf.x, region.y + leaf.y, radius, 0, Math.PI * 2)
    }
    ctx.shadowColor = '#16d8ff'
    ctx.shadowBlur = 3 + region.depthVisual * 7
    ctx.fillStyle = `hsla(${185 + region.vitality * 18} 100% ${62 + region.vitality * 24}% / ${region.visibility * (0.35 + region.vitality * 0.55)})`
    ctx.fill()

    const stars = region.leaves.filter((leaf) => leaf.size > 0.82 && leaf.depthVisual > 0.5)
    if (stars.length > 0) {
      ctx.beginPath()
      for (const leaf of stars) {
        const radius = leaf.size * 0.3
        const x = region.x + leaf.x
        const y = region.y + leaf.y
        ctx.moveTo(x - radius, y)
        ctx.lineTo(x + radius, y)
        ctx.moveTo(x, y - radius)
        ctx.lineTo(x, y + radius)
      }
      ctx.shadowBlur = 2
      ctx.lineWidth = 0.07
      ctx.strokeStyle = `rgba(210, 249, 255, ${region.visibility * 0.85})`
      ctx.stroke()
    }
  }

  ctx.restore()
}
