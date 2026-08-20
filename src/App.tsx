import { useState } from 'react'
import { PlantCanvas } from './PlantCanvas.tsx'
import type { PlantConfig, PlantPhase } from './plant/types.ts'

const initialConfig: PlantConfig = {
  phase: 3,
  phaseProgress: 1,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const sliders: Array<Exclude<keyof PlantConfig, 'phase' | 'seed'>> = [
  'phaseProgress',
  'branching',
  'density',
  'curvature',
  'vitality',
]
const phases: Array<[PlantPhase, string]> = [[0, 'Seedling'], [1, 'Structure'], [2, 'Canopy'], [3, 'Mature']]
const phasePresets: Array<[PlantPhase, number]> = [
  [0, 0], [0, 0.5], [0, 1], [1, 0.5], [1, 1], [2, 0.5], [2, 1], [3, 0.5], [3, 1],
]

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const update = <Key extends keyof PlantConfig>(key: Key, value: PlantConfig[Key]) =>
    setConfig((current) => ({ ...current, [key]: value }))

  return (
    <main>
      <section className="controls">
        <h1>Procedural plant</h1>
        <div className="phase-buttons" aria-label="Plant phase">
          {phases.map(([phase, label]) => (
            <button
              type="button"
              aria-pressed={config.phase === phase}
              onClick={() => update('phase', phase)}
              key={phase}
            >
              P{phase} {label}
            </button>
          ))}
        </div>

        {sliders.map((key) => (
          <label key={key}>
            <span>{key}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config[key]}
              onChange={(event) => update(key, event.currentTarget.valueAsNumber)}
            />
            <output>{config[key].toFixed(2)}</output>
          </label>
        ))}

        <div className="phase-buttons" aria-label="Phase progress presets">
          {phasePresets.map(([phase, progress]) => (
            <button
              type="button"
              aria-pressed={config.phase === phase && config.phaseProgress === progress}
              onClick={() => setConfig((current) => ({ ...current, phase, phaseProgress: progress }))}
              key={`${phase}-${progress}`}
            >
              P{phase} {progress * 100}%
            </button>
          ))}
        </div>

        <label>
          <span>seed</span>
          <input
            type="number"
            value={config.seed}
            onChange={(event) => update('seed', event.currentTarget.valueAsNumber || 0)}
          />
        </label>
        <button
          type="button"
          onClick={() => update('seed', crypto.getRandomValues(new Uint32Array(1))[0])}
        >
          Random seed
        </button>
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </section>

      <section className="preview">
        <h2>Plant preview</h2>
        <PlantCanvas config={config} />
      </section>
    </main>
  )
}
