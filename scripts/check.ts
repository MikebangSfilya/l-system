import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TreeGrowthEngine } from '../src/plant/generator.ts'
import { effectiveBranchWidth, selectRenderableBranches } from '../src/plant/renderer.ts'
import type { BranchSegment, GrowthScene, PlantConfig, PlantSkeleton, ViewTransform } from '../src/plant/types.ts'

const config: PlantConfig = {
  progress: 0,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

assert.doesNotMatch(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  /set[A-Z]\w*\(\(current\)\s*=>\s*\([^)]*event\.currentTarget/,
  'React event values must be copied before entering a state updater',
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
  const regions = crownRegions(scene).filter(({ visibility }) => visibility > 0).map((region) => ({
    id: region.anchorPersistentId,
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
const originalRegions = new Set(crownRegions(stableHistory.scene()).map(({ anchorPersistentId }) => anchorPersistentId))
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
  assert.ok(crownRegions(stableHistory.scene()).some(({ anchorPersistentId }) => anchorPersistentId === id), 'new crown growth must not resample old regions')
}

const checkpointSource = new TreeGrowthEngine(config)
checkpointSource.setTotalGrowth(56.67)
const restored = TreeGrowthEngine.restore(checkpointSource.createCheckpoint())
assert.deepEqual(renderSignature(restored.scene()), renderSignature(checkpointSource.scene()), 'checkpoint restore must reproduce the same render state')
assert.deepEqual(restored.createCheckpoint(), checkpointSource.createCheckpoint(), 'checkpoint restore must preserve frontier and IDs')
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
assert.equal(new Set(budgetSelection.map(({ branchPersistentId }) => branchPersistentId)).size, 6_000, 'renderer axis budgets must be enforced')
const budgetIds = budgetSelection.map(({ persistentId }) => persistentId)
const additions = Array.from({ length: 100 }, (_, index) => budgetBranch(7_000 + index, index % 2 ? 1 : 3, 1))
budgetPlant.chunks[0].branches.push(...additions)
assert.deepEqual(
  selectRenderableBranches(budgetPlant, { rootX: 320, rootY: 320, scale: 1 }, 640, 640).slice(0, budgetIds.length).map(({ persistentId }) => persistentId),
  budgetIds,
  'new branches must not reshuffle an exhausted renderer budget',
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
