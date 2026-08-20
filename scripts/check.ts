import { strict as assert } from 'node:assert'
import { generateFoliage, generateSkeleton } from '../src/plant/generator.ts'
import type { PlantConfig } from '../src/plant/types.ts'

const config: PlantConfig = {
  growth: 0.5,
  branching: 0.6,
  density: 0.7,
  curvature: 0.3,
  vitality: 0.9,
  seed: 12345,
}

const generate = (plantConfig: PlantConfig) => {
  const skeleton = generateSkeleton(plantConfig)
  return { skeleton, foliage: generateFoliage(skeleton, plantConfig) }
}
const leafCount = (plant: ReturnType<typeof generate>) =>
  plant.foliage.reduce((total, cluster) => total + cluster.leaves.length, 0)

assert.deepEqual(generate(config), generate(config), 'same config must be deterministic')
assert.notDeepEqual(generate(config), generate({ ...config, seed: 54321 }), 'seed must change the plant')

const stagePlants = [0.1, 0.25, 0.5, 0.75, 1].map((growth) => generate({ ...config, growth }))
const stages = stagePlants.map((plant) => plant.skeleton.branches.length)
const heights = stagePlants.map((plant) => Math.max(...plant.skeleton.branches.map((branch) =>
  branch.y1 + (branch.y2 - branch.y1) * branch.visibility
)))
assert.ok(stages.every((count, index) => index === 0 || count > stages[index - 1]), 'each growth stage must add branches')
assert.ok(heights.every((height, index) => index === 0 || height > heights[index - 1]), 'each growth stage must be taller')
assert.ok(stages.at(-1)! > stages[0] * 8, 'mature tree must be structurally richer than a seedling')
assert.equal(leafCount(stagePlants[0]), 0, 'a seedling must not have a mature crown')
assert.ok(leafCount(stagePlants.at(-1)!) > leafCount(stagePlants[2]) * 2, 'foliage must develop with growth')

const narrow = generateSkeleton({ ...config, growth: 1, branching: 0 })
const branched = generateSkeleton({ ...config, growth: 1, branching: 1 })
assert.ok(
  branched.branches.length > narrow.branches.length &&
    branched.bounds.maxX - branched.bounds.minX > (narrow.bounds.maxX - narrow.bounds.minX) * 2,
  'branching must add structure',
)

const sparse = generate({ ...config, growth: 1, density: 0 })
const dense = generate({ ...config, growth: 1, density: 1 })
assert.ok(dense.skeleton.branches.length < sparse.skeleton.branches.length * 1.5, 'density must not dominate the skeleton')
assert.equal(leafCount(sparse), 0, 'zero density must remove foliage')
assert.ok(leafCount(dense) > 0, 'density must fill the crown')

const lowVitality = generate({ ...config, growth: 1, vitality: 0 })
const highVitality = generate({ ...config, growth: 1, vitality: 1 })
assert.deepEqual(lowVitality.skeleton, highVitality.skeleton, 'vitality must not change the skeleton')
assert.ok(
  leafCount(highVitality) > leafCount(lowVitality),
  'vitality must add leaves',
)
assert.ok(dense.foliage.every((cluster) => cluster.leaves.length >= 3), 'foliage must form clusters')

console.log('plant checks passed', { stages, heights: heights.map((height) => height.toFixed(1)) })
