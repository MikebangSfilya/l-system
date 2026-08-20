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
    const depthWeight = 0.72 + branch.depthVisual * 0.34
    ctx.beginPath()
    branchPath(ctx, branch)
    ctx.lineWidth = branch.width * 1.45 * depthWeight
    ctx.strokeStyle = `hsla(${19 + branch.tone * 9} 48% 20% / ${0.55 + branch.depthVisual * 0.38})`
    ctx.stroke()
    ctx.lineWidth = Math.max(0.07, branch.width * 0.55 * depthWeight)
    ctx.strokeStyle = `hsla(${27 + branch.tone * 10} 48% ${32 + branch.depthVisual * 8}% / ${0.55 + branch.depthVisual * 0.4})`
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
    ctx.lineWidth = width * (near ? 1.05 : 0.82)
    ctx.strokeStyle = near ? 'rgba(91, 55, 29, 0.78)' : 'rgba(113, 77, 48, 0.45)'
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
  const background = ctx.createLinearGradient(0, 0, 0, height)
  background.addColorStop(0, '#eef5e9')
  background.addColorStop(0.72, '#dce9d2')
  background.addColorStop(1, '#cbdabf')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  const ground = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, width * 0.45)
  ground.addColorStop(0, 'rgba(71, 103, 50, 0.18)')
  ground.addColorStop(1, 'rgba(71, 103, 50, 0)')
  ctx.fillStyle = ground
  ctx.fillRect(0, height * 0.82, width, height * 0.18)

  ctx.save()
  ctx.translate(transform.rootX, transform.rootY)
  ctx.scale(transform.scale * plant.growthScale, -transform.scale * plant.growthScale)
  ctx.translate(-plant.root.x, -plant.root.y)
  ctx.lineCap = 'round'

  for (const region of crown.regions.filter(({ visibility }) => visibility > 0).sort((a, b) => a.depthVisual - b.depthVisual)) {
    ctx.save()
    ctx.translate(region.x, region.y)
    ctx.scale(region.radiusX, region.radiusY)
    const cloud = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    cloud.addColorStop(0, `hsla(${101 + region.tone * 18} 46% 42% / ${region.visibility * (0.12 + region.depthVisual * 0.1)})`)
    cloud.addColorStop(0.55, `hsla(${96 + region.tone * 15} 42% 38% / ${region.visibility * 0.08})`)
    cloud.addColorStop(1, 'rgba(59, 112, 48, 0)')
    ctx.fillStyle = cloud
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  for (const particle of crown.ambientParticles) {
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(65, 125, 52, ${particle.alpha * (0.45 + particle.depthVisual * 0.4)})`
    ctx.fill()
  }

  renderBranches(ctx, plant.branches)
  renderMicroBranches(ctx, crown.microBranches)

  for (const region of crown.regions) {
    if (region.visibility <= 0 || region.leaves.length === 0) continue
    ctx.beginPath()
    for (const leaf of region.leaves) {
      const radius = leaf.size * (0.28 + leaf.depthVisual * 0.22) * (0.55 + region.visibility * 0.45)
      ctx.moveTo(region.x + leaf.x + radius, region.y + leaf.y)
      ctx.arc(region.x + leaf.x, region.y + leaf.y, radius, 0, Math.PI * 2)
    }
    ctx.fillStyle = `hsla(${97 + region.tone * 22} ${42 + region.vitality * 25}% ${27 + region.vitality * 15}% / ${region.visibility * (0.45 + region.vitality * 0.45)})`
    ctx.fill()
  }

  ctx.restore()
}
