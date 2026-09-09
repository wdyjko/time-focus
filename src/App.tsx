import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import MusicPlayer from './MusicPlayer'

type Mode = 'work' | 'shortBreak' | 'longBreak'
type SavedState = { mode: Mode; remaining: number; running: boolean; savedAt: number }
type CompletionLog = number[]
type Task = { id: string; title: string; completed: boolean; pomodoros: number; createdAt: number }
const DURATIONS: Record<Mode, number> = { work: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 }
const STORAGE_KEY = 'tomato-clock-state'
const COMPLETIONS_KEY = 'tomato-clock-completions'
const TASKS_KEY = 'tomato-clock-tasks'
const COUNTS_RESET_KEY = 'tomato-clock-counts-reset-v2'

function resetCountsOnce() {
  try {
    if (localStorage.getItem(COUNTS_RESET_KEY) === 'done') return
    const savedTasks = JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]') as unknown
    if (Array.isArray(savedTasks)) {
      const resetTasks = savedTasks.map(task => task && typeof task === 'object'
        ? { ...task, pomodoros: 0 }
        : task)
      localStorage.setItem(TASKS_KEY, JSON.stringify(resetTasks))
    }
    localStorage.setItem(COMPLETIONS_KEY, '[]')
    localStorage.setItem(COUNTS_RESET_KEY, 'done')
  } catch { /* Keep the app usable if stored data is malformed or unavailable. */ }
}

resetCountsOnce()

function readState(): SavedState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedState | null
    if (!saved || !['work', 'shortBreak', 'longBreak'].includes(saved.mode)) throw new Error('invalid')
    const elapsed = saved.running ? Math.floor((Date.now() - saved.savedAt) / 1000) : 0
    return { ...saved, remaining: Math.max(0, Math.min(DURATIONS[saved.mode], saved.remaining - elapsed)) }
  } catch { return { mode: 'work', remaining: DURATIONS.work, running: false, savedAt: Date.now() } }
}

const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

function readCompletions(): CompletionLog {
  try {
    const values = JSON.parse(localStorage.getItem(COMPLETIONS_KEY) ?? '[]') as unknown
    return Array.isArray(values) ? values.filter((value): value is number => typeof value === 'number') : []
  } catch { return [] }
}

function readTasks(): Task[] {
  try {
    const values = JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]') as unknown
    if (!Array.isArray(values)) return []
    return values.flatMap(value => {
      if (!value || typeof value !== 'object' || !('id' in value) || !('title' in value)) return []
      const task = value as Partial<Task>
      const completed = task.completed === true
      const pomodoros = typeof task.pomodoros === 'number' && Number.isFinite(task.pomodoros) ? task.pomodoros : 0
      return [{
        id: String(task.id),
        title: String(task.title),
        completed,
        pomodoros,
        createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
      }]
    })
  } catch { return [] }
}

function isSameDay(left: Date, right: Date) {
  return left.toDateString() === right.toDateString()
}

function isThisWeek(date: Date, now: Date) {
  const start = new Date(now)
  const day = start.getDay() || 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day + 1)
  return date >= start && date <= now
}

function getWeekStart(date: Date) {
  const start = new Date(date)
  const day = start.getDay() || 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day + 1)
  return start
}

export default function App() {
  const initial = useMemo(readState, [])
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [remaining, setRemaining] = useState(initial.remaining)
  const [running, setRunning] = useState(initial.running && initial.remaining > 0)
  const [status, setStatus] = useState(initial.running && initial.remaining > 0 ? '计时进行中' : '准备开始')
  const [standardMode, setStandardMode] = useState(false)
  const [standardPomodoros, setStandardPomodoros] = useState(0)
  const [showStandardInfo, setShowStandardInfo] = useState(false)
  const [durations, setDurations] = useState<Record<Mode, number>>(DURATIONS)
  const [editingTimer, setEditingTimer] = useState(false)
  const [editMinutes, setEditMinutes] = useState(String(Math.floor(initial.remaining / 60)))
  const [editSeconds, setEditSeconds] = useState(String(initial.remaining % 60))
  const [completions, setCompletions] = useState<CompletionLog>(() => readCompletions())
  const [tasks, setTasks] = useState<Task[]>(() => readTasks())
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentTaskIdRef = useRef<string | null>(null)
  const finishHandledRef = useRef(false)
  const duration = durations[mode]

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    audioRef.current = new Audio('/notification.wav')
    audioRef.current.preload = 'auto'
  }, [])

  const persist = useCallback((next: SavedState) => localStorage.setItem(STORAGE_KEY, JSON.stringify(next)), [])
  useEffect(() => { persist({ mode, remaining, running, savedAt: Date.now() }) }, [mode, remaining, running, persist])
  useEffect(() => { localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(completions)) }, [completions])
  useEffect(() => { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)) }, [tasks])
  useEffect(() => { currentTaskIdRef.current = currentTaskId }, [currentTaskId])
  const finish = useCallback(() => {
    if (finishHandledRef.current) return
    finishHandledRef.current = true
    const message = mode === 'work' ? '时间到了，该休息了！' : '休息结束，开始专注吧！'
    setRunning(false); setStatus(message)
    let nextStandardMode: Mode | null = null
    if (mode === 'work') {
      setCompletions(previous => [...previous, Date.now()])
      const taskId = currentTaskIdRef.current
      if (taskId) setTasks(previous => previous.map(task => task.id === taskId ? { ...task, pomodoros: task.pomodoros + 1 } : task))
      if (standardMode) {
        const completed = standardPomodoros + 1
        nextStandardMode = completed % 4 === 0 ? 'longBreak' : 'shortBreak'
        setStandardPomodoros(completed % 4)
      }
    } else if (standardMode) {
      nextStandardMode = 'work'
    }
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => undefined)
    }
    if ('Notification' in window && Notification.permission === 'granted') new Notification('番茄钟', { body: message })
    if (nextStandardMode) {
      setMode(nextStandardMode)
      setRemaining(durations[nextStandardMode])
      setStatus(nextStandardMode === 'work' ? '开始下一轮专注' : nextStandardMode === 'longBreak' ? '四个番茄钟完成，进入长休息' : '进入短休息')
      finishHandledRef.current = false
      setRunning(true)
    }
  }, [currentTaskId, mode, standardMode, standardPomodoros, durations])
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setRemaining(value => {
      return Math.max(0, value - 1)
    }), 1000)
    return () => window.clearInterval(id)
  }, [running])
  useEffect(() => {
    if (running && remaining === 0) finish()
  }, [running, remaining, finish])

  const startPause = async () => {
    if (running) { setRunning(false); setStatus('已暂停'); return }
    if (!currentTaskId) { setStatus('请先选择一个任务'); return }
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined)
    if (remaining === 0) setRemaining(duration)
    finishHandledRef.current = false
    setRunning(true); setStatus('计时进行中')
  }
  const reset = () => { setRunning(false); setRemaining(duration); setStandardPomodoros(0); setStatus('准备开始专注') }
  const switchMode = (next: Mode) => {
    if (next !== mode) {
      setMode(next); setRunning(false); setRemaining(durations[next]); setStandardPomodoros(0); setStatus('准备开始专注')
    }
    setStandardMode(false)
  }
  const toggleStandardMode = () => {
    const enabled = !standardMode
    setStandardMode(enabled)
    setRunning(false)
    setStandardPomodoros(0)
    if (enabled) {
      setMode('work')
      setRemaining(durations.work)
      setStatus('标准模式已开启，可以开始专注')
    } else {
      setStatus('标准模式已关闭')
    }
  }
  const beginEditTimer = () => {
    if (running) { setStatus('请先暂停计时，再修改倒计时'); return }
    setEditMinutes(String(Math.floor(remaining / 60)))
    setEditSeconds(String(remaining % 60))
    setEditingTimer(true)
  }
  const saveEditedTimer = (event: FormEvent) => {
    event.preventDefault()
    const minutes = Math.max(0, Math.min(99, Number.parseInt(editMinutes, 10) || 0))
    const seconds = Math.max(0, Math.min(59, Number.parseInt(editSeconds, 10) || 0))
    const total = minutes * 60 + seconds
    if (total < 1) { setStatus('倒计时至少需要 1 秒'); return }
    setDurations(previous => ({ ...previous, [mode]: total }))
    setRemaining(total)
    setEditingTimer(false)
    setStatus('倒计时已更新')
  }
  const cancelEditTimer = () => setEditingTimer(false)
  const addTask = () => {
    const title = taskTitle.trim()
    if (!title) return
    const task: Task = { id: crypto.randomUUID(), title, completed: false, pomodoros: 0, createdAt: Date.now() }
    setTasks(previous => [...previous, task])
    if (!running) { setCurrentTaskId(task.id); setStatus('任务已选择，可以开始专注') }
    setTaskTitle('')
  }
  const toggleTask = (id: string) => {
    if (running) {
      setStatus('请先暂停计时，再标记任务完成')
      return
    }
    setTasks(previous => previous.map(task => task.id === id ? { ...task, completed: !task.completed } : task))
  }
  const removeTask = (id: string) => { setTasks(previous => previous.filter(task => task.id !== id)); if (currentTaskId === id) setCurrentTaskId(null) }
  const selectTask = (id: string) => {
    if (id === currentTaskId) return
    if (running) {
      const confirmed = window.confirm('当前计时正在进行，确定切换任务并重新开始计时吗？')
      if (!confirmed) return
      setCurrentTaskId(id)
      setRemaining(DURATIONS[mode])
      setStatus('已切换任务，计时重新开始')
      return
    }
    setCurrentTaskId(id)
    setStatus('任务已选择，可以开始专注')
  }
  const now = new Date()
  const todayCount = completions.filter(timestamp => isSameDay(new Date(timestamp), now)).length
  const weekCount = completions.filter(timestamp => isThisWeek(new Date(timestamp), now)).length
  const weekStart = getWeekStart(now)
  const weekDays = ['一', '二', '三', '四', '五', '六', '日'].map((label, index) => {
    const day = new Date(weekStart)
    day.setDate(weekStart.getDate() + index)
    return { label, count: completions.filter(timestamp => isSameDay(new Date(timestamp), day)).length, isToday: isSameDay(day, now) }
  })
  const chartMax = Math.max(1, ...weekDays.map(day => day.count))

  return <><main className="grid min-h-screen place-items-center overflow-hidden bg-[#f5efec] px-4 py-4 pb-24 font-sans text-[#2b2c34] sm:px-6">
    <section className="w-full max-w-5xl rounded-lg border border-black/5 bg-white px-5 py-5 text-center shadow-[0_16px_45px_rgba(104,73,61,0.12)] sm:px-8 sm:py-6">
      <div role="tablist" aria-label="计时模式" className="mx-auto mb-6 grid max-w-md grid-cols-3 gap-2 rounded-xl bg-[#fffaf7] p-1.5">
        {(['work', 'shortBreak', 'longBreak'] as Mode[]).map(item => <button key={item} role="tab" aria-selected={mode === item} onClick={() => switchMode(item)} className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition ${mode === item ? 'bg-[#e85d5d] text-white shadow-md shadow-[#e85d5d]/25' : 'text-[#777b88] hover:bg-white'}`}>{item === 'work' ? '专注' : item === 'shortBreak' ? '短休息' : '长休息'}</button>)}
      </div>
      <div className="grid items-center gap-7 lg:grid-cols-[minmax(330px,1fr)_minmax(350px,0.95fr)] lg:gap-10">
      <div>
      <div className="mx-auto my-2 grid aspect-square w-[min(60vw,280px)] place-items-center rounded-full p-2 shadow-[0_12px_35px_rgba(232,93,93,0.16)]" style={{ background: `conic-gradient(#e85d5d ${Math.min(1, Math.max(0, (duration - remaining) / duration)) * 360}deg, #f4e7e3 0deg)` }}>
        <div role="timer" aria-live="polite" className="grid h-full w-full place-items-center rounded-full bg-white">
          {editingTimer ? <form onSubmit={saveEditedTimer} className="flex flex-col items-center justify-center gap-3 px-3 text-center"><div className="flex items-center gap-1"><input autoFocus inputMode="numeric" type="number" min="0" max="99" value={editMinutes} onChange={event => setEditMinutes(event.target.value)} aria-label="分钟" className="h-14 w-20 rounded-md border border-[#e85d5d] text-center text-3xl font-extrabold tabular-nums outline-none" /><span className="text-3xl font-extrabold">:</span><input inputMode="numeric" type="number" min="0" max="59" value={editSeconds} onChange={event => setEditSeconds(event.target.value)} aria-label="秒" className="h-14 w-20 rounded-md border border-[#e85d5d] text-center text-3xl font-extrabold tabular-nums outline-none" /></div><div className="flex gap-2"><button type="submit" className="rounded-md bg-[#e85d5d] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#c84646]">确定</button><button type="button" onClick={cancelEditTimer} className="rounded-md border border-[#eee9e6] px-3 py-1.5 text-xs font-bold text-[#777b88] hover:bg-[#fffaf7]">取消</button></div></form> : <button type="button" onClick={beginEditTimer} className="group flex flex-col items-center justify-center text-center" aria-label="点击修改倒计时"><p className="text-[clamp(58px,17vw,92px)] font-extrabold leading-none tabular-nums tracking-wide">{formatTime(remaining)}</p><p className="mt-3 text-xs font-bold uppercase tracking-[0.26em] text-[#c84646] group-hover:underline">time focus</p></button>}
        </div>
      </div>
      <p className="mb-6 mt-5 min-h-6 text-sm text-[#777b88]">{status}</p>
      <div className="flex flex-wrap items-center justify-center gap-2.5"><button onClick={startPause} className="min-h-12 min-w-28 rounded-md bg-[#e85d5d] px-5 font-bold text-white transition hover:bg-[#c84646]">{running ? '暂停' : '开始'}</button><button onClick={reset} className="min-h-12 min-w-28 rounded-md border border-[#eee9e6] bg-white px-5 font-bold transition hover:-translate-y-px hover:shadow-md">重置</button><span className="relative inline-flex"><button onClick={toggleStandardMode} aria-pressed={standardMode} className={`min-h-12 min-w-28 rounded-md px-4 font-bold transition ${standardMode ? 'bg-[#2b2c34] text-white shadow-md' : 'border border-[#eee9e6] bg-white hover:-translate-y-px hover:shadow-md'}`}>标准模式</button><button onClick={() => setShowStandardInfo(true)} aria-label="查看标准模式说明" className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border border-white bg-[#777b88] text-xs font-bold leading-none text-white shadow-sm transition hover:bg-[#2b2c34]">i</button></span></div>
      </div>
      <div>
      <div className="mt-7 grid grid-cols-2 gap-3 border-t border-[#eee9e6] pt-5">
        <div><p className="text-2xl font-bold text-[#c84646]">{todayCount}</p><p className="mt-1 text-xs text-[#777b88]">今日完成</p></div>
        <div><p className="text-2xl font-bold text-[#c84646]">{weekCount}</p><p className="mt-1 text-xs text-[#777b88]">本周完成</p></div>
      </div>
      <div className="mt-6 border-t border-[#eee9e6] pt-5 text-left lg:mt-0">
        <div className="mb-4 flex items-center justify-between"><p className="text-sm font-bold text-[#2b2c34]">本周趋势</p><p className="text-xs text-[#777b88]">每日完成数量</p></div>
        <div className="flex h-32 items-end justify-between gap-2" aria-label="本周番茄钟完成数量柱状图" role="img">
          {weekDays.map(day => <div key={day.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs font-semibold text-[#c84646]">{day.count || ''}</span><div className={`w-full max-w-8 rounded-t-md transition-all ${day.isToday ? 'bg-[#e85d5d]' : 'bg-[#f2c8c2]'}`} style={{ height: `${Math.max(day.count / chartMax * 100, day.count ? 8 : 3)}%` }} title={`${day.label} ${day.count} 个番茄钟`} /><span className={`text-xs ${day.isToday ? 'font-bold text-[#c84646]' : 'text-[#777b88]'}`}>周{day.label}</span></div>)}
        </div>
      </div>
      <div className="mt-6 border-t border-[#eee9e6] pt-5 text-left">
        <div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold text-[#2b2c34]">任务列表</p><p className="text-xs text-[#777b88]">选择任务后开始专注</p></div>
        <div className="flex gap-2">
          <input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addTask() }} placeholder="添加一个任务" className="min-w-0 flex-1 rounded-md border border-[#eee9e6] px-3 py-2 text-sm outline-none transition focus:border-[#e85d5d]" />
          <button onClick={addTask} className="rounded-md bg-[#2b2c34] px-4 text-sm font-bold text-white transition hover:bg-[#454652]">添加</button>
        </div>
        <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
          {tasks.length === 0 && <p className="py-2 text-center text-xs text-[#999]">还没有任务</p>}
          {tasks.map(task => <div key={task.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 transition ${currentTaskId === task.id ? 'border-2 border-[#e85d5d] bg-[#fffaf7] shadow-sm shadow-[#e85d5d]/10' : 'border-[#eee9e6]'}`}>
            <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)} aria-label={`完成任务 ${task.title}`} className="h-4 w-4 accent-[#e85d5d]" />
            <button onClick={() => selectTask(task.id)} className={`min-w-0 flex-1 truncate text-left text-sm ${task.completed ? 'text-[#aaa] line-through' : currentTaskId === task.id ? 'font-bold text-[#c84646]' : 'text-[#2b2c34]'}`} title="选择此任务">{task.title}</button>
            <span className="shrink-0 text-xs text-[#777b88]" title={`累计 ${task.pomodoros} 个番茄钟`}>完成 {task.pomodoros} 次</span>
            <button onClick={() => removeTask(task.id)} aria-label={`删除任务 ${task.title}`} className="px-1 text-lg leading-none text-[#aaa] hover:text-[#c84646]">×</button>
          </div>)}
        </div>
      </div>
      </div>
      </div>
      <p className="mt-6 border-t border-[#eee9e6] pt-4 text-xs text-[#777b88]">结束时将发送浏览器通知</p>
    </section>
  </main>
  {showStandardInfo && <div className="fixed inset-0 z-50 grid place-items-center bg-[#2b2c34]/35 px-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowStandardInfo(false) }}><div role="dialog" aria-modal="true" aria-labelledby="standard-mode-title" className="w-full max-w-sm rounded-lg bg-white p-6 text-left shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="standard-mode-title" className="text-lg font-bold text-[#2b2c34]">标准模式</h2><p className="mt-3 text-sm leading-6 text-[#777b88]">开启后会自动循环专注与短休息。完成 4 个番茄钟后，系统会自动进入一次长休息，再开始下一轮。</p></div><button onClick={() => setShowStandardInfo(false)} aria-label="关闭说明" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-xl leading-none text-[#777b88] hover:bg-[#fffaf7] hover:text-[#2b2c34]">×</button></div><button onClick={() => setShowStandardInfo(false)} className="mt-5 min-h-10 w-full rounded-md bg-[#2b2c34] px-4 text-sm font-bold text-white hover:bg-[#454652]">知道了</button></div></div>}
  <MusicPlayer /></>
}
