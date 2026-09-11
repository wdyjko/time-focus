import { useEffect, useRef, useState } from 'react'

type Song = { id: number; name: string; artists?: { name: string }[]; ar?: { name: string }[]; al?: { picUrl?: string; name?: string } }
type Playlist = { id: number; name: string; coverImgUrl?: string; picUrl?: string; trackCount?: number; specialType?: number }
type PlayMode = 'repeat-one' | 'sequential' | 'random'
type MusicView = 'home' | 'search'
const USER_KEY = 'tomato-clock-netease-user-id'
const SESSION_KEY = 'tomato-clock-netease-session'
// In production this is normally the URL of the separately deployed music API.
// An empty value keeps same-origin requests usable when the API is colocated.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

const api = async (path: string, userId?: string, method: 'GET' | 'POST' = 'GET') => {
  const sessionToken = localStorage.getItem(SESSION_KEY)
  const headers = userId || sessionToken ? { ...(userId ? { 'X-User-Id': userId } : {}), ...(sessionToken ? { 'X-Music-Session': sessionToken } : {}) } : undefined
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
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [playlistLoading, setPlaylistLoading] = useState(false)
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
  const playlistTracksCache = useRef(new Map<number, Song[]>())

  useEffect(() => () => window.clearInterval(poller.current), [])
  useEffect(() => { queueRef.current = songs }, [songs])
  useEffect(() => { playModeRef.current = playMode }, [playMode])
  useEffect(() => {
    if (!userId) return
    playlistTracksCache.current.clear()
    setPlaylistLoading(true)
    api('/api/music/playlist', userId).then(async result => {
      const available = (result.playlist || []) as Playlist[]
      setPlaylists(available)
      const favorite = available.find(item => item.specialType === 5) || available[0]
      if (!favorite) return
      setSelectedPlaylistId(favorite.id)
      const tracks = await api(`/api/music/playlist/${favorite.id}`, userId)
      const favoriteSongs = (tracks.songs || []).slice(0, 30)
      playlistTracksCache.current.set(favorite.id, favoriteSongs)
      setHomeSongs(favoriteSongs)
      setSongs(favoriteSongs)
    }).catch(() => undefined).finally(() => setPlaylistLoading(false))
  }, [userId])
  const selectPlaylist = async (playlist: Playlist) => {
    if (playlist.id === selectedPlaylistId && view === 'home') return
    if (playlist.id === selectedPlaylistId) {
      setView('home')
      setSongs(homeSongs)
      setError('')
      return
    }
    setSelectedPlaylistId(playlist.id)
    setView('home')
    const cachedSongs = playlistTracksCache.current.get(playlist.id)
    if (cachedSongs) {
      setSongs(cachedSongs)
      setHomeSongs(cachedSongs)
      setError('')
      return
    }
    setPlaylistLoading(true)
    try {
      const tracks = await api(`/api/music/playlist/${playlist.id}`, userId)
      const nextSongs = (tracks.songs || []).slice(0, 30)
      playlistTracksCache.current.set(playlist.id, nextSongs)
      setSongs(nextSongs)
      setHomeSongs(nextSongs)
      setError('')
    } catch { setError('歌单加载失败，请稍后重试') }
    finally { setPlaylistLoading(false) }
  }
  const startLogin = async () => {
    try {
      const result = await api('/api/music/login/qr', undefined, 'POST')
      setLoginQr(result.qrimg); setLoginMessage('请使用网易云音乐 App 扫码')
      window.clearInterval(poller.current)
      poller.current = window.setInterval(async () => {
        const status = await api(`/api/music/login/status?sessionId=${encodeURIComponent(result.sessionId)}`)
        if (status.code === 803) { window.clearInterval(poller.current); localStorage.setItem(USER_KEY, status.userId); if (status.sessionToken) localStorage.setItem(SESSION_KEY, status.sessionToken); setUserId(status.userId); setLoginMessage('登录成功'); setTimeout(() => setOpen(false), 700) }
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
      // Keep playback HTTPS-compatible when an older API instance still
      // returns an HTTP Netease CDN URL.
      const rawUrl = result.data?.[0]?.url
      const url = typeof rawUrl === 'string' ? rawUrl.replace(/^http:\/\//i, 'https://') : rawUrl
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
  const seek = (value: number) => {
    setCurrentTime(value)
    if (audio.current) audio.current.currentTime = value
  }
  const logout = async () => {
    try { if (userId) await api('/api/music/logout', userId, 'POST') } catch { /* Local logout still completes if the BFF is unavailable. */ }
    audio.current?.pause()
    if (audio.current) audio.current.src = ''
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(SESSION_KEY)
    playlistTracksCache.current.clear()
    setUserId(''); setLoginQr(null); setLoginMessage('扫码登录网易云音乐'); setSongs([]); setHomeSongs([]); setPlaylists([]); setSelectedPlaylistId(null); setCurrent(null); setPlaying(false); setView('home'); setError('')
  }

  return <>
    <div onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true) } }} role="button" tabIndex={0} aria-label="展开网易云音乐播放器" className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-5xl -translate-x-1/2 cursor-pointer rounded-2xl border border-white/10 bg-[#17151d]/95 px-3 py-2 text-white shadow-xl backdrop-blur-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e85d5d]">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2a2635] text-lg">
          {current?.al?.picUrl ? <img src={current.al.picUrl} alt={`${current.name} 专辑封面`} className={`album-art h-9 w-9 rounded-full object-cover ${playing ? 'is-playing' : ''}`} /> : '♫'}
        </div>
        <div className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold">{current?.name || '网易云音乐'}</p><p className="truncate text-xs text-white/55">{current ? (current.artists || current.ar || []).map(item => item.name).join(' / ') : userId ? '搜索音乐并开始播放' : '登录后播放你的歌单'}</p></div>
        <button onClick={event => { event.stopPropagation(); void togglePlay() }} disabled={!current} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e85d5d] disabled:opacity-40" aria-label={playing ? '暂停' : '播放'}>{playing ? <PauseIcon /> : '▶'}</button>
        <input onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const next = Number(event.target.value); setVolume(next); if (audio.current) audio.current.volume = next }} className="hidden w-20 cursor-pointer accent-[#e85d5d] sm:block" />
      </div>
      {current && <div onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} className="mt-1.5 flex cursor-default items-center gap-2 px-0.5 text-[10px] text-white/45"><span className="w-9 text-right tabular-nums">{formatSeconds(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 0} step="0.1" value={currentTime} onChange={event => seek(Number(event.target.value))} className="h-3 min-w-0 flex-1 cursor-pointer accent-[#e85d5d]" /><span className="w-9 tabular-nums">{formatSeconds(duration)}</span></div>}
    </div>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><section className="flex h-[min(88vh,720px)] max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[#211e2a] p-4 text-white shadow-2xl sm:p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex items-center gap-3"><h2 className="text-lg font-bold">网易云音乐</h2>{userId && <button onClick={logout} className="text-xs text-white/50 hover:text-white">退出登录</button>}</div><button onClick={() => setOpen(false)} className="text-xl leading-none text-white/60">×</button></div>
      <div className="min-h-0 flex-1 overflow-hidden">{!userId ? <div className="grid h-full place-items-center text-center"><div><p className="mb-4 text-sm text-white/65">{loginMessage}</p>{loginQr ? <img src={loginQr} alt="网易云登录二维码" className="mx-auto h-[min(30vh,208px)] w-[min(30vh,208px)] rounded-lg bg-white p-2" /> : <button onClick={startLogin} className="rounded-lg bg-[#e85d5d] px-5 py-2 text-sm font-bold">获取登录二维码</button>}</div></div> : <div className="flex h-full min-h-0 flex-col">
        <div className="mb-3 border-b border-white/10 pb-3">
          <div className="scrollbar-hidden grid h-[132px] grid-cols-2 content-start gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6" aria-label="我的歌单">
            {playlists.map(playlist => <button key={playlist.id} onClick={() => void selectPlaylist(playlist)} aria-pressed={selectedPlaylistId === playlist.id} className={`group flex h-[132px] min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left transition ${selectedPlaylistId === playlist.id && view === 'home' ? 'bg-white/15 ring-1 ring-[#e85d5d]' : 'hover:bg-white/10'}`}>
              {playlist.coverImgUrl || playlist.picUrl ? <img src={playlist.coverImgUrl || playlist.picUrl} alt="" loading="lazy" decoding="async" className="h-16 w-full rounded-md object-cover" /> : <div className="grid h-16 place-items-center rounded-md bg-white/10 text-xl">♫</div>}
              <span title={playlist.name} className="line-clamp-2 w-full break-words text-xs font-medium leading-4">{playlist.name}</span>
              <span className="text-[10px] text-white/40">{playlist.trackCount ?? 0} 首</span>
            </button>)}
            {playlistLoading && <span className="self-center px-2 text-xs text-white/45">加载中...</span>}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm"><button onClick={showHome} className={`rounded-md px-3 py-1.5 ${view === 'home' ? 'bg-white/15 font-bold text-white' : 'text-white/55 hover:bg-white/10'}`}>当前歌单</button>{view === 'search' && <span className="text-white/35">搜索结果</span>}</div>
        </div>
        <div className="flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') search() }} placeholder="搜索歌曲" className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/35" /><button onClick={search} className="rounded-lg bg-[#e85d5d] px-4 text-sm font-bold">搜索</button></div>
        <div className="mt-3 flex items-center justify-between"><p className="max-w-[70%] truncate text-xs text-white/50">{view === 'home' ? (playlists.find(item => item.id === selectedPlaylistId)?.name || '当前歌单') : '搜索结果'}</p><select aria-label="播放模式" value={playMode} onChange={event => setPlayMode(event.target.value as PlayMode)} className="rounded-md bg-white/10 px-2 py-1 text-xs text-white outline-none"><option value="sequential" className="text-black">顺序播放</option><option value="repeat-one" className="text-black">单曲循环</option><option value="random" className="text-black">随机播放</option></select></div>
        {current && <div className="mt-4 flex items-center gap-2 text-[10px] text-white/45"><button onClick={togglePlay} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e85d5d] text-white" aria-label={playing ? '暂停' : '播放'}>{playing ? <PauseIcon /> : '▶'}</button><span>{formatSeconds(currentTime)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 0} step="0.1" value={currentTime} onChange={event => seek(Number(event.target.value))} className="flex-1 accent-[#e85d5d]" /><span>{formatSeconds(duration)}</span></div>}
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

function PauseIcon() {
  return <span aria-hidden="true" className="inline-block rotate-90 text-base font-black leading-none">=</span>
}
