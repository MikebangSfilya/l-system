import { useState } from 'react'
import { PlantCanvas } from './PlantCanvas.tsx'
import type { PlantConfig } from './plant/types.ts'

const initialConfig: PlantConfig = {
  growth: 0.62,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const sliders: Array<Exclude<keyof PlantConfig, 'seed'>> = [
  'growth',
  'branching',
  'density',
  'curvature',
  'vitality',
]
const growthPresets = [0.1, 0.25, 0.5, 0.75, 1]

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const update = (key: keyof PlantConfig, value: number) => setConfig((current) => ({ ...current, [key]: value }))

  return (
    <main>
      <section className="controls">
        <h1>Procedural plant</h1>
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

        <div className="growth-presets" aria-label="Growth stage presets">
          {growthPresets.map((growth) => (
            <button
              type="button"
              aria-pressed={config.growth === growth}
              onClick={() => update('growth', growth)}
              key={growth}
            >
              {growth * 100}%
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
