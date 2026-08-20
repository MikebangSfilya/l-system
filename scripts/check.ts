import { strict as assert } from 'node:assert'
import { generateCrown, generateSkeleton } from '../src/plant/generator.ts'
import type { BranchLevel, BranchSegment, PlantConfig, PlantPhase } from '../src/plant/types.ts'
import { computeBounds, computeViewTransform } from '../src/plant/view.ts'

const AMBIENT_LIMIT = 18
const config: PlantConfig = {
  phase: 3,
  phaseProgress: 1,
  branching: 0.6,
  density: 0.7,
  curvature: 0.3,
  vitality: 0.9,
  seed: 12345,
}

const generate = (plantConfig: PlantConfig) => {
  const skeleton = generateSkeleton(plantConfig)
  const crown = generateCrown(skeleton, plantConfig)
  const bounds = computeBounds([...skeleton.branches, ...crown.microBranches], crown.regions)
  return {
    skeleton,
    crown,
    bounds,
    transform: computeViewTransform(bounds, skeleton.root, { width: 640, height: 640 }, 0.12),
  }
}
const visible = (plant: ReturnType<typeof generate>) => plant.skeleton.branches.filter((branch) => branch.visibility > 0)
const visibleMicro = (plant: ReturnType<typeof generate>) => plant.crown.microBranches.filter((branch) => branch.visibility > 0)
const activeRegions = (plant: ReturnType<typeof generate>) => plant.crown.regions.filter((region) => region.visibility > 0)
const leafCount = (plant: ReturnType<typeof generate>) =>
  plant.crown.regions.reduce((total, region) => total + region.leaves.length, 0)
const allBranches = (plant: ReturnType<typeof generate>) => [...plant.skeleton.branches, ...plant.crown.microBranches]
const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
const averageWidth = (plant: ReturnType<typeof generate>, level: BranchLevel) =>
  average(plant.skeleton.branches.filter((branch) => branch.level === level).map((branch) => branch.width))
const topology = (plant: ReturnType<typeof generate>) => allBranches(plant)
  .map(({ id, parentId, branchId, depth, level }) => ({ id, parentId, branchId, depth, level }))
const blueprint = (plant: ReturnType<typeof generate>) => ({
  branches: plant.skeleton.branches.map(({ visibility: _visibility, width: _width, ...branch }) => branch),
  anchors: plant.skeleton.foliageAnchors.map(({ visibility: _visibility, ...anchor }) => anchor),
  microBranches: plant.crown.microBranches.map(({ visibility: _visibility, width: _width, ...branch }) => branch),
  regions: plant.crown.regions.map(({ visibility: _visibility, vitality: _vitality, leaves: _leaves, ...region }) => region),
})
const groupBranches = (branches: BranchSegment[]) => {
  const groups = new Map<number, BranchSegment[]>()
  for (const branch of branches) groups.set(branch.branchId, [...(groups.get(branch.branchId) ?? []), branch])
  return [...groups.values()].map((segments) => segments.sort((left, right) => left.branchProgress - right.branchProgress))
}
const direction = (branch: BranchSegment) => Math.atan2(branch.y2 - branch.y1, branch.x2 - branch.x1)
const angleDelta = (left: number, right: number) => Math.atan2(Math.sin(right - left), Math.cos(right - left))
const degrees = (angle: number) => Math.abs(angle) * 180 / Math.PI
const branchLength = (branch: BranchSegment) => Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1)
const grownLength = (plant: ReturnType<typeof generate>, minimumDepth = 0) => plant.skeleton.branches
  .filter((branch) => branch.depth >= minimumDepth)
  .reduce((total, branch) => total + branchLength(branch) * branch.visibility, 0)
const visibleWidth = (plant: ReturnType<typeof generate>) => {
  const points = visible(plant).flatMap((branch) => [
    branch.x1,
    branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
  ])
  return Math.max(...points) - Math.min(...points)
}
const span = (values: number[]) => Math.max(...values) - Math.min(...values)

const mature = generate(config)
assert.deepEqual(mature, generate(config), 'same config must be deterministic')
assert.deepEqual(mature, generate(JSON.parse(JSON.stringify(config)) as PlantConfig), 'JSON config must preserve generation')
assert.deepEqual(mature, generate({ ...config, phase: 99 as PlantPhase, phaseProgress: 2 }), 'lifecycle inputs must clamp')
assert.notDeepEqual(blueprint(mature), blueprint(generate({ ...config, seed: 54321 })), 'seed must change the blueprint')

const phasePlants = ([0, 1, 2, 3] as PlantPhase[]).map((phase) =>
  [0, 0.25, 0.5, 0.75, 1].map((phaseProgress) => generate({ ...config, phase, phaseProgress })))
for (const plants of phasePlants) {
  const physicalGrowth = plants.map((plant) => grownLength(plant) * plant.skeleton.growthScale)
  assert.ok(physicalGrowth.every((size, index) => index === 0 || size > physicalGrowth[index - 1]), 'each phase must grow monotonically')
}

const lifecycle = phasePlants.flatMap((plants, phase) => phase === 0 ? plants : plants.slice(1))
for (const [index, plant] of lifecycle.entries()) {
  assert.deepEqual(blueprint(plant), blueprint(mature), 'phase changes must preserve the mature blueprint')
  assert.deepEqual(plant.bounds, mature.bounds, 'phase changes must preserve mature bounds')
  assert.deepEqual(plant.transform, mature.transform, 'phase changes must preserve the camera')
  assert.deepEqual(plant.skeleton.root, mature.skeleton.root, 'phase changes must preserve the root')
  if (index > 0) {
    const previous = lifecycle[index - 1]
    assert.ok(plant.skeleton.growthScale > previous.skeleton.growthScale, 'world growth scale must increase')
    assert.ok(plant.skeleton.branches.every((branch, branchIndex) =>
      branch.visibility >= previous.skeleton.branches[branchIndex].visibility
    ), 'visible structure must never regress')
  }
}

for (const phase of [0, 1, 2] as PlantPhase[]) {
  assert.deepEqual(
    generate({ ...config, phase, phaseProgress: 1 }),
    generate({ ...config, phase: (phase + 1) as PlantPhase, phaseProgress: 0 }),
    `phase ${phase} boundary must remain continuous`,
  )
}

const [seedling, structure, canopy, adult] = phasePlants.map((plants) => plants.at(-1)!)
assert.ok(visible(seedling).every((branch) => branch.depth === 0), 'seedling must remain trunk-only')
assert.equal(Math.max(...visible(structure).map((branch) => branch.depth)), 1, 'structure phase must contain only macro axes')
assert.ok(visibleWidth(structure) >= visibleWidth(adult) * 0.9, 'primary axes must define the mature silhouette')
assert.ok(visible(canopy).some((branch) => branch.depth >= 2), 'canopy must add secondary and tertiary structure')
assert.ok(leafCount(canopy) > 0 && leafCount(adult) > leafCount(canopy) * 1.8, 'maturity must substantially fill the crown')
assert.equal(visibleMicro(canopy).length, 0, 'terminal twigs must wait for maturity')
assert.ok(visibleMicro(adult).length > 0, 'maturity must reveal terminal twigs')
assert.ok([seedling, structure].every((plant) => leafCount(plant) === 0), 'early phases must remain leafless')
assert.deepEqual(
  adult.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  canopy.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  'maturity must preserve major branches',
)
assert.ok(
  phasePlants[3].map(leafCount).every((count, index, counts) => index === 0 || count > counts[index - 1]),
  'foliage must keep filling throughout maturity',
)
assert.ok(
  phasePlants[3].map(visibleMicro).map(({ length }) => length)
    .every((count, index, counts) => index === 0 || count >= counts[index - 1]),
  'terminal growth must never regress',
)

assert.ok(averageWidth(adult, 0) > averageWidth(adult, 1) * 2, 'trunk must be thicker than primary branches')
assert.ok(averageWidth(adult, 1) > averageWidth(adult, 2) * 1.5, 'primary branches must taper into secondary branches')
assert.ok(averageWidth(adult, 2) > averageWidth(adult, 3) * 1.35, 'secondary branches must taper into fine structure')
assert.ok(averageWidth(adult, 0) > averageWidth(phasePlants[3][0], 0) * 1.1, 'maturity must thicken the trunk')
assert.ok(averageWidth(adult, 1) > averageWidth(phasePlants[3][0], 1) * 1.1, 'maturity must thicken primary branches')

const narrow = generate({ ...config, branching: 0 })
const branched = generate({ ...config, branching: 1 })
assert.ok(branched.skeleton.branches.length > narrow.skeleton.branches.length * 3, 'branching must increase structural complexity')
assert.equal(new Set(narrow.skeleton.branches.filter((branch) => branch.depth === 1).map((branch) => branch.branchId)).size, 3)
assert.equal(new Set(branched.skeleton.branches.filter((branch) => branch.depth === 1).map((branch) => branch.branchId)).size, 7)
assert.ok(visibleWidth(branched) > visibleWidth(narrow) * 1.3, 'branching must broaden the macro structure')

const earlySparse = generate({ ...config, phase: 1, phaseProgress: 1, density: 0 })
const earlyDense = generate({ ...config, phase: 1, phaseProgress: 1, density: 1 })
assert.deepEqual(earlySparse.skeleton, earlyDense.skeleton, 'density must not alter early structure')
const sparse = generate({ ...config, density: 0 })
const dense = generate({ ...config, density: 1 })
assert.deepEqual(blueprint(sparse), blueprint(dense), 'density must fill rather than reshape the canonical tree')
assert.equal(leafCount(sparse), 0, 'zero density must remove foliage')
assert.equal(visibleMicro(sparse).length, 0, 'zero density must remove terminal twigs')
assert.equal(sparse.crown.ambientParticles.length, 0, 'zero density must not fake a crown with ambient noise')
assert.ok(visible(dense).length > visible(sparse).length && leafCount(dense) > 0, 'density must reveal fine structure and foliage')
const densityPlants = [0, 0.25, 0.5, 0.75, 1].map((density) => generate({ ...config, density }))
for (const metric of [
  (plant: ReturnType<typeof generate>) => visible(plant).filter((branch) => branch.depth >= 3).length,
  (plant: ReturnType<typeof generate>) => visibleMicro(plant).length,
  leafCount,
]) {
  assert.ok(
    densityPlants.map(metric).every((count, index, counts) => index === 0 || count > counts[index - 1]),
    'density sweep must strongly and monotonically add fine detail',
  )
}
assert.ok(leafCount(densityPlants.at(-1)!) > leafCount(densityPlants[1]) * 5, 'density range must be visually significant')

const locallyDense = generate({ ...config, branching: 0.2, density: 1 })
const structurallyComplex = generate({ ...config, branching: 1, density: 0.2 })
assert.ok(visible(structurallyComplex).length > visible(locallyDense).length * 1.8, 'branching must control architecture')
assert.ok(leafCount(locallyDense) > leafCount(structurallyComplex) * 4, 'density must independently control crown fill')
assert.ok(visibleMicro(locallyDense).length > visibleMicro(structurallyComplex).length * 3, 'density must independently control terminal twigs')

const curvatureConfig = { ...config, seed: 2572587950, branching: 1, density: 1 }
const curvatureSweep = [0, 0.25, 0.5, 0.75, 1].map((curvature) => generate({ ...curvatureConfig, curvature }))
assert.ok(curvatureSweep.every((plant) => JSON.stringify(topology(plant)) === JSON.stringify(topology(curvatureSweep[0]))), 'curvature must preserve topology')
const curvatureDeviation = curvatureSweep.map((plant) => average(plant.skeleton.branches.map((branch, index) =>
  Math.hypot(branch.x2 - curvatureSweep[0].skeleton.branches[index].x2, branch.y2 - curvatureSweep[0].skeleton.branches[index].y2))))
assert.ok(curvatureDeviation.every((value, index) => index === 0 || value > curvatureDeviation[index - 1]), 'curvature must progressively reshape branch paths')
assert.ok(curvatureDeviation.at(-1)! > 1, 'maximum curvature must create a clearly different silhouette')

const curved = curvatureSweep.at(-1)!
for (const segments of groupBranches(curved.skeleton.branches)) {
  for (let index = 1; index < segments.length; index += 1) {
    assert.ok(segments[index].branchProgress > segments[index - 1].branchProgress, 'branch progress must advance')
    const turn = degrees(angleDelta(direction(segments[index - 1]), direction(segments[index])))
    assert.ok(turn <= (segments[0].level === 1 ? 10 : 19), 'correlated curvature must stay smooth')
  }
}
assert.ok(curved.skeleton.branches.filter((branch) => branch.depth === 0).every((branch) =>
  degrees(angleDelta(Math.PI / 2, direction(branch))) <= 10 + 1e-9
), 'trunk must stay close to vertical')

const skeletonIds = new Set(mature.skeleton.branches.map((branch) => branch.id))
const allIds = new Set(allBranches(mature).map((branch) => branch.id))
assert.equal(allIds.size, allBranches(mature).length, 'every segment must have a unique id')
assert.ok(mature.skeleton.branches.every((branch) => branch.parentId === null || skeletonIds.has(branch.parentId)), 'structural parents must exist')
assert.ok(mature.crown.microBranches.every((branch) => branch.parentId !== null && allIds.has(branch.parentId)), 'micro-branch parents must exist')
const anchorIds = new Set(mature.skeleton.foliageAnchors.map((anchor) => anchor.id))
assert.ok(mature.crown.regions.every((region) => anchorIds.has(region.anchorId)), 'crown regions must remain attached to the tree')
assert.ok(mature.crown.regions.length <= 72, 'crown region count must stay bounded')
assert.ok(mature.crown.regions.every((region) => region.leaves.every((leaf) =>
  (leaf.x / region.radiusX) ** 2 + (leaf.y / region.radiusY) ** 2 <= 1 + Number.EPSILON
)), 'structural particles must stay inside crown regions')
const eligibleTerminalCount = mature.skeleton.foliageAnchors.filter((anchor) => anchor.terminal && anchor.depth >= 2).length
assert.equal(mature.crown.microBranches.length, eligibleTerminalCount * 6, 'terminal microstructure must stay linearly bounded')
assert.ok(mature.crown.ambientParticles.length <= AMBIENT_LIMIT && mature.crown.ambientParticles.length < leafCount(mature), 'ambient particles must remain subordinate')

const visualDepths = [
  ...mature.skeleton.branches.map((branch) => branch.depthVisual),
  ...mature.crown.microBranches.map((branch) => branch.depthVisual),
  ...mature.crown.regions.map((region) => region.depthVisual),
  ...mature.crown.regions.flatMap((region) => region.leaves.map((leaf) => leaf.depthVisual)),
]
assert.ok(visualDepths.every((depth) => depth >= 0 && depth <= 1), 'visual depth must stay normalized')
assert.ok(visualDepths.some((depth) => depth < 0.2) && visualDepths.some((depth) => depth > 0.8), 'tree must contain near and far layers')

const padding = 640 * 0.12
assert.equal(mature.transform.rootX, 320, 'root must be horizontally centered')
assert.equal(mature.transform.rootY, 640 - padding, 'root must sit one padding above the bottom')
const screenBounds = {
  minX: mature.transform.rootX + (mature.bounds.minX - mature.skeleton.root.x) * mature.transform.scale,
  minY: mature.transform.rootY - (mature.bounds.maxY - mature.skeleton.root.y) * mature.transform.scale,
  maxX: mature.transform.rootX + (mature.bounds.maxX - mature.skeleton.root.x) * mature.transform.scale,
  maxY: mature.transform.rootY - (mature.bounds.minY - mature.skeleton.root.y) * mature.transform.scale,
}
assert.ok(screenBounds.minX >= padding - 1e-9 && screenBounds.maxX <= 640 - padding + 1e-9, 'tree must fit horizontal padding')
assert.ok(screenBounds.minY >= padding - 1e-9 && screenBounds.maxY <= 640 - padding + 1e-9, 'tree must fit vertical padding')
assert.ok(phasePlants[0][0].skeleton.growthScale < mature.skeleton.growthScale * 0.5, 'stable camera must not enlarge a seedling')

const seedBlueprints = new Set<string>()
for (const seed of [1, 2, 3, 4, 5, 2572587950, 1658534288, 904200480]) {
  const seedConfig = { ...config, seed, branching: 1, density: 1, curvature: 1 }
  const plant = generate(seedConfig)
  const axes = groupBranches(plant.skeleton.branches)
  const primary = axes.filter((segments) => segments[0].depth === 1)
  const primaryOrigins = primary.map((segments) => segments[0].y1.toFixed(6))
  const sides = new Set(primary.map((segments) => Math.sign(segments[0].x2 - segments[0].x1)))
  const launchBins = new Set(primary.map((segments) => Math.round(
    degrees(Math.asin(Math.abs(Math.sin(direction(segments[0]))))) / 10,
  )))
  const branchById = new Map(plant.skeleton.branches.map((branch) => [branch.id, branch]))
  const splitBins = new Map<number, number>()
  for (const segments of axes.filter((branch) => branch[0].depth > 1)) {
    const parent = branchById.get(segments[0].parentId!)!
    const bin = Math.round(degrees(angleDelta(direction(parent), direction(segments[0]))) / 10)
    splitBins.set(bin, (splitBins.get(bin) ?? 0) + 1)
  }
  const dominantSplit = Math.max(...splitBins.values()) / [...splitBins.values()].reduce((total, count) => total + count, 0)
  const height = plant.bounds.maxY - plant.bounds.minY
  const width = plant.bounds.maxX - plant.bounds.minX
  const upperAnchors = plant.skeleton.foliageAnchors.filter((anchor) => anchor.y >= plant.bounds.minY + height * 0.55)

  assert.ok(plant.skeleton.branches.length < 1500, `seed ${seed}: structural generation must stay bounded`)
  assert.equal(new Set(primaryOrigins).size, primary.length, `seed ${seed}: primary origins must not form paired tiers`)
  assert.deepEqual([...sides].sort(), [-1, 1], `seed ${seed}: primary axes must occupy both sides`)
  assert.ok(launchBins.size >= 2, `seed ${seed}: launch angles must vary`)
  assert.ok(dominantSplit < 0.45, `seed ${seed}: no fixed split angle may dominate the tree`)
  assert.ok(width >= height * 0.65 && width <= height * 1.25, `seed ${seed}: broadleaf silhouette must remain composed`)
  assert.ok(span(upperAnchors.map((anchor) => anchor.x)) >= height * 0.45, `seed ${seed}: upper crown must spread horizontally`)
  assert.ok(primary.every((segments) => segments.at(-1)!.y2 > segments[0].y1), `seed ${seed}: primary tips must finish above their origin`)
  assert.ok(axes.filter((segments) => segments[0].depth === 2)
    .every((segments) => segments.at(-1)!.y2 > segments[0].y1), `seed ${seed}: secondary tips must finish above their origin`)
  assert.ok(activeRegions(plant).length > 0 && leafCount(plant) > 0 && visibleMicro(plant).length > 0, `seed ${seed}: mature crown must contain foliage and twigs`)

  const structurePlant = generate({ ...seedConfig, phase: 1, phaseProgress: 1 })
  assert.ok(visibleWidth(structurePlant) >= visibleWidth(plant) * 0.9, `seed ${seed}: primary structure must establish the silhouette`)
  for (const phase of [0, 1, 2] as PlantPhase[]) {
    assert.deepEqual(
      generate({ ...seedConfig, phase, phaseProgress: 1 }),
      generate({ ...seedConfig, phase: (phase + 1) as PlantPhase, phaseProgress: 0 }),
      `seed ${seed}: phase ${phase} boundary must remain continuous`,
    )
  }
  seedBlueprints.add(JSON.stringify(blueprint(plant)))
}
assert.equal(seedBlueprints.size, 8, 'different seeds must produce unique trees')

console.log('plant checks passed', {
  visibleByPhase: [seedling, structure, canopy, adult].map((plant) => visible(plant).length),
  leavesByPhase: [seedling, structure, canopy, adult].map(leafCount),
})
