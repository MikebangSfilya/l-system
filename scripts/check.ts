import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TreeGrowthEngine } from '../src/plant/generator.ts'
import { effectiveBranchWidth, selectRenderableBranches, selectRenderableRegions } from '../src/plant/renderer.ts'
import { constrainViewTransform, verticalTravelLimit, zoomViewTransform } from '../src/plant/view.ts'
import type { BranchSegment, CrownRegion, GrowthCheckpointV1, GrowthScene, PlantConfig, PlantSkeleton, ViewTransform } from '../src/plant/types.ts'

const config: PlantConfig = {
  progress: 0,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const svgSource = readFileSync(new URL('../src/PlantSvg.tsx', import.meta.url), 'utf8')

assert.doesNotMatch(
  appSource,
  /set[A-Z]\w*\(\(current\)\s*=>\s*\([^)]*event\.currentTarget/,
  'React event values must be copied before entering a state updater',
)
assert.match(appSource, /version: current\.version \+ 1/, 'every API or demo selection must issue a fresh growth request')
assert.match(svgSource, /growthRequestRef\.current !== growthRequest\.version/, 'a fresh growth request must rebuild the engine even at zero growth')
assert.doesNotMatch(svgSource, /loadGrowth|saveGrowth/, 'controlled API and demo trees must not restore stale local growth')
assert.match(svgSource, /cosmic-garden-v1\.png/, 'the night scene must use the generated cosmic-garden backdrop')
assert.match(svgSource, /moonlit-moss-v2\.png/, 'the ground must use the revised moonlit moss texture')
assert.doesNotMatch(svgSource, /const starField/, 'the old procedural star field must not compete with the painted backdrop')
assert.doesNotMatch(svgSource, /id="far-hills"/, 'the ground must not fall back to stacked gradient bands')
assert.doesNotMatch(svgSource, /flora-sides/, 'the foreground flora must not be clipped into side fragments')
assert.match(svgSource, /const zoomAt/, 'the scene must retain an explicit zoom control')
assert.match(svgSource, /if \(!transformRef\.current \|\| fitRequestRef\.current !== fitRequest\)/, 'growth updates must preserve the current camera unless fit is requested')
assert.doesNotMatch(svgSource, /sceneryTransform/, 'the scenery must stay fixed while the tree travels')
assert.doesNotMatch(svgSource, /growth-origin/, 'the detached growth-origin mound must not be rendered')
assert.match(svgSource, /const treeTransform = currentTransform \? \{ \.\.\.currentTransform, rootY: currentTransform\.rootY \+ sceneOffset \} : undefined/, 'tree travel must not mutate the growth origin')

const constrainedCamera = constrainViewTransform(
  { rootX: -500, rootY: 999, scale: 2 },
  { width: 640, height: 640 },
)
assert.deepEqual(constrainedCamera, { rootX: 320, rootY: 563.2, scale: 2 }, 'camera must keep the tree fixed while the sky moves independently')
assert.deepEqual(
  zoomViewTransform({ rootX: 320, rootY: 563.2, scale: 2 }, 2.4),
  { rootX: 320, rootY: 563.2, scale: 2.4 },
  'zoom must preserve the tree root coordinates',
)
assert.ok(
  Math.abs(verticalTravelLimit({ minX: 0, minY: 0, maxX: 0, maxY: 400 }, { x: 0, y: 0 }, { rootX: 320, rootY: 563.2, scale: 2 }, 1, 640, 0.12) - 313.6) < 1e-9,
  'vertical travel must stop when the tree top reaches the viewport padding',
)
assert.equal(
  verticalTravelLimit({ minX: 0, minY: 0, maxX: 0, maxY: 100 }, { x: 0, y: 0 }, { rootX: 320, rootY: 563.2, scale: 2 }, 1, 640, 0.12),
  0,
  'a tree that already fits must not travel away from its growth origin',
)

const branches = (scene: GrowthScene) => [
  ...scene.skeleton.chunks.flatMap((chunk) => chunk.branches),
  ...(scene.skeleton.activeChunk?.branches ?? []),
]
const crownRegions = (scene: GrowthScene) => [...scene.crown.regions, ...scene.crown.activeRegions]
const length = (branch: BranchSegment) => Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1)
const physicalLength = (scene: GrowthScene) => branches(scene)
  .reduce((total, branch) => total + length(branch) * branch.visibility, 0) * scene.skeleton.growthScale
const mass = (scene: GrowthScene) => branches(scene).reduce((total, branch) =>
  total + length(branch) * branch.visibility * effectiveBranchWidth(branch, scene.skeleton), 0)
const rounded = (value: number) => Math.round(value * 1e9) / 1e9
const angleDifference = (left: number, right: number) => Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)))

function historicalSignature(scene: GrowthScene) {
  return branches(scene).filter(({ birthEpoch }) => birthEpoch < scene.skeleton.time.epoch).map((branch) => ({
    id: branch.persistentId,
    parent: branch.parentPersistentId,
    axis: branch.branchPersistentId,
    geometry: [branch.x1, branch.y1, branch.x2, branch.y2].map(rounded),
    traits: [branch.baseDirection, branch.bendStrength, branch.depthVisual, branch.tone, branch.priority].map(rounded),
  }))
}

function renderSignature(scene: GrowthScene) {
  const visibleBranches = branches(scene).filter(({ visibility }) => visibility > 0).map((branch) => ({
    id: branch.persistentId,
    x1: rounded(branch.x1),
    y1: rounded(branch.y1),
    x2: rounded(branch.x1 + (branch.x2 - branch.x1) * branch.visibility),
    y2: rounded(branch.y1 + (branch.y2 - branch.y1) * branch.visibility),
    width: rounded(effectiveBranchWidth(branch, scene.skeleton)),
  })).sort((left, right) => left.id.localeCompare(right.id))
  const regions = crownRegions(scene).filter((region) => region.visibility > 0 && region.priority <= scene.crown.density).map((region) => ({
    id: region.id,
    visibility: rounded(region.visibility),
    leaves: region.leaves.filter((leaf) => leaf.opacity > 0 && leaf.priority <= scene.crown.density)
      .map((leaf) => [leaf.id, rounded(leaf.size * leaf.opacity)]),
  })).sort((left, right) => left.id.localeCompare(right.id))
  return { visibleBranches, regions }
}

const deterministicA = new TreeGrowthEngine(config)
const deterministicB = new TreeGrowthEngine(config)
deterministicA.setTotalGrowth(17.63)
deterministicB.setTotalGrowth(17.63)
assert.deepEqual(renderSignature(deterministicA.scene()), renderSignature(deterministicB.scene()), 'same seed and time must be deterministic')

const differentSeed = new TreeGrowthEngine({ ...config, seed: 54321 })
differentSeed.setTotalGrowth(17.63)
assert.notDeepEqual(historicalSignature(deterministicA.scene()), historicalSignature(differentSeed.scene()), 'seed must change stable geometry')

const canopy = new TreeGrowthEngine({ ...config, branching: 1, density: 1, vitality: 1 }).setTotalGrowth(2.99)
const canopyAnchors = new Map(canopy.skeleton.foliageAnchors.map((anchor) => [anchor.id, anchor]))
const canopyBranches = new Map(canopy.skeleton.branches.map((branch) => [branch.id, branch]))
for (const region of canopy.crown.regions) {
  const anchor = canopyAnchors.get(region.anchorId)
  const source = canopyBranches.get(region.anchorId)
  assert.ok(anchor && source && (
    anchor.terminal
    || anchor.depth >= 2
    || (anchor.depth === 1 && source.branchProgress >= 0.28 && source.branchProgress <= 0.88)
  ), 'foliage must grow from tips or eligible internal branch nodes')
  assert.deepEqual([region.x, region.y], [anchor.x, anchor.y], 'foliage must stay attached to its growth node')
  assert.ok(region.id.startsWith(`${anchor.persistentId}:shoot:`), 'crown regions must have stable shoot IDs')
  assert.ok(region.leaves.length <= 7, 'a crown region must not turn into a dense leaf clump')
  assert.ok(region.leaves.length >= 5, 'every shoot must carry paired leaves and an apical leaf')
  const twigs = canopy.crown.microBranches.filter((branch) => branch.branchPersistentId === `${region.id}:axis`)
    .sort((left, right) => left.branchProgress - right.branchProgress)
  const [twigStart, twigEnd] = twigs
  assert.equal(twigs.length, 2, 'every foliage region must own one two-segment shoot')
  assert.deepEqual([twigStart.x1, twigStart.y1], [anchor.x, anchor.y], 'a foliage twig must start at its growth node')
  assert.deepEqual([twigEnd.x1, twigEnd.y1], [twigStart.x2, twigStart.y2], 'shoot segments must stay connected')
  assert.equal(twigStart.priority, region.priority, 'a shoot and its crown region must share one density threshold')
  const twigAngle = Math.atan2(twigEnd.y2 - anchor.y, twigEnd.x2 - anchor.x)
  const twigLength = length(twigStart) + length(twigEnd)
  if (region.id.endsWith(':shoot:0') && anchor.terminal) {
    assert.ok(twigLength >= 1.05 && twigLength <= 1.3, 'terminal continuation shoots must keep their natural length range')
    const firstAngle = Math.atan2(twigStart.y2 - twigStart.y1, twigStart.x2 - twigStart.x1)
    assert.ok(angleDifference(firstAngle, anchor.angle) <= Math.PI * 8 / 180, 'terminal continuation shoots must stay within eight degrees of their branch')
  } else {
    assert.ok(twigLength >= 0.75 && twigLength <= 1, 'side shoots must keep their compact length range')
  }
  if (!anchor.terminal) {
    const outward = anchor.x === 0 ? (Math.cos(anchor.angle) < 0 ? -1 : 1) : (anchor.x < 0 ? -1 : 1)
    assert.ok((twigEnd.x2 - anchor.x) * outward > 0, 'internal shoots must grow away from the trunk')
  }
  for (const leaf of region.leaves) {
    assert.ok(leaf.x * Math.cos(twigAngle) + leaf.y * Math.sin(twigAngle) > 0, 'leaves must fan outward along their twig')
    assert.ok(leaf.priority >= region.priority, 'leaves must appear no earlier than their supporting shoot')
  }
}
for (const anchor of canopyAnchors.values()) {
  const shoots = canopy.crown.regions.filter((region) => region.anchorPersistentId === anchor.persistentId)
  if (anchor.terminal) assert.equal(shoots.length, 3, 'every terminal anchor must have one continuation and two lateral shoots')
  else if (shoots.length > 0) assert.equal(shoots.length, 2, 'selected internal anchors must have two lateral shoots')
}
assert.ok(
  canopy.crown.regions.some((region) => !canopyAnchors.get(region.anchorId)?.terminal),
  'fine branches must carry foliage between their tips',
)

const sparseCrown = new TreeGrowthEngine({ ...config, density: 0 }).setTotalGrowth(3).crown
const denseCrown = new TreeGrowthEngine({ ...config, density: 1 }).setTotalGrowth(3).crown
assert.equal(
  sparseCrown.regions.reduce((total, region) => total + region.leaves.length, 0),
  denseCrown.regions.reduce((total, region) => total + region.leaves.length, 0),
  'density must reveal stable foliage instead of baking away leaf candidates',
)
const visibleFoliage = (scene: GrowthScene) => crownRegions(scene)
  .filter((region) => region.priority <= scene.crown.density)
  .reduce((total, region) => total + region.leaves.filter((leaf) => leaf.priority <= scene.crown.density).length, 0)
const densityTree = new TreeGrowthEngine({ ...config, density: 0.3 })
const sparseScene = densityTree.setTotalGrowth(3)
const sparseGeometry = sparseScene.crown.regions.map((region) => [region.id, region.x, region.y, region.priority, region.leaves.map((leaf) => leaf.id)])
const sparseVisible = visibleFoliage(sparseScene)
const mediumScene = densityTree.setAppearance({ density: 0.7, vitality: config.vitality })
const mediumVisible = visibleFoliage(mediumScene)
const denseScene = densityTree.setAppearance({ density: 1, vitality: config.vitality })
assert.deepEqual(
  denseScene.crown.regions.map((region) => [region.id, region.x, region.y, region.priority, region.leaves.map((leaf) => leaf.id)]),
  sparseGeometry,
  'density changes must not resample shoot or leaf geometry',
)
assert.ok(sparseVisible < mediumVisible && mediumVisible < visibleFoliage(denseScene), 'density must monotonically reveal more foliage')

const matureCrowns = [3, 10, 20, 30, 40].map((growth) => new TreeGrowthEngine(config).setTotalGrowth(growth))
const matureRegionCounts = matureCrowns.map((scene) => crownRegions(scene).length)
for (let index = 1; index < matureRegionCounts.length; index += 1) {
  assert.ok(matureRegionCounts[index] > matureRegionCounts[index - 1], 'mature epochs must keep adding foliage')
}
assert.ok(
  branches(matureCrowns.at(-1)!).some((branch) => branch.depth === 4),
  'mature growth must add fine child branches to fill the crown',
)
const balancedMature = new TreeGrowthEngine({ ...config, branching: 0.82, curvature: 0.42, seed: 12345 }).setTotalGrowth(28)
const leftSpan = -balancedMature.bounds.minX
const rightSpan = balancedMature.bounds.maxX
assert.ok(
  Math.max(leftSpan, rightSpan) / Math.min(leftSpan, rightSpan) <= 1.35,
  'mature growth must keep a naturally balanced crown silhouette',
)
const matureDensity = new TreeGrowthEngine({ ...config, density: 0.2 })
const matureSparse = matureDensity.setTotalGrowth(30)
const matureGeometry = crownRegions(matureSparse).map((region) => [region.id, region.x, region.y, region.leaves.map((leaf) => leaf.id)])
const matureSparseVisible = visibleFoliage(matureSparse)
const matureDense = matureDensity.setAppearance({ density: 1, vitality: config.vitality })
assert.deepEqual(
  crownRegions(matureDense).map((region) => [region.id, region.x, region.y, region.leaves.map((leaf) => leaf.id)]),
  matureGeometry,
  'mature density must not resample the accumulated crown',
)
assert.ok(matureSparseVisible < visibleFoliage(matureDense), 'mature density must only reveal accumulated foliage')

const gradualCrown = new TreeGrowthEngine(config)
gradualCrown.setTotalGrowth(8)
const refreshedLeaves = (scene: GrowthScene) => crownRegions(scene)
  .filter((region) => region.id.includes(':layer:1'))
  .flatMap((region) => region.leaves)
  .filter((leaf) => leaf.opacity > 0).length
const earlyRefresh = refreshedLeaves(gradualCrown.previewProgress(0.25))
const lateRefresh = refreshedLeaves(gradualCrown.previewProgress(0.75))
const fullRefresh = refreshedLeaves(gradualCrown.previewProgress(1))
assert.ok(earlyRefresh < lateRefresh && lateRefresh < fullRefresh, 'refresh foliage must appear gradually within an epoch')

const baseTrunk = denseScene.skeleton.branches.filter((branch) => branch.level === 0 && branch.birthEpoch < 0)
const treeHeight = Math.max(...denseScene.skeleton.branches.filter((branch) => branch.birthEpoch < 0).map((branch) => branch.y2))
const trunkXAt = (y: number) => {
  const branch = baseTrunk.reduce((nearest, candidate) =>
    Math.abs((candidate.y1 + candidate.y2) / 2 - y) < Math.abs((nearest.y1 + nearest.y2) / 2 - y)
      ? candidate
      : nearest)
  const progress = Math.min(1, Math.max(0, (y - branch.y1) / (branch.y2 - branch.y1)))
  return branch.x1 + (branch.x2 - branch.x1) * progress
}
const middleLeaves = denseScene.crown.regions.flatMap((region) => region.leaves.map((leaf) => ({
  x: region.x + leaf.x,
  y: region.y + leaf.y,
}))).filter((leaf) => leaf.y >= treeHeight * 0.45 && leaf.y <= treeHeight * 0.75)
const middleOffset = (leaf: { x: number; y: number }) => leaf.x - trunkXAt(leaf.y)
const corridor = treeHeight * 0.035
const innerEdge = treeHeight * 0.18
assert.ok(middleLeaves.filter((leaf) => middleOffset(leaf) <= -corridor && middleOffset(leaf) >= -innerEdge).length >= 20, 'middle crown must be filled near the left side of the trunk')
assert.ok(middleLeaves.filter((leaf) => middleOffset(leaf) >= corridor && middleOffset(leaf) <= innerEdge).length >= 20, 'middle crown must be filled near the right side of the trunk')
assert.ok(middleLeaves.filter((leaf) => Math.abs(middleOffset(leaf)) < corridor).length <= middleLeaves.length * 0.02, 'dense foliage must preserve a narrow readable trunk corridor')

const chunkedCanopy = new TreeGrowthEngine(config).setTotalGrowth(17.5)
const chunkedRegions = [
  ...chunkedCanopy.skeleton.chunks.flatMap((chunk) => chunk.regions),
  ...(chunkedCanopy.skeleton.activeChunk?.regions ?? []),
]
assert.equal(
  new Set(chunkedRegions.map((region) => region.id)).size,
  chunkedRegions.length,
  'renderer chunks must not contain duplicate crown regions',
)
const chunkedMicroBranches = [
  ...chunkedCanopy.skeleton.chunks.flatMap((chunk) => chunk.microBranches),
  ...(chunkedCanopy.skeleton.activeChunk?.microBranches ?? []),
]
const chunkedLeaves = chunkedRegions.flatMap((region) => region.leaves)
assert.equal(new Set(chunkedMicroBranches.map((branch) => branch.persistentId)).size, chunkedMicroBranches.length, 'renderer chunks must not contain duplicate mini-branches')
assert.equal(new Set(chunkedLeaves.map((leaf) => leaf.id)).size, chunkedLeaves.length, 'renderer chunks must not contain duplicate leaves')

const agedForReset = new TreeGrowthEngine(config)
agedForReset.setTotalGrowth(42.75)
const resetGrowth = new TreeGrowthEngine(config)
assert.deepEqual(resetGrowth.scene().skeleton.time, { phase: 0, epoch: 0, progress: 0 }, 'explicit reset must return to zero growth time')
assert.deepEqual(renderSignature(resetGrowth.scene()), renderSignature(new TreeGrowthEngine(config).scene()), 'explicit reset must reproduce the original seed state')

const ordered = new TreeGrowthEngine(config)
ordered.setTotalGrowth(23)
const orderedCheckpoint = ordered.createCheckpoint()
const reversedCheckpoint = structuredClone(orderedCheckpoint)
reversedCheckpoint.frontier.reverse()
const orderedContinuation = TreeGrowthEngine.restore(orderedCheckpoint)
const reversedContinuation = TreeGrowthEngine.restore(reversedCheckpoint)
orderedContinuation.setTotalGrowth(24)
reversedContinuation.setTotalGrowth(24)
const canonicalHistory = (scene: GrowthScene) => historicalSignature(scene).sort((left, right) => left.id.localeCompare(right.id))
assert.deepEqual(
  canonicalHistory(reversedContinuation.scene()),
  canonicalHistory(orderedContinuation.scene()),
  'frontier traversal order must not affect persistent geometry or random traits',
)

const lifecycle = new TreeGrowthEngine(config)
let previousLength = 0
let previousMass = 0
for (const total of Array.from({ length: 41 }, (_, index) => index * 0.1)) {
  const scene = lifecycle.setTotalGrowth(total)
  const currentLength = physicalLength(scene)
  const currentMass = mass(scene)
  assert.ok(currentLength + 1e-9 >= previousLength, `visible length must not decrease at totalGrowth=${total}`)
  assert.ok(currentMass + 1e-9 >= previousMass, `visible mass must not decrease at totalGrowth=${total}`)
  previousLength = currentLength
  previousMass = currentMass
}

const matureSeam = new TreeGrowthEngine(config).setTotalGrowth(28)
const matureTrunk = branches(matureSeam).filter((branch) => branch.branchId === 0)
const baseTip = matureTrunk.filter((branch) => branch.birthEpoch < 0).at(-1)!
const firstExtension = matureTrunk.find((branch) => branch.birthEpoch === 0)!
assert.ok(
  Math.abs(effectiveBranchWidth(baseTip, matureSeam.skeleton) - effectiveBranchWidth(firstExtension, matureSeam.skeleton)) < 1e-9,
  'the mature trunk must continue at the same width as its base',
)

const boundary = new TreeGrowthEngine(config)
boundary.setTotalGrowth(8.73)
const beforeHistory = historicalSignature(boundary.scene())
const nearBoundary = boundary.previewProgress(0.999)
const widthsNear = new Map(branches(nearBoundary).filter(({ visibility }) => visibility > 0)
  .map((branch) => [branch.persistentId, effectiveBranchWidth(branch, nearBoundary.skeleton)]))
const exactBoundary = boundary.previewProgress(1)
const atOne = renderSignature(exactBoundary)
const afterBoundary = boundary.setProgress(1)
assert.deepEqual(renderSignature(afterBoundary), atOne, '(N, 1) and (N+1, 0) must have the same render state')
assert.deepEqual(historicalSignature(afterBoundary).slice(0, beforeHistory.length), beforeHistory, 'epoch commit must preserve history')
for (const branch of branches(afterBoundary).filter(({ visibility }) => visibility > 0)) {
  const previous = widthsNear.get(branch.persistentId)
  if (previous !== undefined) {
    const width = effectiveBranchWidth(branch, afterBoundary.skeleton)
    assert.ok(width + 1e-9 >= previous, 'width must not fall at an epoch boundary')
    assert.ok(width - previous < 0.02, 'width must not jump at an epoch boundary')
  }
}

const stableHistory = new TreeGrowthEngine(config)
stableHistory.setTotalGrowth(5)
const original = historicalSignature(stableHistory.scene())
const originalIds = new Set(original.map(({ id }) => id))
const originalLeaves = new Map(crownRegions(stableHistory.scene()).flatMap((region) => region.leaves)
  .map((leaf) => [leaf.id, [leaf.x, leaf.y, leaf.angle, leaf.size, leaf.priority].map(rounded)]))
const originalRegions = new Set(crownRegions(stableHistory.scene()).map(({ id }) => id))
stableHistory.setTotalGrowth(103.4)
const laterById = new Map(historicalSignature(stableHistory.scene()).map((item) => [item.id, item]))
for (const item of original) assert.deepEqual(laterById.get(item.id), item, 'grown segments must not move or change random traits')
for (const region of crownRegions(stableHistory.scene())) {
  for (const leaf of region.leaves) {
    const prior = originalLeaves.get(leaf.id)
    if (prior) assert.deepEqual([leaf.x, leaf.y, leaf.angle, leaf.size, leaf.priority].map(rounded), prior, 'existing leaves must keep random traits')
  }
}
assert.ok(historicalSignature(stableHistory.scene()).some(({ id }) => !originalIds.has(id)), 'new epochs must append geometry')
for (const id of originalRegions) {
  assert.ok(crownRegions(stableHistory.scene()).some((region) => region.id === id), 'new crown growth must not resample old regions')
}

const checkpointSource = new TreeGrowthEngine(config)
checkpointSource.setTotalGrowth(56.67)
const restored = TreeGrowthEngine.restore(checkpointSource.createCheckpoint())
assert.deepEqual(renderSignature(restored.scene()), renderSignature(checkpointSource.scene()), 'checkpoint restore must reproduce the same render state')
assert.deepEqual(restored.createCheckpoint(), checkpointSource.createCheckpoint(), 'checkpoint restore must preserve frontier and IDs')
const jsonCheckpoint = JSON.parse(JSON.stringify(checkpointSource.createCheckpoint())) as GrowthCheckpointV1
assert.deepEqual(
  renderSignature(TreeGrowthEngine.restore(jsonCheckpoint).scene()),
  renderSignature(checkpointSource.scene()),
  'JSON checkpoint transport must preserve the render state',
)
const legacyCheckpoint = structuredClone(checkpointSource.createCheckpoint())
delete legacyCheckpoint.crownVersion
legacyCheckpoint.crown.regions[0].x += 1_000
assert.notEqual(
  TreeGrowthEngine.restore(legacyCheckpoint).scene().crown.regions[0].x,
  legacyCheckpoint.crown.regions[0].x,
  'legacy checkpoints must rebuild stale crown layout',
)
restored.setTotalGrowth(80.25)
checkpointSource.setTotalGrowth(80.25)
assert.deepEqual(renderSignature(restored.scene()), renderSignature(checkpointSource.scene()), 'restored frontier must continue deterministically')

const activeOnly = new TreeGrowthEngine(config)
activeOnly.setTotalGrowth(1003.5)
const activeCount = activeOnly.scene().skeleton.activeChunk?.branches.length ?? 0
const fractional = activeOnly.setProgress(0.51)
assert.equal(fractional.skeleton.stats.generatedEpochs, 0, 'fractional updates must not generate epochs')
assert.equal(fractional.skeleton.stats.visitedHistoricalSegments, 0, 'fractional updates must not visit historical segments')
assert.equal(fractional.skeleton.stats.activeSegments, activeCount, 'fractional updates must touch only the active epoch')

const transform: ViewTransform = { rootX: 320, rootY: 580, scale: 4 }
const rendererTree = new TreeGrowthEngine(config)
rendererTree.setTotalGrowth(103)
const selectedBefore = new Set(selectRenderableBranches(rendererTree.scene().skeleton, transform, 640, 640).map(({ persistentId }) => persistentId))
rendererTree.setTotalGrowth(104)
const selectedAfter = new Set(selectRenderableBranches(rendererTree.scene().skeleton, transform, 640, 640).map(({ persistentId }) => persistentId))
for (const id of selectedBefore) assert.ok(selectedAfter.has(id), 'appending branches must not evict visible historical renderer choices')
assert.ok([...selectedAfter].some((id) => !selectedBefore.has(id)), 'renderer must admit local new growth')

const budgetBranch = (id: number, level: 1 | 3, birthEpoch = 0): BranchSegment => ({
  id,
  persistentId: `budget:${id}`,
  parentId: null,
  parentPersistentId: null,
  branchId: id,
  branchPersistentId: `budget-axis:${id}`,
  branchProgress: 1,
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  width: 0.1,
  depth: level,
  level,
  baseDirection: 0,
  bendStrength: 0,
  bendDirection: 1,
  depthVisual: 0.5,
  visibility: 1,
  tone: 0.5,
  priority: (id % 997) / 997,
  birthEpoch,
  birthProgress: 0,
  growthDuration: 1,
})
const budgetBranches = [
  ...Array.from({ length: 4_500 }, (_, id) => budgetBranch(id, 1)),
  ...Array.from({ length: 2_500 }, (_, index) => budgetBranch(4_500 + index, 3)),
]
const budgetPlant: PlantSkeleton = {
  root: { x: 0, y: 0 },
  branches: budgetBranches,
  chunks: [{
    id: 0,
    epochStart: 0,
    epochEnd: 0,
    originX: 0,
    originY: 0,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    branches: budgetBranches,
    microBranches: [],
    regions: [],
  }],
  activeChunk: null,
  foliageAnchors: [],
  growthScale: 1,
  time: { phase: 3, epoch: 1, progress: 0 },
  supportByBranch: new Map(),
  activeSupportByBranch: new Map(),
  stats: { generatedEpochs: 0, activeSegments: 0, visitedHistoricalSegments: 0 },
}
const budgetSelection = selectRenderableBranches(budgetPlant, { rootX: 320, rootY: 320, scale: 1 }, 640, 640)
assert.equal(new Set(budgetSelection.map(({ branchPersistentId }) => branchPersistentId)).size, 7_000, 'renderer must keep every visible axis')
const budgetIds = budgetSelection.map(({ persistentId }) => persistentId)
const additions = Array.from({ length: 100 }, (_, index) => budgetBranch(7_000 + index, index % 2 ? 1 : 3, 1))
budgetPlant.chunks[0].branches.push(...additions)
const allBudgetIds = new Set(selectRenderableBranches(budgetPlant, { rootX: 320, rootY: 320, scale: 1 }, 640, 640).map(({ persistentId }) => persistentId))
for (const id of budgetIds) assert.ok(allBudgetIds.has(id), 'new branches must not hide historical branches')
const budgetRegions: CrownRegion[] = [
  ...Array.from({ length: 1_100 }, (_, index) => ({
    id: `hidden:${index}`,
    anchorId: index,
    anchorPersistentId: `hidden-anchor:${index}`,
    x: 0,
    y: 0,
    radiusX: 1,
    radiusY: 1,
    depthVisual: 0.5,
    visibility: 1,
    tone: 0.5,
    vitality: 1,
    priority: 1,
    leaves: [],
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `visible:${index}`,
    anchorId: 1_100 + index,
    anchorPersistentId: `visible-anchor:${index}`,
    x: 0,
    y: 0,
    radiusX: 1,
    radiusY: 1,
    depthVisual: 0.5,
    visibility: 1,
    tone: 0.5,
    vitality: 1,
    priority: 0,
    leaves: [],
  })),
]
assert.equal(
  selectRenderableRegions(budgetRegions, 0.5, budgetPlant, { rootX: 320, rootY: 320, scale: 1 }, 640, 640).length,
  10,
  'hidden density regions must not consume the renderer budget',
)

const morphology = new TreeGrowthEngine(config)
morphology.setTotalGrowth(23)
const beforeAppearance = historicalSignature(morphology.scene())
morphology.setAppearance({ density: 0.1, vitality: 0.2 })
assert.deepEqual(historicalSignature(morphology.scene()), beforeAppearance, 'appearance controls must not rewrite geometry')

const dynamicSource = new TreeGrowthEngine(config)
dynamicSource.setTotalGrowth(23.4)
const dynamicCheckpoint = dynamicSource.createCheckpoint()
const dynamicMorphology = TreeGrowthEngine.restore(dynamicCheckpoint)
const staticMorphology = TreeGrowthEngine.restore(dynamicCheckpoint)
const historyBeforeMorphology = historicalSignature(dynamicMorphology.scene())
dynamicMorphology.setMorphology({ branching: 1, curvature: 1 })
assert.deepEqual(historicalSignature(dynamicMorphology.scene()), historyBeforeMorphology, 'live morphology must not rewrite history')
const restoredPendingMorphology = TreeGrowthEngine.restore(dynamicMorphology.createCheckpoint())
dynamicMorphology.setTotalGrowth(25.4)
restoredPendingMorphology.setTotalGrowth(25.4)
staticMorphology.setTotalGrowth(25.4)
assert.deepEqual(renderSignature(restoredPendingMorphology.scene()), renderSignature(dynamicMorphology.scene()), 'pending morphology must survive checkpoints')
assert.deepEqual(
  historicalSignature(dynamicMorphology.scene()).slice(0, historyBeforeMorphology.length),
  historyBeforeMorphology,
  'new morphology must preserve every existing segment',
)
assert.notDeepEqual(renderSignature(dynamicMorphology.scene()), renderSignature(staticMorphology.scene()), 'new morphology must affect later epochs')

const liveMorphology = new TreeGrowthEngine({ ...config, branching: 0.1, curvature: 0 })
const liveBeforeScene = liveMorphology.setTotalGrowth(3.65)
const liveHistory = historicalSignature(liveBeforeScene)
const activeBeforeMorphology = new Map((liveBeforeScene.skeleton.activeChunk?.branches ?? [])
  .map((branch) => [branch.persistentId, { ...branch }]))
const liveAfterScene = liveMorphology.setMorphology({ branching: 1, curvature: 1 })
const activeAfterMorphology = liveAfterScene.skeleton.activeChunk?.branches ?? []
assert.deepEqual(historicalSignature(liveAfterScene), liveHistory, 'real-time morphology must leave completed history untouched')
for (const branch of activeBeforeMorphology.values()) {
  if (branch.visibility <= 0) continue
  assert.ok(activeAfterMorphology.some(({ persistentId }) => persistentId === branch.persistentId), 'a born active fragment must not disappear')
  if (branch.visibility === 1) {
    const after = activeAfterMorphology.find(({ persistentId }) => persistentId === branch.persistentId)!
    assert.deepEqual([after.x1, after.y1, after.x2, after.y2], [branch.x1, branch.y1, branch.x2, branch.y2], 'a finished active fragment must freeze')
  }
}
assert.ok(activeAfterMorphology.some((branch) => {
  const before = activeBeforeMorphology.get(branch.persistentId)
  return before && before.visibility > 0 && before.visibility < 1 && (before.x2 !== branch.x2 || before.y2 !== branch.y2)
}), 'a growing fragment must react to live curvature')
for (const branch of activeAfterMorphology.filter(({ persistentId }) => !activeBeforeMorphology.has(persistentId))) {
  assert.equal(branch.visibility, 0, 'a branch introduced by live branching must start at zero length')
}

const morphologyAge = new TreeGrowthEngine(config)
const agedScene = morphologyAge.setTotalGrowth(37.42)
const regenerated = new TreeGrowthEngine({ ...config, seed: 987654321 })
const regeneratedScene = regenerated.setTotalGrowth(3 + agedScene.skeleton.time.epoch + agedScene.skeleton.time.progress)
assert.deepEqual(regeneratedScene.skeleton.time, agedScene.skeleton.time, 'full morphology regeneration must preserve growth time')
assert.notDeepEqual(historicalSignature(regeneratedScene), historicalSignature(agedScene), 'full morphology regeneration must replace geometry')

const invisibleFrontier = new TreeGrowthEngine(config).setTotalGrowth(3).skeleton.activeChunk
assert.deepEqual(
  invisibleFrontier?.bounds,
  { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  'future geometry must not affect active bounds before it becomes visible',
)

for (const extreme of [
  { seed: 0, branching: 0, curvature: 0 },
  { seed: 0xffffffff, branching: 1, curvature: 1 },
]) {
  const scene = new TreeGrowthEngine({ ...config, ...extreme }).setTotalGrowth(12.5)
  assert.ok(Object.values(scene.bounds).every(Number.isFinite), 'valid morphology extremes must keep finite render bounds')
}

console.log('growth checks passed', {
  epochs: stableHistory.scene().skeleton.time.epoch,
  segments: branches(stableHistory.scene()).length,
  chunks: stableHistory.scene().skeleton.chunks.length,
  regions: crownRegions(stableHistory.scene()).length,
})
