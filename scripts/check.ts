import { strict as assert } from 'node:assert'
import { generateFoliage, generateSkeleton } from '../src/plant/generator.ts'
import type { PlantConfig, PlantPhase } from '../src/plant/types.ts'
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
  const bounds = computeBounds(skeleton.branches)
  return {
    skeleton,
    foliage: generateFoliage(skeleton, plantConfig),
    bounds,
    transform: computeViewTransform(bounds, skeleton.root, { width: 640, height: 640 }, 0.12),
  }
}
const visible = (plant: ReturnType<typeof generate>) => plant.skeleton.branches.filter((branch) => branch.visibility > 0)
const leafCount = (plant: ReturnType<typeof generate>) =>
  plant.foliage.reduce((total, cluster) => total + cluster.leaves.length, 0)
const grownLength = (plant: ReturnType<typeof generate>, minimumDepth = 0) => plant.skeleton.branches
  .filter((branch) => branch.depth >= minimumDepth)
  .reduce((total, branch) => total + Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1) * branch.visibility, 0)
const blueprint = (plant: ReturnType<typeof generate>) => ({
  branches: plant.skeleton.branches.map(({ visibility: _visibility, width: _width, ...branch }) => branch),
  anchors: plant.skeleton.foliageAnchors.map(({ visibility: _visibility, ...anchor }) => anchor),
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
assert.ok(leafCount(canopy) > 0 && leafCount(adult) > leafCount(canopy), 'late phases must develop foliage')
assert.ok([seedling, structure].every((plant) => leafCount(plant) === 0), 'early phases must not create a mature crown')
assert.deepEqual(
  adult.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  canopy.skeleton.branches.filter((branch) => branch.depth <= 2).map(({ visibility }) => visibility),
  'maturity must not add new major branches',
)
const richCanopy = generate({ ...config, seed: 1, phase: 3, phaseProgress: 0 })
const richAdult = generate({ ...config, seed: 1, phase: 3, phaseProgress: 1 })
assert.ok(grownLength(richAdult, 4) > grownLength(richCanopy, 4), 'phase 3 must reveal fine detail')

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
assert.ok(leafCount(dense) > leafCount(adult), 'density must fill the mature crown')
const straight = generate({ ...config, curvature: 0 })
const curved = generate({ ...config, curvature: 1 })
assert.notDeepEqual(blueprint(straight), blueprint(curved), 'curvature must change the stable blueprint')
const lowVitality = generate({ ...config, vitality: 0 })
const highVitality = generate({ ...config, vitality: 1 })
assert.deepEqual(lowVitality.skeleton, highVitality.skeleton, 'vitality must not change the skeleton')
assert.ok(leafCount(highVitality) > leafCount(lowVitality), 'vitality must affect foliage')

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
  assert.ok(plant.skeleton.branches.filter((branch) => branch.depth <= 2).every((branch) => branch.y2 >= branch.y1), `seed ${seed}: major branches must grow upward`)
  assert.ok(bounds.maxX - bounds.minX <= height * 1.25, `seed ${seed}: silhouette must remain composed`)
  assert.ok(upperWidth > lowerWidth, `seed ${seed}: crown must widen toward the top`)
  assert.ok(stages.map((stage) => grownLength(stage) * stage.skeleton.growthScale)
    .every((size, index, sizes) => index === 0 || size > sizes[index - 1]), `seed ${seed}: lifecycle must grow monotonically`)
  assert.ok(stages.slice(0, 2).every((stage) => leafCount(stage) === 0), `seed ${seed}: early phases must stay leafless`)
  assert.ok(leafCount(stages[2]) > 0 && leafCount(stages[3]) > leafCount(stages[2]), `seed ${seed}: crown must mature late`)
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
