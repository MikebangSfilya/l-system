import { useState } from 'react'
import { PlantCanvas } from './PlantCanvas.tsx'
import type { PlantConfig, PlantPhase } from './plant/types.ts'

const initialConfig: PlantConfig = {
  phase: 3,
  phaseProgress: 1,
  ageEpoch: 0,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const sliders: Array<Exclude<keyof PlantConfig, 'phase' | 'seed' | 'ageEpoch'>> = [
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
  const [fitRequest, setFitRequest] = useState(0)
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
              onClick={() => setConfig((current) => ({ ...current, phase, phaseProgress: progress, ageEpoch: 0 }))}
              key={`${phase}-${progress}`}
            >
              P{phase} {progress * 100}%
            </button>
          ))}
        </div>

        <label>
          <span>ageEpoch</span>
          <input
            type="number"
            min="0"
            step="1"
            value={config.ageEpoch}
            onChange={(event) => update('ageEpoch', Math.max(0, Math.trunc(event.currentTarget.valueAsNumber || 0)))}
          />
        </label>
        <div className="epoch-buttons" aria-label="Mature age controls">
          <button type="button" onClick={() => update('ageEpoch', config.ageEpoch + 1)}>+1 epoch</button>
          <button type="button" onClick={() => update('ageEpoch', config.ageEpoch + 10)}>+10 epochs</button>
          <button
            type="button"
            onClick={() => setConfig((current) => ({ ...current, ageEpoch: 0, phaseProgress: 0 }))}
          >
            Reset age
          </button>
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
        <button type="button" onClick={() => setFitRequest((request) => request + 1)}>Fit tree</button>
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </section>

      <section className="preview">
        <h2>Plant preview</h2>
        <PlantCanvas config={config} fitRequest={fitRequest} />
      </section>
    </main>
  )
}
