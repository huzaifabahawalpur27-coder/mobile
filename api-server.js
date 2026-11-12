import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

dotenv.config()

const app = express()
const port = Number(process.env.PORT || 3001)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET
const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const allowedOrigins = new Set((process.env.APP_ORIGINS || 'http://localhost:5173,http://localhost:4173,http://localhost:5174').split(',').map(v => v.trim()).filter(Boolean))
const adminTables = new Set([
  'announcements', 'audit_logs', 'brands', 'categories', 'customers', 'email_templates',
  'expenses', 'products', 'purchases', 'sale_items', 'sales', 'shop_backups',
  'shop_payments', 'shops', 'subscription_plans', 'suppliers', 'users', 'sessions',
  'system_configs', 'support_tickets'
])
const adminRpcs = new Set([
  'get_global_growth_stats', 'get_top_performing_shops', 'get_inactive_shops',
  // Shop notifications (sql/shop_notifications.sql): service role only
  'push_shop_notification', 'list_notification_campaigns', 'withdraw_notification_campaign'
])
const rateBuckets = new Map()

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed'))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600
}))
app.use(express.json({ limit: '1mb' }))

function rateLimit(key, max, windowMs) {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.expiresAt) {
    rateBuckets.set(key, { count: 1, expiresAt: now + windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > max
}

function signAdminToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'superadmin', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url')
  if (!adminSessionSecret) throw new Error('ADMIN_SESSION_SECRET is not configured')
  const signature = createHmac('sha256', adminSessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyAdminToken(token) {
  if (!adminSessionSecret || !token || token.split('.').length !== 2) return null
  const [payload, signature] = token.split('.')
  const expected = createHmac('sha256', adminSessionSecret).update(payload).digest()
  let provided
  try { provided = Buffer.from(signature, 'base64url') } catch { return null }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return decoded.role === 'superadmin' && decoded.exp > Date.now() ? decoded : null
  } catch { return null }
}

async function requireSuperadmin(req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Privileged server API is not configured' })
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!bearer) return res.status(401).json({ error: 'Authentication required' })

  try {
    let userId = null
    const tokenPayload = verifyAdminToken(bearer)
    if (tokenPayload) {
      userId = tokenPayload.sub
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bearer)) {
      const { data: session, error } = await supabase.from('sessions')
        .select('user_id, expires_at').eq('token', bearer).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (error || !session) return res.status(401).json({ error: 'Session expired' })
      userId = session.user_id
    } else {
      return res.status(401).json({ error: 'Invalid session' })
    }

    const { data: user, error } = await supabase.from('users')
      .select('id, username, email, role, is_active').eq('id', userId).maybeSingle()
    if (error || !user || user.is_active === false || user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }
    req.admin = user
    next()
  } catch {
    return res.status(503).json({ error: 'Could not validate administrator session' })
  }
}

function applyFilter(query, filter) {
  const { column, op, value } = filter
  if (op !== 'or' && !/^[a-zA-Z0-9_.,() ]+$/.test(column || '')) throw new Error('Invalid filter column')
  switch (op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': case 'ilike': case 'like': case 'is':
      return query[op](column, value)
    case 'in': return query.in(column, value)
    case 'or': if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid or filter'); return query.or(value)
    case 'not': return query.not(column, filter.operator, value)
    default: throw new Error('Unsupported filter')
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.post('/api/admin/session', async (req, res) => {
  if (!supabase || !adminSessionSecret) return res.status(503).json({ error: 'Administrator login is not configured' })
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (rateLimit(`login:${ip}`, 8, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' })
  const email = String(req.body?.email || '').trim()
  const password = String(req.body?.password || '')
  if (!email || !password || email.length > 254 || password.length > 1024) return res.status(400).json({ error: 'Email and password are required' })

  try {
    const passwordHash = createHash('sha256').update(password, 'utf8').digest('hex')
    const { data: user, error } = await supabase.from('users')
      .select('id, email, username, role, shop_id, is_active')
      .ilike('email', email).eq('password', passwordHash).eq('role', 'superadmin').eq('is_active', true).maybeSingle()
    if (error || !user) return res.status(401).json({ error: 'Invalid email or password' })
    return res.json({ token: signAdminToken(user), user })
  } catch {
    return res.status(503).json({ error: 'Unable to sign in right now' })
  }
})

app.post('/api/admin/session/validate', requireSuperadmin, (req, res) => res.json({ user: req.admin }))

app.post('/api/admin/query', requireSuperadmin, async (req, res) => {
  const { table, method = 'GET', select = '*', filters = [], orders = [], limit, body, onConflict, single } = req.body || {}
  if (!adminTables.has(table)) return res.status(400).json({ error: 'Table is not available through the admin API' })
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return res.status(400).json({ error: 'Unsupported query method' })
  try {
    let query = supabase.from(table)
    if (method === 'POST') query = onConflict ? query.upsert(body, { onConflict }) : query.insert(body)
    else if (method === 'PATCH') query = query.update(body)
    else if (method === 'DELETE') query = query.delete()
    if (method === 'GET' || req.body.returning) query = query.select(select)
    for (const filter of filters) query = applyFilter(query, filter)
    for (const order of orders) {
      if (!/^[a-zA-Z0-9_]+$/.test(order.column || '')) throw new Error('Invalid sort column')
      query = query.order(order.column, { ascending: order.ascending !== false })
    }
    if (Number.isInteger(limit) && limit >= 0 && limit <= 10000) query = query.limit(limit)
    if (single === 'single') query = query.single()
    else if (single === 'maybeSingle') query = query.maybeSingle()
    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message, code: error.code })
    return res.json({ data })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Invalid admin query' })
  }
})

app.post('/api/admin/rpc/:name', requireSuperadmin, async (req, res) => {
  if (!adminRpcs.has(req.params.name)) return res.status(404).json({ error: 'RPC is not available through the admin API' })
  const { data, error } = await supabase.rpc(req.params.name, req.body || {})
  if (error) return res.status(400).json({ error: error.message, code: error.code })
  return res.json({ data })
})

app.post('/api/admin/auth/create-user', requireSuperadmin, async (req, res) => {
  const { email, password, email_confirm = true, user_metadata = {} } = req.body || {}
  if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'A valid email and password of at least 8 characters are required' })
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm, user_metadata })
  if (error) return res.status(400).json({ error: error.message })
  return res.json({ data })
})

app.post('/api/admin/auth/update-user', requireSuperadmin, async (req, res) => {
  const { id, attributes } = req.body || {}
  if (!id || !attributes || typeof attributes !== 'object') return res.status(400).json({ error: 'User ID and attributes are required' })
  const { data, error } = await supabase.auth.admin.updateUserById(id, attributes)
  if (error) return res.status(400).json({ error: error.message })
  return res.json({ data })
})

app.post('/api/admin/send-email', requireSuperadmin, async (req, res) => {
  const { recipients, subject, body } = req.body || {}
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 500 || !subject || !body) {
    return res.status(400).json({ error: 'Recipients (1–500), subject, and body are required' })
  }
  if (String(subject).length > 300 || String(body).length > 500000) return res.status(413).json({ error: 'Email content is too large' })
  const emailLimitKey = `mail:${req.admin.id}`
  if (rateLimit(emailLimitKey, 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'Broadcast limit reached for this hour' })
  if (!resend) return res.status(503).json({ error: 'Email delivery is not configured' })

  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
  let successCount = 0
  let failCount = 0
  for (const recipient of recipients) {
    const to = String(recipient?.to || '').trim()
    const name = String(recipient?.name || 'Shop').slice(0, 160)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) { failCount++; continue }
    const safeName = name.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
    const html = `<div style="font-family:sans-serif;line-height:1.5;color:#334155;padding:20px"><h2>Hello ${safeName} Team,</h2><div>${body}</div><hr/><p>Best regards,<br/><strong>EdgeX POS Administration</strong></p></div>`
    try {
      const result = await resend.emails.send({ from: `EdgeX POS <${from}>`, to, subject: String(subject), html })
      if (result.error) failCount++
      else successCount++
    } catch { failCount++ }
  }
  return res.json({ attempted: recipients.length, successCount, failCount })
})

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON request' })
  if (err.message === 'Origin is not allowed') return res.status(403).json({ error: err.message })
  console.error('API request failed:', err.message)
  return res.status(500).json({ error: 'Request failed' })
})

app.listen(port, () => console.log(`EdgeX API listening on port ${port}`))
