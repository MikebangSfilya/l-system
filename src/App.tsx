import { useEffect, useState } from 'react'
import { PlantSvg } from './PlantSvg.tsx'
import type { GrowthTime, PlantConfig } from './plant/types.ts'

const initialConfig: PlantConfig = {
  progress: 0,
  branching: 0.48,
  density: 0.71,
  curvature: 0.22,
  vitality: 0.91,
  seed: 12345,
}

const growthSliders = ['branching', 'curvature', 'density', 'vitality'] as const
const phaseNames = ['Seedling', 'Structure', 'Canopy', 'Living tree'] as const

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const [draftSeed, setDraftSeed] = useState(initialConfig.seed)
  const [time, setTime] = useState<GrowthTime>({ phase: 0, epoch: 0, progress: 0 })
  const [fitRequest, setFitRequest] = useState(0)
  const [regenerateRequest, setRegenerateRequest] = useState(0)
  const [resetRequest, setResetRequest] = useState(0)
  const [follow, setFollow] = useState(false)
  const [naturalGrowth, setNaturalGrowth] = useState(true)
  const seedChanged = draftSeed !== config.seed

  const regenerate = () => {
    setConfig((current) => ({ ...current, seed: draftSeed }))
    setRegenerateRequest((request) => request + 1)
  }

  const resetGrowth = () => {
    if (!window.confirm('Reset all growth for this tree?')) return
    setNaturalGrowth(false)
    setConfig((current) => ({ ...current, progress: 0 }))
    setTime({ phase: 0, epoch: 0, progress: 0 })
    setResetRequest((request) => request + 1)
  }

  useEffect(() => {
    if (!naturalGrowth) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(100, now - previous)
      previous = now
      const duration = time.phase < 3 ? 6_000 : 12_000
      setConfig((current) => current.progress >= 1
        ? current
        : { ...current, progress: Math.min(1, current.progress + elapsed / duration) })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [naturalGrowth, time.phase])

  return (
    <main>
      <section className="controls">
        <h1>Procedural tree</h1>
        <p className="growth-status" aria-live="polite">{phaseNames[time.phase]}</p>

        <label>
          <span>progress</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={config.progress}
            onChange={(event) => {
              setNaturalGrowth(false)
              const progress = event.currentTarget.valueAsNumber
              if (progress >= config.progress) setConfig((current) => ({ ...current, progress }))
            }}
          />
          <output>{config.progress.toFixed(2)}</output>
        </label>

        {growthSliders.map((key) => <label key={key}>
          <span>{key}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={config[key]}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              setConfig((current) => ({ ...current, [key]: value }))
            }}
          />
          <output>{config[key].toFixed(2)}</output>
        </label>)}

        <fieldset>
          <legend>New tree</legend>
          <label>
            <span>seed</span>
            <input
              type="number"
              value={draftSeed}
              onChange={(event) => {
                const seed = event.currentTarget.valueAsNumber || 0
                setDraftSeed(seed)
              }}
            />
          </label>
          <button type="button" onClick={() => setDraftSeed(crypto.getRandomValues(new Uint32Array(1))[0])}>Random seed</button>
          <button type="button" disabled={!seedChanged} onClick={regenerate}>
            Regenerate tree
          </button>
          {seedChanged && <small>Seed regeneration keeps the current growth time.</small>}
        </fieldset>

        <label className="follow-control">
          <input type="checkbox" checked={naturalGrowth} onChange={(event) => setNaturalGrowth(event.currentTarget.checked)} />
          <span>Natural growth</span>
        </label>
        <label className="follow-control">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.currentTarget.checked)} />
          <span>Follow active growth</span>
        </label>
        <button type="button" onClick={() => setFitRequest((request) => request + 1)}>Fit tree</button>
        <button type="button" onClick={resetGrowth}>Reset growth</button>
      </section>

      <section className="preview">
        <h2>Tree preview</h2>
        <PlantSvg
          config={config}
          fitRequest={fitRequest}
          regenerateRequest={regenerateRequest}
          resetRequest={resetRequest}
          follow={follow}
          onTimeChange={(nextTime) => {
            setTime(nextTime)
            setConfig((current) => nextTime.progress === current.progress
              ? current
              : { ...current, progress: nextTime.progress })
          }}
          onRestore={(restored) => {
            setConfig(restored)
            setDraftSeed(restored.seed)
            setTime(restored.time)
          }}
        />
      </section>
    </main>
  )
}
