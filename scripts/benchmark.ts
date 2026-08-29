import { performance } from 'node:perf_hooks'
import { TreeGrowthEngine } from '../src/plant/generator.ts'
import { boundsOnScreen, selectRenderableBranches, selectRenderableMicroBranches, selectRenderableRegions } from '../src/plant/renderer.ts'
import { computeViewTransform } from '../src/plant/view.ts'
import type { PlantConfig } from '../src/plant/types.ts'

const config: PlantConfig = {
  progress: 0,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const engine = new TreeGrowthEngine(config)
const results = []
for (const epochs of [10, 100, 1_000, 10_000]) {
  const generationStart = performance.now()
  engine.setTotalGrowth(3 + epochs)
  const generationMs = performance.now() - generationStart

  engine.setProgress(0.5)
  const progressStart = performance.now()
  const scene = engine.setProgress(0.51)
  const progressMs = performance.now() - progressStart

  const transform = computeViewTransform(scene.bounds, scene.skeleton.root, { width: 640, height: 640 }, 0.12)
  const renderStart = performance.now()
  const selected = selectRenderableBranches(scene.skeleton, transform, 640, 640)
  const visibleChunks = scene.skeleton.chunks.filter((chunk) => boundsOnScreen(chunk.bounds, scene.skeleton, transform, 640, 640))
  const allChunksVisible = visibleChunks.length === scene.skeleton.chunks.length
  const microCandidates = [
    ...(allChunksVisible ? scene.crown.microBranches : visibleChunks.flatMap((chunk) => chunk.microBranches)),
    ...(scene.skeleton.activeChunk?.microBranches ?? []),
  ]
  const regionCandidates = [
    ...(allChunksVisible ? scene.crown.regions : visibleChunks.flatMap((chunk) => chunk.regions)),
    ...(scene.skeleton.activeChunk?.regions ?? []),
  ]
  const selectedMicroBranches = selectRenderableMicroBranches(microCandidates, scene.crown.density, scene.skeleton, transform, 640, 640)
  const selectedRegions = selectRenderableRegions(regionCandidates, scene.crown.density, scene.skeleton, transform, 640, 640)
  const renderSelectionMs = performance.now() - renderStart
  const checkpointBytes = new TextEncoder().encode(JSON.stringify(engine.createCheckpoint())).byteLength

  results.push({
    epochs,
    generationMs: +generationMs.toFixed(3),
    progressMs: +progressMs.toFixed(3),
    renderSelectionMs: +renderSelectionMs.toFixed(3),
    activeSegments: scene.skeleton.stats.activeSegments,
    historicalSegmentsVisited: scene.skeleton.stats.visitedHistoricalSegments,
    segments: scene.skeleton.branches.length,
    chunks: scene.skeleton.chunks.length,
    selectedAxes: new Set(selected.map(({ branchPersistentId }) => branchPersistentId)).size,
    selectedSegments: selected.length,
    selectedMicroBranches: selectedMicroBranches.length,
    selectedRegions: selectedRegions.length,
    checkpointMiB: +(checkpointBytes / 1024 / 1024).toFixed(3),
    heapMiB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
  })
}

console.table(results)
