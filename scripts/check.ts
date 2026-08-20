import { strict as assert } from 'node:assert'
import { generateFoliage, generateSkeleton } from '../src/plant/generator.ts'
import type { PlantConfig } from '../src/plant/types.ts'
import { computeBounds, computeViewTransform } from '../src/plant/view.ts'

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
  const bounds = computeBounds(skeleton.branches)
  return {
    skeleton,
    foliage: generateFoliage(skeleton, plantConfig),
    bounds,
    transform: computeViewTransform(bounds, skeleton.root, { width: 640, height: 640 }, 0.12),
  }
}
const leafCount = (plant: ReturnType<typeof generate>) =>
  plant.foliage.reduce((total, cluster) => total + cluster.leaves.length, 0)

assert.deepEqual(generate(config), generate(config), 'same config must be deterministic')
assert.notDeepEqual(generate(config), generate({ ...config, seed: 54321 }), 'seed must change the plant')

const stagePlants = [0.1, 0.25, 0.5, 0.75, 1].map((growth) => generate({ ...config, growth }))
const stages = stagePlants.map((plant) => plant.skeleton.branches.filter((branch) => branch.visibility > 0).length)
const heights = stagePlants.map((plant) => Math.max(0, ...plant.skeleton.branches
  .filter((branch) => branch.visibility > 0)
  .map((branch) => branch.y1 + (branch.y2 - branch.y1) * branch.visibility)
) * plant.skeleton.growthScale)
assert.ok(stagePlants.every((plant) => plant.skeleton.branches.length === stagePlants[0].skeleton.branches.length), 'growth must keep the full canonical skeleton')
for (const plant of stagePlants) {
  assert.deepEqual(
    plant.skeleton.branches.map(({ visibility: _visibility, ...branch }) => branch),
    stagePlants[0].skeleton.branches.map(({ visibility: _visibility, ...branch }) => branch),
    'growth must keep canonical geometry',
  )
  assert.deepEqual(plant.bounds, stagePlants[0].bounds, 'growth must keep mature bounds')
  assert.deepEqual(plant.transform, stagePlants[0].transform, 'growth must keep the camera')
  assert.deepEqual(plant.skeleton.root, stagePlants[0].skeleton.root, 'growth must keep the root')
}
assert.ok(stages.every((count, index) => index === 0 || count > stages[index - 1]), 'each growth stage must add branches')
assert.ok(heights.every((height, index) => index === 0 || height > heights[index - 1]), 'each growth stage must be taller')
assert.ok(stages.at(-1)! > stages[0] * 8, 'mature tree must be structurally richer than a seedling')
assert.equal(leafCount(stagePlants[0]), 0, 'a seedling must not have a mature crown')
assert.ok(leafCount(stagePlants.at(-1)!) > leafCount(stagePlants[2]) * 2, 'foliage must develop with growth')

const narrow = generateSkeleton({ ...config, growth: 1, branching: 0 })
const branched = generateSkeleton({ ...config, growth: 1, branching: 1 })
const branchLengths = branched.branches.map((branch) => Math.hypot(branch.x2 - branch.x1, branch.y2 - branch.y1))
const narrowBounds = computeBounds(narrow.branches)
const branchedBounds = computeBounds(branched.branches)
assert.ok(
  branched.branches.length > narrow.branches.length &&
    branchedBounds.maxX - branchedBounds.minX > (narrowBounds.maxX - narrowBounds.minX) * 2,
  'branching must add structure',
)
assert.ok(Math.min(...branchLengths) < Math.max(...branchLengths) * 0.5, 'twigs must be shorter than major branches')

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

const padding = 640 * 0.12
const mature = stagePlants.at(-1)!
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

for (const seed of [1, 2, 3, 12345, 1672279225]) {
  const tree = generateSkeleton({ ...config, growth: 1, seed })
  const bounds = computeBounds(tree.branches)
  const height = bounds.maxY - bounds.minY
  const points = tree.branches.flatMap((branch) => [[branch.x1, branch.y1], [branch.x2, branch.y2]])
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  const upperWidth = span(points.filter(([, y]) => y >= bounds.minY + height * 0.6).map(([x]) => x))
  const lowerWidth = span(points.filter(([, y]) => y < bounds.minY + height * 0.6).map(([x]) => x))
  assert.ok(tree.branches.filter((branch) => branch.depth <= 2).every((branch) => branch.y2 >= branch.y1), `seed ${seed}: major branches must grow upward`)
  assert.ok(bounds.maxX - bounds.minX >= height * 0.22, `seed ${seed}: mature branches must not clump around the trunk`)
  assert.ok(bounds.maxX - bounds.minX <= height * 1.25, `seed ${seed}: mature silhouette must not be wider than tall`)
  assert.ok(upperWidth > lowerWidth, `seed ${seed}: crown must widen toward the top`)
}

console.log('plant checks passed', { stages, heights: heights.map((height) => height.toFixed(1)) })
