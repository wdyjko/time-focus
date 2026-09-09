const express = require('express')
const crypto = require('crypto')
const ncm = require('NeteaseCloudMusicApi')
const app = express()
const port = Number(process.env.PORT || 3000)
const sessions = new Map()
const qrSessions = new Map()
app.use(express.json())
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin
  const allowedOrigin = process.env.CORS_ALLOW_ORIGIN || 'http://localhost:5173'
  if (!requestOrigin || requestOrigin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin || allowedOrigin)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(requestOrigin && requestOrigin !== allowedOrigin ? 403 : 204)
  next()
})
const userCookie = req => sessions.get(req.header('x-user-id')) || ''
const send = async (res, operation, query, cookie = '') => { try { const result = await operation({ ...query, cookie }); res.status(result.status || 200).json(result.body || result) } catch (error) { res.status(error.status || 502).json({ code: error.status || 502, msg: '网易云服务暂时不可用' }) } }
app.post('/api/music/login/qr', async (_req, res) => { try { const keyResult = await ncm.login_qr_key({}); const key = keyResult.body?.data?.unikey; if (!key) return res.status(502).json({ msg: '二维码密钥获取失败' }); const qrResult = await ncm.login_qr_create({ key, qrimg: true }); const sessionId = crypto.randomUUID(); qrSessions.set(sessionId, { key, cookie: '' }); res.json({ sessionId, qrimg: qrResult.body?.data?.qrimg, qrurl: qrResult.body?.data?.qrurl }) } catch { res.status(502).json({ msg: '二维码服务暂时不可用' }) } })
app.get('/api/music/login/status', async (req, res) => { const session = qrSessions.get(req.query.sessionId); if (!session) return res.status(404).json({ code: 404, msg: '登录二维码已失效' }); try { const result = await ncm.login_qr_check({ key: session.key, cookie: session.cookie }); const body = result.body || {}; if (Array.isArray(result.cookie) && result.cookie.length) session.cookie = result.cookie.join(';'); if (body.code !== 803) return res.json({ code: body.code, message: body.message || '等待扫码' }); const userResult = await ncm.login_status({ cookie: session.cookie }); const userId = String(userResult.body?.data?.account?.id || userResult.body?.profile?.userId || crypto.randomUUID()); sessions.set(userId, session.cookie); qrSessions.delete(req.query.sessionId); res.json({ code: 803, userId }) } catch { res.json({ code: 801, message: '等待扫码' }) } })
app.get('/api/music/search', (req, res) => send(res, ncm.search, { keywords: String(req.query.keywords || ''), limit: 20, type: 1 }, userCookie(req)))
app.get('/api/music/playlist', (req, res) => send(res, ncm.user_playlist, { uid: req.header('x-user-id'), limit: 30 }, userCookie(req)))
app.get('/api/music/playlist/:id', (req, res) => send(res, ncm.playlist_track_all, { id: req.params.id, limit: 50 }, userCookie(req)))
app.get('/api/music/song/:id', (req, res) => send(res, ncm.song_url, { id: req.params.id, level: 'standard' }, userCookie(req)))
app.post('/api/music/logout', (req, res) => { const userId = req.header('x-user-id'); if (userId) sessions.delete(userId); res.json({ code: 200 }) })
app.listen(port, () => console.log(`Music BFF running at http://localhost:${port}`))
