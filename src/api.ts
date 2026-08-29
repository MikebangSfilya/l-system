export type Routine = {
  id: number
  category: string
  type: string
  weight: number
  coefficient: number
  timeType: { temporary: boolean; disposable: boolean }
}

type Completion = { id: number; routineId: number; completedAt: string }
export type Plant = {
  epoch: number
  phase: number
  phaseProgress: number
  branching: number
  density: number
  curvature: number
  vitality: number
  seed: number
}
type NewRoutine = Pick<Routine, 'category' | 'type'> & { weight: number; coefficient: number; temporary: boolean; disposable: boolean }
type ErrorResponse = { error?: string }

const api = import.meta.env.VITE_API_URL ?? '/api'

async function request<Response>(path: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, init)
  const body = await response.json() as Response & ErrorResponse
  if (!response.ok) throw new Error(body.error ?? 'Не удалось выполнить запрос')
  return body
}

export const getRoutines = () => request<Routine[]>('/routines')
export const getCompletions = () => request<Completion[]>('/completions')
export const getPlant = () => request<Plant>('/plant')
export const completeRoutine = (id: number) => request<Completion>(`/routines/${id}/complete`, { method: 'POST' })
export const createRoutine = (routine: NewRoutine) => request<Routine>('/routines', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(routine),
})
