import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { PlantSvg } from './PlantSvg.tsx'
import { completeRoutine, createRoutine, getCompletions, getPlant, getRoutines } from './api.ts'
import type { Plant, Routine } from './api.ts'
import { demoTrees } from './demoTrees.ts'
import type { GrowthTime, PlantConfig, PlantPhase } from './plant/types.ts'

const initialConfig: PlantConfig = { progress: 0, branching: 0.48, density: 0.71, curvature: 0.22, vitality: 0.91, seed: 12345 }
const phaseNames = ['Росток', 'Ствол', 'Крона', 'Живое дерево'] as const
const sliders = ['progress', 'branching', 'curvature', 'density', 'vitality'] as const

const timeFromGrowth = (growth: number): GrowthTime => {
  if (growth < 3) return { phase: Math.floor(growth) as PlantPhase, epoch: 0, progress: growth % 1 }
  const matureGrowth = growth - 3
  return { phase: 3, epoch: Math.floor(matureGrowth), progress: matureGrowth % 1 }
}

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const [time, setTime] = useState<GrowthTime>({ phase: 0, epoch: 0, progress: 0 })
  const [fitRequest, setFitRequest] = useState(0)
  const [regenerateRequest, setRegenerateRequest] = useState(0)
  const [serverGrowth, setServerGrowth] = useState<number>()
  const [routines, setRoutines] = useState<Routine[]>([])
  const [completions, setCompletions] = useState<Array<{ routineId: number; completedAt: string }>>([])
  const [routineName, setRoutineName] = useState('')
  const [category, setCategory] = useState('health')
  const [weight, setWeight] = useState(1)
  const [coefficient, setCoefficient] = useState(1)
  const [menuOpen, setMenuOpen] = useState(true)
  const [demoMode, setDemoMode] = useState(false)
  const [demoUser, setDemoUser] = useState('Анна')
  const [viewSource, setViewSource] = useState<'api' | 'demo'>('api')
  const [loadingRoutines, setLoadingRoutines] = useState(true)
  const [savingRoutine, setSavingRoutine] = useState(false)
  const [completingId, setCompletingId] = useState<number>()
  const [routineError, setRoutineError] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const completedIds = new Set(completions.filter((completion) => {
    const routine = routines.find(({ id }) => id === completion.routineId)
    return routine?.timeType.disposable || completion.completedAt.slice(0, 10) === today
  }).map(({ routineId }) => routineId))
  const selectedDemo = demoTrees.find(({ name }) => name === demoUser) ?? demoTrees[0]

  const applyPlant = (plant: Plant) => {
    const phase = Math.max(0, Math.min(3, plant.phase)) as PlantPhase
    const progress = Math.max(0, Math.min(1, plant.phaseProgress))
    const growth = phase < 3 ? phase + progress : 3 + Math.max(0, plant.epoch) + progress
    setConfig((current) => ({ ...current, branching: plant.branching, density: plant.density, curvature: plant.curvature, vitality: plant.vitality, seed: plant.seed, progress }))
    setTime({ phase, epoch: phase === 3 ? Math.max(0, plant.epoch) : 0, progress })
    setServerGrowth(growth)
    setViewSource('api')
  }

  useEffect(() => {
    void Promise.all([getRoutines(), getCompletions(), getPlant()]).then(([nextRoutines, nextCompletions, plant]) => {
      setRoutines(nextRoutines)
      setCompletions(nextCompletions)
      applyPlant(plant)
    }).catch((error: Error) => setRoutineError(error.message)).finally(() => setLoadingRoutines(false))
  }, [])

  const addRoutine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingRoutine(true)
    setRoutineError('')
    try {
      const routine = await createRoutine({ category, type: routineName, weight, coefficient, temporary: false, disposable: false })
      setRoutines((current) => [...current, routine])
      setRoutineName('')
    } catch (error) {
      setRoutineError(error instanceof Error ? error.message : 'Не удалось добавить рутину')
    } finally {
      setSavingRoutine(false)
    }
  }

  const complete = async (id: number) => {
    setCompletingId(id)
    setRoutineError('')
    try {
      const completion = await completeRoutine(id)
      setCompletions((current) => [...current, completion])
      applyPlant(await getPlant())
    } catch (error) {
      setRoutineError(error instanceof Error ? error.message : 'Не удалось отметить выполнение')
    } finally {
      setCompletingId(undefined)
    }
  }

  const selectDemo = (demo: typeof demoTrees[number]) => {
    setDemoUser(demo.name)
    setConfig({ seed: demo.seed, branching: demo.branching, curvature: demo.curvature, density: demo.density, vitality: demo.vitality, progress: demo.progress })
    setTime(timeFromGrowth(demo.growth))
    setServerGrowth(demo.growth)
    setViewSource('demo')
    setRegenerateRequest((request) => request + 1)
  }

  const restoreApiTree = async () => {
    setRoutineError('')
    try {
      applyPlant(await getPlant())
    } catch (error) {
      setRoutineError(error instanceof Error ? error.message : 'Не удалось загрузить дерево из API')
    }
  }

  const randomSeed = () => {
    setConfig((current) => ({ ...current, seed: crypto.getRandomValues(new Uint32Array(1))[0] }))
    setRegenerateRequest((request) => request + 1)
  }

  return (
    <main className={`app-shell${menuOpen ? '' : ' menu-closed'}`}>
      <aside className="sidebar" aria-label="Меню">
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark">✦</span><strong>Tree tracker</strong></div>
          <button className="menu-toggle" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Свернуть меню' : 'Открыть меню'}>{menuOpen ? '‹' : '›'}</button>
        </div>

        <div className="sidebar-content">
          <section className="demo-users" aria-labelledby="demo-users-title">
            <p className="eyebrow" id="demo-users-title">Демо-пользователь</p>
            <div className="user-picker">
              <button type="button" className={viewSource === 'api' ? 'user active' : 'user'} onClick={() => void restoreApiTree()}>
                <span className="avatar">✦</span><span>Текущее<small>из API</small></span>
              </button>
              {demoTrees.map((demo) => <button key={demo.name} type="button" className={viewSource === 'demo' && demoUser === demo.name ? 'user active' : 'user'} onClick={() => selectDemo(demo)}>
                <span className="avatar">{demo.name[0]}</span><span>{demo.name}<small>{demo.label}</small></span>
              </button>)}
            </div>
            <small>Параметры каждого дерева подобраны скриптом.</small>
          </section>

          <section className="routines" aria-labelledby="routines-title">
            <div className="section-heading"><div><p className="eyebrow">Сегодня</p><h1 id="routines-title">Рутины</h1></div><span>{completedIds.size}/{routines.length}</span></div>
            <form onSubmit={addRoutine}>
              <input value={routineName} onChange={(event) => setRoutineName(event.currentTarget.value)} placeholder="Новая рутина" required />
              <select value={category} onChange={(event) => setCategory(event.currentTarget.value)} aria-label="Категория">
                <option value="health">Здоровье</option><option value="study">Учёба</option><option value="personal">Личное</option>
              </select>
              <select aria-label="Вес рутины" value={weight} onChange={(event) => setWeight(Number(event.currentTarget.value))}>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>Вес: {value}</option>)}
              </select>
              <select aria-label="Коэффициент рутины" value={coefficient} onChange={(event) => setCoefficient(Number(event.currentTarget.value))}>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>× {value}</option>)}
              </select>
              <button className="add-routine" disabled={savingRoutine}>{savingRoutine ? 'Добавляем…' : '+ Добавить'}</button>
            </form>
            {routineError && <p className="routine-error" role="alert">{routineError}</p>}
            {loadingRoutines ? <p className="muted">Загрузка…</p> : routines.length === 0 ? <p className="muted">Добавьте первую рутину.</p> : <ul>
              {routines.map((routine) => <li key={routine.id} className={completedIds.has(routine.id) ? 'done' : ''}>
                <span className="routine-name">{routine.type}<small>{routine.category} · {routine.weight * routine.coefficient} очков</small></span>
                <button type="button" disabled={completedIds.has(routine.id) || completingId === routine.id} onClick={() => void complete(routine.id)}>
                  {completedIds.has(routine.id) ? 'Готово' : completingId === routine.id ? '…' : 'Сделать'}
                </button>
              </li>)}
            </ul>}
          </section>
        </div>
      </aside>

      <section className="tree-area">
        <header className="tree-header">
          <div><p className="eyebrow">{viewSource === 'api' ? 'Текущее дерево · синхронизировано с API' : `Демо: ${selectedDemo.name} · ${selectedDemo.label}`}</p><h2>{time.phase === 3 ? `${phaseNames[time.phase]} · эпоха ${time.epoch}` : phaseNames[time.phase]}</h2></div>
          <div className="tree-actions">
            <button className={demoMode ? 'demo-button active' : 'demo-button'} type="button" onClick={() => setDemoMode((open) => !open)} aria-pressed={demoMode}>Демо-показ</button>
            <button className="fit-tree" type="button" onClick={() => setFitRequest((request) => request + 1)}>Показать целиком</button>
          </div>
        </header>
        {demoMode && <section className="demo-controls" aria-label="Настройки демонстрации">
          {sliders.map((key) => <label key={key}>
            <span>{key}</span>
            <input type="range" min="0" max="1" step="0.01" value={config[key]} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              setConfig((current) => ({ ...current, [key]: value }))
            }} />
            <output>{config[key].toFixed(2)}</output>
          </label>)}
          <label className="seed-control"><span>seed</span><input type="number" value={config.seed} onChange={(event) => {
            const seed = event.currentTarget.valueAsNumber
            if (Number.isFinite(seed)) setConfig((current) => ({ ...current, seed }))
          }} /></label>
          <button type="button" onClick={randomSeed}>Новый seed</button>
          <button type="button" onClick={() => setRegenerateRequest((request) => request + 1)}>Перестроить дерево</button>
        </section>}
        <PlantSvg
          config={config}
          fitRequest={fitRequest}
          regenerateRequest={regenerateRequest}
          resetRequest={0}
          follow={false}
          serverGrowth={serverGrowth}
          onTimeChange={(nextTime) => {
            setTime(nextTime)
            setConfig((current) => nextTime.progress === current.progress ? current : { ...current, progress: nextTime.progress })
          }}
          onRestore={(restored) => {
            setConfig(restored)
            setTime(restored.time)
          }}
        />
      </section>
    </main>
  )
}
