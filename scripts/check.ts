import { strict as assert } from 'node:assert'
import { generateCrown, generateSkeleton } from '../src/plant/generator.ts'
import type { BranchLevel, BranchSegment, PlantConfig, PlantPhase } from '../src/plant/types.ts'
import { computeBounds, computeViewTransform } from '../src/plant/view.ts'

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
const microLength = (plant: ReturnType<typeof generate>) => plant.crown.microBranches
  .reduce((total, branch) => total + Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1) * branch.visibility, 0)
const allBranches = (plant: ReturnType<typeof generate>) => [...plant.skeleton.branches, ...plant.crown.microBranches]
const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
const averageWidth = (plant: ReturnType<typeof generate>, level: BranchLevel) => {
  const branches = plant.skeleton.branches.filter((branch) => branch.level === level)
  return branches.reduce((total, branch) => total + branch.width, 0) / branches.length
}
const topology = (plant: ReturnType<typeof generate>) => allBranches(plant)
  .map(({ id, parentId, branchId, depth, level }) => ({ id, parentId, branchId, depth, level }))
const groupBranches = (branches: BranchSegment[]) => {
  const groups = new Map<number, BranchSegment[]>()
  for (const branch of branches) groups.set(branch.branchId, [...(groups.get(branch.branchId) ?? []), branch])
  return [...groups.values()].map((segments) => segments.sort((left, right) => left.branchProgress - right.branchProgress))
}
const direction = (branch: BranchSegment) => Math.atan2(branch.y2 - branch.y1, branch.x2 - branch.x1)
const angleDelta = (left: number, right: number) => Math.atan2(Math.sin(right - left), Math.cos(right - left))
const grownLength = (plant: ReturnType<typeof generate>, minimumDepth = 0) => plant.skeleton.branches
  .filter((branch) => branch.depth >= minimumDepth)
  .reduce((total, branch) => total + Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1) * branch.visibility, 0)
const blueprint = (plant: ReturnType<typeof generate>) => ({
  branches: plant.skeleton.branches.map(({ visibility: _visibility, width: _width, ...branch }) => branch),
  anchors: plant.skeleton.foliageAnchors.map(({ visibility: _visibility, ...anchor }) => anchor),
  microBranches: plant.crown.microBranches.map(({ visibility: _visibility, width: _width, ...branch }) => branch),
  regions: plant.crown.regions.map(({ visibility: _visibility, vitality: _vitality, leaves: _leaves, ...region }) => region),
})
const visibleWidth = (plant: ReturnType<typeof generate>) => {
  const points = visible(plant).flatMap((branch) => [
    branch.x1,
    branch.x1 + (branch.x2 - branch.x1) * branch.visibility,
  ])
  return Math.max(...points) - Math.min(...points)
}

const mature = generate(config)
assert.deepEqual(mature, generate(config), 'same config must be deterministic')
assert.deepEqual(mature, generate(JSON.parse(JSON.stringify(config)) as PlantConfig), 'JSON config must preserve the result')
assert.deepEqual(mature, generate({ ...config, phase: 99 as PlantPhase, phaseProgress: 2 }), 'JSON inputs must clamp to supported lifecycle bounds')
assert.notDeepEqual(blueprint(mature), blueprint(generate({ ...config, seed: 54321 })), 'seed must change the tree blueprint')

const phasePlants = ([0, 1, 2, 3] as PlantPhase[]).map((phase) =>
  [0, 0.25, 0.5, 0.75, 1].map((phaseProgress) => generate({ ...config, phase, phaseProgress })))
for (const plants of phasePlants) {
  const physicalGrowth = plants.map((plant) => grownLength(plant) * plant.skeleton.growthScale)
  assert.ok(physicalGrowth.every((size, index) => index === 0 || size > physicalGrowth[index - 1]), 'phaseProgress must grow the plant')
}

const lifecycle = phasePlants.flatMap((plants, phase) => phase === 0 ? plants : plants.slice(1))
for (const [index, plant] of lifecycle.entries()) {
  assert.deepEqual(blueprint(plant), blueprint(mature), 'phase changes must keep the potential tree')
  assert.deepEqual(plant.bounds, mature.bounds, 'phase changes must keep mature bounds')
  assert.deepEqual(plant.transform, mature.transform, 'phase changes must keep the camera')
  assert.deepEqual(plant.skeleton.root, mature.skeleton.root, 'phase changes must keep the root')
  if (index > 0) {
    const previous = lifecycle[index - 1]
    assert.ok(plant.skeleton.growthScale > previous.skeleton.growthScale, 'world scale must preserve physical growth')
    assert.ok(plant.skeleton.branches.every((branch, branchIndex) =>
      branch.visibility >= previous.skeleton.branches[branchIndex].visibility
    ), 'old branches must never regress')
  }
}

for (const phase of [0, 1, 2] as PlantPhase[]) {
  assert.deepEqual(
    generate({ ...config, phase, phaseProgress: 1 }),
    generate({ ...config, phase: (phase + 1) as PlantPhase, phaseProgress: 0 }),
    `phase ${phase} boundary must be continuous`,
  )
}

const phaseEnds = phasePlants.map((plants) => plants.at(-1)!)
const [seedling, structure, canopy, adult] = phaseEnds
const seedlingTrunk = visible(seedling).filter((branch) => branch.depth === 0).length
assert.ok(visible(seedling).filter((branch) => branch.depth > 0).length < seedlingTrunk * 0.15, 'phase 0 must remain trunk-first')
assert.equal(Math.max(...visible(structure).map((branch) => branch.depth)), 1, 'phase 1 must form only the macro structure')
assert.ok(visibleWidth(structure) >= visibleWidth(adult) * 0.75, 'phase 1 must establish the mature silhouette')
assert.ok(grownLength(canopy, 2) > 0, 'phase 2 must add secondary branches')
assert.ok(leafCount(canopy) > 0 && leafCount(adult) > leafCount(canopy) * 2, 'maturity must substantially fill the crown')
assert.equal(visibleMicro(canopy).length, 0, 'canopy must leave terminal twigs for maturity')
assert.ok(visibleMicro(adult).length > 0 && microLength(adult) > 0, 'maturity must reveal terminal twigs')
assert.ok(
  Math.max(...visibleMicro(adult).map((branch) => branch.depth)) > Math.max(...visible(adult).map((branch) => branch.depth)),
  'terminal twigs must extend the branching hierarchy',
)
assert.ok([seedling, structure].every((plant) => leafCount(plant) === 0), 'early phases must not create a mature crown')
assert.deepEqual(
  adult.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  canopy.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  'maturity must not add new major branches',
)
const richCanopy = generate({ ...config, seed: 1, phase: 3, phaseProgress: 0 })
const richAdult = generate({ ...config, seed: 1, phase: 3, phaseProgress: 1 })
assert.ok(grownLength(richAdult, 4) > grownLength(richCanopy, 4), 'phase 3 must reveal fine detail')
assert.ok(
  phasePlants[3].map(leafCount).every((count, index, counts) => index === 0 || count > counts[index - 1]),
  'mature foliage must keep filling throughout phase 3',
)
assert.ok(
  phasePlants[3].map(microLength).every((length, index, lengths) => index === 0 || length >= lengths[index - 1]),
  'mature terminal growth must never regress',
)

assert.ok(averageWidth(adult, 0) > averageWidth(adult, 1) * 2, 'trunk must remain substantially thicker than primary branches')
assert.ok(averageWidth(adult, 1) > averageWidth(adult, 2) * 1.5, 'primary branches must taper into secondary branches')
assert.ok(averageWidth(adult, 2) > averageWidth(adult, 3) * 1.4, 'secondary branches must taper into fine structure')
assert.ok(averageWidth(adult, 0) > averageWidth(phasePlants[3][0], 0) * 1.1, 'maturity must thicken the trunk')
assert.ok(averageWidth(adult, 1) > averageWidth(phasePlants[3][0], 1) * 1.15, 'maturity must thicken primary branches')

const narrow = generate({ ...config, branching: 0 })
const branched = generate({ ...config, branching: 1 })
assert.ok(
  visible(branched).length > visible(narrow).length && visibleWidth(branched) > visibleWidth(narrow) * 2,
  'branching must shape the macro structure',
)
const earlySparse = generate({ ...config, phase: 1, phaseProgress: 1, density: 0 })
const earlyDense = generate({ ...config, phase: 1, phaseProgress: 1, density: 1 })
assert.deepEqual(earlySparse.skeleton, earlyDense.skeleton, 'density must not alter early structure')
const sparse = generate({ ...config, density: 0 })
const dense = generate({ ...config, density: 1 })
assert.ok(visible(dense).length > visible(sparse).length, 'density must reveal more fine branches')
assert.equal(leafCount(sparse), 0, 'zero density must remove foliage')
assert.equal(visibleMicro(sparse).length, 0, 'zero density must remove terminal twigs')
assert.equal(sparse.crown.ambientParticles.length, 0, 'zero density must not fake a crown with ambient noise')
assert.ok(leafCount(dense) > leafCount(adult), 'density must fill the mature crown')
assert.deepEqual(blueprint(sparse), blueprint(dense), 'density must fill, not reshape, the canonical tree')
const densityPlants = [0, 0.25, 0.5, 0.75, 1].map((density) => generate({ ...config, density }))
assert.ok(
  densityPlants.map(visibleMicro).map(({ length }) => length)
    .every((count, index, counts) => index === 0 || count > counts[index - 1]),
  'density must strongly and monotonically increase terminal twigs',
)
assert.ok(
  densityPlants.map(leafCount).every((count, index, counts) => index === 0 || count > counts[index - 1]),
  'density must strongly and monotonically increase structural particles',
)
assert.ok(
  densityPlants.map(activeRegions).map(({ length }) => length)
    .every((count, index, counts) => index === 0 || count >= counts[index - 1]),
  'density must never reduce active crown regions',
)
assert.ok(leafCount(densityPlants.at(-1)!) > leafCount(densityPlants[1]) * 5, 'density range must be visually significant')

const locallyDense = generate({ ...config, branching: 0.2, density: 1 })
const structurallyComplex = generate({ ...config, branching: 1, density: 0.2 })
assert.ok(visible(structurallyComplex).length > visible(locallyDense).length * 3, 'branching must control structural complexity')
assert.ok(
  leafCount(locallyDense) / activeRegions(locallyDense).length > leafCount(structurallyComplex) / activeRegions(structurallyComplex).length * 3,
  'density must control local crown fill independently of branching',
)
assert.ok(
  visibleMicro(locallyDense).length / activeRegions(locallyDense).length > visibleMicro(structurallyComplex).length / activeRegions(structurallyComplex).length * 3,
  'density must control local twig fill independently of branching',
)
const straight = generate({ ...config, curvature: 0 })
const curved = generate({ ...config, curvature: 1 })
assert.notDeepEqual(blueprint(straight), blueprint(curved), 'curvature must change the stable blueprint')
assert.deepEqual(topology(straight), topology(curved), 'curvature must bend existing branches without changing topology')
assert.ok(allBranches(straight).every((branch) => branch.bendStrength === 0), 'zero curvature must remove branch bend')
assert.deepEqual([...new Set(allBranches(curved).map((branch) => branch.level))].sort(), [0, 1, 2, 3, 4], 'mature tree must expose every branch level')

const curvedBranches = allBranches(curved)
const curvedById = new Map(curvedBranches.map((branch) => [branch.id, branch]))
assert.equal(curvedById.size, curvedBranches.length, 'every segment must have a unique id')
assert.ok(curvedBranches.every((branch) => branch.parentId === null || curvedById.has(branch.parentId)), 'every child segment must reference an existing parent')
const bendByLevel = ([0, 1, 2, 3, 4] as BranchLevel[]).map((level) =>
  average(curvedBranches.filter((branch) => branch.level === level).map((branch) => branch.bendStrength)))
assert.ok(bendByLevel.every((bend, index) => index === 0 || bend > bendByLevel[index - 1]), 'curvature must become stronger toward terminal levels')
const lengthByLevel = ([0, 1, 2, 3, 4] as BranchLevel[]).map((level) =>
  average(curvedBranches.filter((branch) => branch.level === level)
    .map((branch) => Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1))))
assert.ok(lengthByLevel.every((length, index) => index === 0 || length < lengthByLevel[index - 1]), 'segments must become shorter toward terminal levels')
const widthByLevel = ([0, 1, 2, 3, 4] as BranchLevel[]).map((level) =>
  average(curvedBranches.filter((branch) => branch.level === level).map((branch) => branch.width)))
assert.ok(widthByLevel.every((width, index) => index === 0 || width < widthByLevel[index - 1]), 'segments must become thinner toward terminal levels')

let taperedBranches = 0
for (const segments of groupBranches(curvedBranches)) {
  const first = segments[0]
  assert.ok(segments.every((branch) =>
    branch.baseDirection === first.baseDirection
    && branch.bendDirection === first.bendDirection
    && branch.bendStrength === first.bendStrength
    && branch.level === first.level
  ), 'each branch must keep one seeded bend character')
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]
    const branch = segments[index]
    assert.ok(branch.branchProgress > previous.branchProgress, 'branch progress must move forward')
    assert.ok(branch.width <= previous.width, 'each branch must taper toward its tip')
    assert.ok(angleDelta(direction(previous), direction(branch)) * branch.bendDirection >= -1e-10, 'each branch must follow one smooth bend instead of zigzagging')
    if (branch.width < previous.width) taperedBranches += 1
  }
}
assert.ok(taperedBranches > 0, 'within-branch taper must be observable')

const curvatureSweep = [0, 0.25, 0.5, 0.75, 1].map((curvature) => generate({ ...config, curvature }))
assert.ok(curvatureSweep.every((plant) => JSON.stringify(topology(plant)) === JSON.stringify(topology(curvatureSweep[0]))), 'curvature sweep must preserve hierarchy and branch count')
assert.ok(curvatureSweep.map((plant) => average(allBranches(plant).map((branch) => branch.bendStrength)))
  .every((bend, index, bends) => index === 0 || bend > bends[index - 1]), 'curvature sweep must progressively increase smooth bend')
const lowVitality = generate({ ...config, vitality: 0 })
const highVitality = generate({ ...config, vitality: 1 })
assert.deepEqual(lowVitality.skeleton, highVitality.skeleton, 'vitality must not change the skeleton')
assert.ok(leafCount(highVitality) > leafCount(lowVitality), 'vitality must affect foliage')
assert.ok(highVitality.crown.ambientParticles.length > lowVitality.crown.ambientParticles.length, 'vitality must affect crown particles')

const terminalIds = new Set(mature.skeleton.foliageAnchors.filter((anchor) => anchor.terminal).map((anchor) => anchor.id))
assert.equal(mature.crown.regions.length, terminalIds.size, 'each terminal point must define one crown region')
assert.ok(mature.crown.regions.every((region) => terminalIds.has(region.anchorId)), 'crown regions must stay attached to terminal points')
assert.ok(mature.crown.regions.every((region) => region.leaves.every((leaf) =>
  (leaf.x / region.radiusX) ** 2 + (leaf.y / region.radiusY) ** 2 <= 1 + Number.EPSILON
)), 'structural particles must remain inside their crown region')
const visualDepths = [
  ...mature.skeleton.branches.map((branch) => branch.depthVisual),
  ...mature.crown.microBranches.map((branch) => branch.depthVisual),
  ...mature.crown.regions.map((region) => region.depthVisual),
  ...mature.crown.regions.flatMap((region) => region.leaves.map((leaf) => leaf.depthVisual)),
]
assert.ok(visualDepths.every((depth) => depth >= 0 && depth <= 1), 'visual depth must stay normalized')
assert.ok(visualDepths.some((depth) => depth < 0.2) && visualDepths.some((depth) => depth > 0.8), 'tree must contain near and far visual layers')
assert.equal(mature.crown.microBranches.length, terminalIds.size * 10, 'microstructure must stay linearly bounded per terminal point')
assert.ok(mature.crown.ambientParticles.length <= 18 && mature.crown.ambientParticles.length < leafCount(mature), 'ambient particles must remain subordinate')

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
assert.ok(phasePlants[0][0].skeleton.growthScale < mature.skeleton.growthScale * 0.5, 'fit-to-view must not enlarge a seedling')

const seedBlueprints = new Set<string>()
for (const seed of [1, 2, 3, 4, 5]) {
  const plant = generate({ ...config, seed })
  const stages = ([0, 1, 2, 3] as PlantPhase[]).map((phase) => generate({ ...config, seed, phase, phaseProgress: 1 }))
  const bounds = plant.bounds
  const height = bounds.maxY - bounds.minY
  const points = plant.skeleton.branches.flatMap((branch) => [[branch.x1, branch.y1], [branch.x2, branch.y2]])
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  const upperWidth = span(points.filter(([, y]) => y >= bounds.minY + height * 0.6).map(([x]) => x))
  const lowerWidth = span(points.filter(([, y]) => y < bounds.minY + height * 0.6).map(([x]) => x))
  const trunk = plant.skeleton.branches.filter((branch) => branch.level === 0)
  const terminal = allBranches(plant).filter((branch) => branch.level === 4)
  assert.ok(plant.skeleton.branches.every((branch) => branch.level === Math.min(branch.depth, 4)), `seed ${seed}: hierarchy must follow structural depth`)
  assert.ok(plant.crown.microBranches.every((branch) => branch.level === 4), `seed ${seed}: crown twigs must be terminal level`)
  assert.ok(trunk.every((branch) => Math.abs(angleDelta(Math.PI / 2, direction(branch))) <= 12 * Math.PI / 180 + 1e-10), `seed ${seed}: trunk must stay within its vertical limit`)
  assert.ok(average(terminal.map((branch) => branch.bendStrength)) > average(trunk.map((branch) => branch.bendStrength)) * 8, `seed ${seed}: terminal growth must be much more organic than the trunk`)
  for (const segments of groupBranches(trunk)) {
    assert.ok(segments.slice(1).every((branch, index) =>
      angleDelta(direction(segments[index]), direction(branch)) * branch.bendDirection >= -1e-10
    ), `seed ${seed}: trunk must bend smoothly without reversals`)
  }
  assert.ok(plant.skeleton.branches.filter((branch) => branch.depth <= 2).every((branch) => branch.y2 >= branch.y1), `seed ${seed}: major branches must grow upward`)
  assert.ok(bounds.maxX - bounds.minX <= height * 1.25, `seed ${seed}: silhouette must remain composed`)
  assert.ok(upperWidth > lowerWidth, `seed ${seed}: crown must widen toward the top`)
  assert.ok(stages.map((stage) => grownLength(stage) * stage.skeleton.growthScale)
    .every((size, index, sizes) => index === 0 || size > sizes[index - 1]), `seed ${seed}: lifecycle must grow monotonically`)
  assert.ok(stages.slice(0, 2).every((stage) => leafCount(stage) === 0), `seed ${seed}: early phases must stay leafless`)
  assert.ok(leafCount(stages[2]) > 0 && leafCount(stages[3]) > leafCount(stages[2]), `seed ${seed}: crown must mature late`)
  assert.ok(activeRegions(stages[3]).length > 0 && visibleMicro(stages[3]).length > 0, `seed ${seed}: mature crown must have regions and terminal twigs`)
  assert.ok(stages[3].crown.ambientParticles.length < leafCount(stages[3]), `seed ${seed}: ambient particles must not define the crown`)
  assert.ok(visible(stages[0]).filter((branch) => branch.depth > 0).length < visible(stages[0]).filter((branch) => branch.depth === 0).length * 0.15, `seed ${seed}: seedling must stay trunk-first`)
  assert.ok(visibleWidth(stages[1]) >= visibleWidth(stages[3]) * 0.75, `seed ${seed}: structure phase must define the silhouette`)
  assert.ok(stages.slice(1).every((stage, stageIndex) => stage.skeleton.branches.every((branch, branchIndex) =>
    branch.visibility >= stages[stageIndex].skeleton.branches[branchIndex].visibility
  )), `seed ${seed}: old branches must survive every phase`)
  assert.deepEqual(
    stages[3].skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
    stages[2].skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
    `seed ${seed}: maturity must preserve major branches`,
  )
  assert.equal(
    stages[3].crown.microBranches.length,
    stages[3].skeleton.foliageAnchors.filter((anchor) => anchor.terminal).length * 10,
    `seed ${seed}: microstructure must remain bounded`,
  )
  for (const phase of [0, 1, 2] as PlantPhase[]) {
    assert.deepEqual(
      generate({ ...config, seed, phase, phaseProgress: 1 }),
      generate({ ...config, seed, phase: (phase + 1) as PlantPhase, phaseProgress: 0 }),
      `seed ${seed}: phase ${phase} boundary must be continuous`,
    )
  }
  seedBlueprints.add(JSON.stringify(blueprint(plant)))
}
assert.equal(seedBlueprints.size, 5, 'different seeds must create unique trees')

console.log('plant checks passed', {
  visibleByPhase: phaseEnds.map((plant) => visible(plant).length),
  leavesByPhase: phaseEnds.map(leafCount),
})
