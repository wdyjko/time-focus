import { useEffect, useRef, useState } from 'react'

type Song = { id: number; name: string; artists?: { name: string }[]; ar?: { name: string }[]; al?: { picUrl?: string; name?: string } }
type PlayMode = 'repeat-one' | 'sequential' | 'random'
type MusicView = 'home' | 'search'
const USER_KEY = 'tomato-clock-netease-user-id'
// In production this is normally the URL of the separately deployed music API.
// An empty value keeps same-origin requests usable when the API is colocated.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const api = async (path: string, userId?: string, method: 'GET' | 'POST' = 'GET') => {
  const headers = userId ? { 'X-User-Id': userId } : undefined
  let lastError: unknown
  const urls = API_BASE_URL ? [`${API_BASE_URL}${path}`, path] : [path]
  for (const url of urls) {
    try {
      const response = await fetch(url, { method, headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('network')
}

export default function MusicPlayer() {
  const [userId, setUserId] = useState(() => localStorage.getItem(USER_KEY) || '')
  const [open, setOpen] = useState(false)
  const [loginQr, setLoginQr] = useState<string | null>(null)
  const [loginMessage, setLoginMessage] = useState('扫码登录网易云音乐')
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState<Song[]>([])
  const [homeSongs, setHomeSongs] = useState<Song[]>([])
  const [view, setView] = useState<MusicView>('home')
  const [playMode, setPlayMode] = useState<PlayMode>('sequential')
  const [current, setCurrent] = useState<Song | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  const poller = useRef<number | undefined>(undefined)
  const queueRef = useRef<Song[]>([])
  const playModeRef = useRef<PlayMode>('sequential')

  useEffect(() => () => window.clearInterval(poller.current), [])
  useEffect(() => { queueRef.current = songs }, [songs])
  useEffect(() => { playModeRef.current = playMode }, [playMode])
  useEffect(() => {
    if (!userId) return
    api('/api/music/playlist', userId).then(async result => {
      const favorite = result.playlist?.find((item: { specialType?: number }) => item.specialType === 5) || result.playlist?.[0]
      if (!favorite) return
      const tracks = await api(`/api/music/playlist/${favorite.id}`, userId)
      const favoriteSongs = (tracks.songs || []).slice(0, 30)
      setHomeSongs(favoriteSongs)
      setSongs(favoriteSongs)
    }).catch(() => undefined)
  }, [userId])
  const startLogin = async () => {
    try {
      const result = await api('/api/music/login/qr', undefined, 'POST')
      setLoginQr(result.qrimg); setLoginMessage('请使用网易云音乐 App 扫码')
      window.clearInterval(poller.current)
      poller.current = window.setInterval(async () => {
        const status = await api(`/api/music/login/status?sessionId=${encodeURIComponent(result.sessionId)}`)
        if (status.code === 803) { window.clearInterval(poller.current); localStorage.setItem(USER_KEY, status.userId); setUserId(status.userId); setLoginMessage('登录成功'); setTimeout(() => setOpen(false), 700) }
        else if (status.code === 802) setLoginMessage('已扫码，请确认登录')
        else if (status.code === 800) { window.clearInterval(poller.current); setLoginMessage('二维码已失效，请重新获取') }
      }, 2000)
    } catch (error) { setLoginMessage(`无法连接本地音乐服务（${error instanceof Error ? error.message : '网络错误'}）`) }
  }
  const search = async () => {
    if (!query.trim()) return
    try { const result = await api(`/api/music/search?keywords=${encodeURIComponent(query.trim())}`, userId); setSongs(result.result?.songs || []); setView('search'); setError('') } catch { setError('搜索失败，请检查音乐服务') }
  }
  const showHome = () => { setView('home'); setSongs(homeSongs); setError('') }
  const playSong = async (song: Song) => {
    try {
      const result = await api(`/api/music/song/${song.id}`, userId)
      const url = result.data?.[0]?.url
      if (!url) throw new Error('unavailable')
      if (!audio.current) audio.current = new Audio()
      audio.current.src = url; audio.current.volume = volume; audio.current.ontimeupdate = () => setCurrentTime(audio.current?.currentTime || 0); audio.current.onloadedmetadata = () => setDuration(audio.current?.duration || 0); audio.current.onended = () => {
        const queue = queueRef.current
        if (!queue.length) return setPlaying(false)
        if (playModeRef.current === 'repeat-one') return void playSong(song)
        const index = queue.findIndex(item => item.id === song.id)
        let nextIndex = index + 1
        if (playModeRef.current === 'random') {
          const choices = queue.filter(item => item.id !== song.id)
          if (choices.length) return void playSong(choices[Math.floor(Math.random() * choices.length)])
          return void playSong(song)
        }
        if (nextIndex >= queue.length) nextIndex = 0
        void playSong(queue[nextIndex])
      }; await audio.current.play(); setCurrent(song); setPlaying(true); setError('')
    } catch { setError('歌曲暂时无法播放') }
  }
  const togglePlay = async () => { if (!audio.current || !current) return; if (playing) { audio.current.pause(); setPlaying(false) } else { await audio.current.play(); setPlaying(true) } }
  const logout = async () => {
    try { if (userId) await api('/api/music/logout', userId, 'POST') } catch { /* Local logout still completes if the BFF is unavailable. */ }
    audio.current?.pause()
    if (audio.current) audio.current.src = ''
    localStorage.removeItem(USER_KEY)
    setUserId(''); setLoginQr(null); setLoginMessage('扫码登录网易云音乐'); setSongs([]); setHomeSongs([]); setCurrent(null); setPlaying(false); setView('home'); setError('')
  }

  return <>
    <div className="fixed bottom-3 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-5xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#17151d]/95 px-3 py-2 text-white shadow-xl backdrop-blur-lg">
      <button onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2a2635] text-lg" aria-label="打开网易云音乐">
        {current?.al?.picUrl ? <img src={current.al.picUrl} alt={`${current.name} 专辑封面`} className={`album-art h-9 w-9 rounded-full object-cover ${playing ? 'is-playing' : ''}`} /> : '♫'}
      </button>
      <button onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{current?.name || '网易云音乐'}</p><p className="truncate text-xs text-white/55">{current ? (current.artists || current.ar || []).map(item => item.name).join(' / ') : userId ? '搜索音乐并开始播放' : '登录后播放你的歌单'}</p></button>
      <button onClick={togglePlay} disabled={!current} className="grid h-9 w-9 place-items-center rounded-full bg-[#e85d5d] disabled:opacity-40" aria-label={playing ? '暂停' : '播放'}>{playing ? 'Ⅱ' : '▶'}</button>
      <input aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const next = Number(event.target.value); setVolume(next); if (audio.current) audio.current.volume = next }} className="hidden w-20 accent-[#e85d5d] sm:block" />
      <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10">展开</button>
    </div>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><section className="flex aspect-video w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[#211e2a] p-4 text-white shadow-2xl sm:p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex items-center gap-3"><h2 className="text-lg font-bold">网易云音乐</h2>{userId && <button onClick={logout} className="text-xs text-white/50 hover:text-white">退出登录</button>}</div><button onClick={() => setOpen(false)} className="text-xl leading-none text-white/60">×</button></div>
      <div className="min-h-0 flex-1 overflow-hidden">{!userId ? <div className="grid h-full place-items-center text-center"><div><p className="mb-4 text-sm text-white/65">{loginMessage}</p>{loginQr ? <img src={loginQr} alt="网易云登录二维码" className="mx-auto h-[min(30vh,208px)] w-[min(30vh,208px)] rounded-lg bg-white p-2" /> : <button onClick={startLogin} className="rounded-lg bg-[#e85d5d] px-5 py-2 text-sm font-bold">获取登录二维码</button>}</div></div> : <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-sm"><button onClick={showHome} className={`rounded-md px-3 py-1.5 ${view === 'home' ? 'bg-white/15 font-bold text-white' : 'text-white/55 hover:bg-white/10'}`}>我喜欢的音乐</button>{view === 'search' && <span className="text-white/35">搜索结果</span>}</div>
        <div className="flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search() }} placeholder="搜索歌曲" className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/35" /><button onClick={search} className="rounded-lg bg-[#e85d5d] px-4 text-sm font-bold">搜索</button></div>
        <div className="mt-3 flex items-center justify-between"><p className="text-xs text-white/50">{view === 'home' ? '我的喜欢' : '搜索结果'}</p><select aria-label="播放模式" value={playMode} onChange={event => setPlayMode(event.target.value as PlayMode)} className="rounded-md bg-white/10 px-2 py-1 text-xs text-white outline-none"><option value="sequential" className="text-black">顺序播放</option><option value="repeat-one" className="text-black">单曲循环</option><option value="random" className="text-black">随机播放</option></select></div>
        {current && <div className="mt-4 flex items-center gap-2 text-[10px] text-white/45"><button onClick={togglePlay} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e85d5d] text-white" aria-label={playing ? '暂停' : '播放'}>{playing ? 'Ⅱ' : '▶'}</button><span>{formatSeconds(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 0} step="0.1" value={currentTime} onChange={event => { const next = Number(event.target.value); setCurrentTime(next); if (audio.current) audio.current.currentTime = next }} className="flex-1 accent-[#e85d5d]" /><span>{formatSeconds(duration)}</span></div>}
        {error && <p className="mt-3 text-xs text-[#ffaaa4]">{error}</p>}
        <div className="scrollbar-hidden mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">{songs.map(song => <button key={song.id} onClick={() => playSong(song)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10 ${current?.id === song.id ? 'bg-white/10' : ''}`}><span className="min-w-0 flex-1 truncate text-sm">{song.name}</span><span className="max-w-40 truncate text-xs text-white/45">{(song.artists || song.ar || []).map(item => item.name).join(' / ')}</span></button>)}</div>
      </div>}</div>
    </section></div>}
  </>
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return '00:00'
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}
