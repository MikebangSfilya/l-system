import { strict as assert } from 'node:assert'
import { generatePlant } from '../src/plant/generator.ts'
import type { PlantConfig } from '../src/plant/types.ts'

const config: PlantConfig = {
  growth: 0.5,
  branching: 0.6,
  density: 0.7,
  curvature: 0.3,
  vitality: 0.9,
  seed: 12345,
}

assert.deepEqual(generatePlant(config), generatePlant(config), 'same config must be deterministic')
assert.notDeepEqual(generatePlant(config), generatePlant({ ...config, seed: 54321 }), 'seed must change geometry')

const stagePlants = [0.1, 0.25, 0.5, 0.75, 1].map((growth) => generatePlant({ ...config, growth }))
const stages = stagePlants.map((plant) => plant.branches.length)
const heights = stagePlants.map((plant) => Math.max(...plant.branches.map((branch) =>
  branch.y1 + (branch.y2 - branch.y1) * branch.visibility
)))
assert.ok(stages.every((count, index) => index === 0 || count > stages[index - 1]), 'each growth stage must add branches')
assert.ok(heights.every((height, index) => index === 0 || height > heights[index - 1]), 'each growth stage must be taller')
assert.ok(stages.at(-1)! > stages[0] * 8, 'mature tree must be structurally richer than a seedling')

const narrow = generatePlant({ ...config, growth: 1, branching: 0 })
const branched = generatePlant({ ...config, growth: 1, branching: 1 })
assert.ok(
  branched.branches.length > narrow.branches.length &&
    branched.bounds.maxX - branched.bounds.minX > (narrow.bounds.maxX - narrow.bounds.minX) * 2,
  'branching must add structure',
)

const sparse = generatePlant({ ...config, growth: 1, density: 0 })
const dense = generatePlant({ ...config, growth: 1, density: 1 })
assert.ok(dense.branches.length > sparse.branches.length && dense.leaves.length > sparse.leaves.length, 'density must fill the crown')

const lowVitality = generatePlant({ ...config, growth: 1, vitality: 0 })
const highVitality = generatePlant({ ...config, growth: 1, vitality: 1 })
assert.deepEqual(lowVitality.branches, highVitality.branches, 'vitality must not change the skeleton')
assert.ok(
  highVitality.leaves.length > lowVitality.leaves.length,
  'vitality must add leaves',
)

console.log('plant checks passed', { stages, heights: heights.map((height) => height.toFixed(1)) })
