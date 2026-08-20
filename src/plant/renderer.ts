import type { BranchSegment, PlantCrown, PlantSkeleton, ViewTransform } from './types.ts'

function branchPath(ctx: CanvasRenderingContext2D, branch: BranchSegment) {
  ctx.moveTo(branch.x1, branch.y1)
  ctx.lineTo(
    branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
    branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
  )
}

function renderBranches(ctx: CanvasRenderingContext2D, branches: BranchSegment[]) {
  const groups = new Map<number, BranchSegment[]>()
  for (const branch of branches) {
    const group = groups.get(branch.branchId)
    if (group) group.push(branch)
    else groups.set(branch.branchId, [branch])
  }
  const ordered = [...groups.values()]
    .map((segments) => segments.sort((left, right) => left.branchProgress - right.branchProgress))
    .sort((left, right) => left[0].depthVisual - right[0].depthVisual)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const segments of ordered) {
    const visible = segments.filter(({ visibility }) => visibility > 0)
    if (visible.length === 0) continue
    const depthWeight = 0.72 + visible[0].depthVisual * 0.34
    const chunkSize = Math.max(1, Math.ceil(visible.length / 6))
    for (const inner of [false, true]) {
      for (let start = 0; start < visible.length; start += chunkSize) {
        const chunk = visible.slice(start, start + chunkSize)
        ctx.beginPath()
        ctx.moveTo(chunk[0].x1, chunk[0].y1)
        for (const branch of chunk) {
          ctx.lineTo(
            branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
            branch.y1 + (branch.y2 - branch.y1) * branch.visibility,
          )
          if (branch.visibility < 1) break
        }
        const width = chunk.reduce((total, branch) => total + branch.width, 0) / chunk.length
        ctx.lineWidth = Math.max(0.07, width * (inner ? 0.55 : 1.45) * depthWeight)
        ctx.strokeStyle = inner
          ? `hsl(${27 + chunk[0].tone * 10} 48% ${32 + chunk[0].depthVisual * 8}%)`
          : `hsl(${19 + chunk[0].tone * 9} 48% ${18 + chunk[0].depthVisual * 6}%)`
        ctx.stroke()
      }
    }
  }
}

function renderMicroBranches(ctx: CanvasRenderingContext2D, branches: BranchSegment[]) {
  ctx.lineCap = 'round'
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
  ctx.lineJoin = 'round'

  for (const region of crown.regions.filter(({ visibility }) => visibility > 0).sort((a, b) => a.depthVisual - b.depthVisual)) {
    ctx.save()
    ctx.translate(region.x, region.y)
    ctx.scale(region.radiusX, region.radiusY)
    const cloud = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    cloud.addColorStop(0, `hsla(${101 + region.tone * 18} 48% 39% / ${region.visibility * (0.32 + region.depthVisual * 0.18)})`)
    cloud.addColorStop(0.58, `hsla(${96 + region.tone * 15} 44% 35% / ${region.visibility * 0.18})`)
    cloud.addColorStop(1, 'rgba(59, 112, 48, 0)')
    ctx.fillStyle = cloud
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  renderBranches(ctx, plant.branches)
  renderMicroBranches(ctx, crown.microBranches)

  for (const region of crown.regions) {
    if (region.visibility <= 0 || region.leaves.length === 0) continue
    ctx.beginPath()
    for (const leaf of region.leaves) {
      const radius = leaf.size * (0.65 + leaf.depthVisual * 0.35) * (0.55 + region.visibility * 0.45)
      ctx.moveTo(region.x + leaf.x + radius, region.y + leaf.y)
      ctx.ellipse(region.x + leaf.x, region.y + leaf.y, radius, radius * 0.58, leaf.angle, 0, Math.PI * 2)
    }
    ctx.fillStyle = `hsla(${97 + region.tone * 22} ${42 + region.vitality * 25}% ${27 + region.vitality * 15}% / ${region.visibility * (0.45 + region.vitality * 0.45)})`
    ctx.fill()
  }

  ctx.restore()
}
