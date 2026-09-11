const express = require('express')
const crypto = require('crypto')
const ncm = require('NeteaseCloudMusicApi')
const serverless = require('serverless-http')
const app = express()
const port = Number(process.env.PORT || 3000)
const sessions = new Map()
const qrSessions = new Map()
const sessionSecret = process.env.MUSIC_SESSION_SECRET || process.env.SESSION_SECRET || 'change-this-session-secret'
const sessionKey = crypto.createHash('sha256').update(sessionSecret).digest()
const createSessionToken = cookie => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv)
  const encrypted = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.')
}
const readSessionToken = token => {
  try {
    const [iv, tag, encrypted] = String(token || '').split('.').map(value => Buffer.from(value, 'base64url'))
    if (!iv || !tag || !encrypted) return ''
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch { return '' }
}
app.use(express.json())
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin
  const allowedOrigins = (process.env.CORS_ALLOW_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  const originAllowed = !requestOrigin || allowedOrigins.includes(requestOrigin)
  if (originAllowed) res.setHeader('Access-Control-Allow-Origin', requestOrigin || allowedOrigins[0])
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-Music-Session')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(originAllowed ? 204 : 403)
  next()
})
const userCookie = req => readSessionToken(req.header('x-music-session')) || sessions.get(req.header('x-user-id')) || ''
const send = async (res, operation, query, cookie = '') => { try { const result = await operation({ ...query, cookie }); res.status(result.status || 200).json(result.body || result) } catch (error) { res.status(error.status || 502).json({ code: error.status || 502, msg: '网易云服务暂时不可用' }) } }
app.post('/api/music/login/qr', async (_req, res) => { try { const keyResult = await ncm.login_qr_key({}); const key = keyResult.body?.data?.unikey; if (!key) return res.status(502).json({ msg: '二维码密钥获取失败' }); const qrResult = await ncm.login_qr_create({ key, qrimg: true }); const sessionId = crypto.randomUUID(); qrSessions.set(sessionId, { key, cookie: '' }); res.json({ sessionId, qrimg: qrResult.body?.data?.qrimg, qrurl: qrResult.body?.data?.qrurl }) } catch { res.status(502).json({ msg: '二维码服务暂时不可用' }) } })
app.get('/api/music/login/status', async (req, res) => { const session = qrSessions.get(req.query.sessionId); if (!session) return res.status(404).json({ code: 404, msg: '登录二维码已失效' }); try { const result = await ncm.login_qr_check({ key: session.key, cookie: session.cookie }); const body = result.body || {}; if (Array.isArray(result.cookie) && result.cookie.length) session.cookie = result.cookie.join(';'); if (body.code !== 803) return res.json({ code: body.code, message: body.message || '等待扫码' }); const userResult = await ncm.login_status({ cookie: session.cookie }); const userId = String(userResult.body?.data?.account?.id || userResult.body?.profile?.userId || crypto.randomUUID()); sessions.set(userId, session.cookie); qrSessions.delete(req.query.sessionId); res.json({ code: 803, userId, sessionToken: createSessionToken(session.cookie) }) } catch { res.json({ code: 801, message: '等待扫码' }) } })
app.get('/api/music/search', (req, res) => send(res, ncm.search, { keywords: String(req.query.keywords || ''), limit: 20, type: 1 }, userCookie(req)))
app.get('/api/music/playlist', (req, res) => send(res, ncm.user_playlist, { uid: req.header('x-user-id'), limit: 30 }, userCookie(req)))
app.get('/api/music/playlist/:id', (req, res) => send(res, ncm.playlist_track_all, { id: req.params.id, limit: 50 }, userCookie(req)))
// Netease frequently returns an HTTP CDN URL. The frontend is normally served
// over HTTPS (Vercel), where using that URL is blocked as mixed content and
// some browsers may expose a decoder error instead of a useful message.
app.get('/api/music/song/:id', async (req, res) => {
  try {
    const result = await ncm.song_url({ id: req.params.id, level: 'standard', cookie: userCookie(req) })
    const body = result.body || result
    if (Array.isArray(body.data)) {
      body.data = body.data.map(item => item?.url?.startsWith('http://')
        ? { ...item, url: item.url.replace(/^http:\/\//i, 'https://') }
        : item)
    }
    res.status(result.status || 200).json(body)
  } catch (error) {
    res.status(error.status || 502).json({ code: error.status || 502, msg: '网易云服务暂时不可用' })
  }
})
app.post('/api/music/logout', (req, res) => { const userId = req.header('x-user-id'); if (userId) sessions.delete(userId); res.json({ code: 200 }) })
// Tencent SCF invokes this handler through an API Gateway event. Normalize
// the query field used by Tencent before handing it to serverless-http.
const serverlessHandler = serverless(app)
const cloudHandler = async (event, context) => serverlessHandler({
  ...event,
  queryStringParameters: event.queryStringParameters || event.queryString || {},
  requestContext: event.requestContext || {},
}, context)

module.exports = { app, handler: cloudHandler, main_handler: cloudHandler }

if (require.main === module) {
  app.listen(port, () => console.log(`Music BFF running at http://localhost:${port}`))
}
