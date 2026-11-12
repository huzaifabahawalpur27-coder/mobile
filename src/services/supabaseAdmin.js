// Privileged admin operations are proxied through the authenticated server API.
// Never place a Supabase service-role key in browser code.

// The admin API answers with JSON. Anything else (an empty 404/405 page) means the API
// server is not running or not deployed for this site: say so instead of a JSON crash.
async function readAdminResponse(response) {
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (body === null) {
    const hint = [404, 405, 500, 501, 502, 503, 504].includes(response.status)
      ? 'The admin server is not reachable on this site (/api). Deploy it (api/index.js on Vercel) or start it with npm run api.'
      : 'Unexpected reply from the admin server.'
    return { ok: false, body: { error: `${hint} (HTTP ${response.status})`, code: `HTTP_${response.status}` } }
  }
  return { ok: response.ok, body }
}

class AdminQuery {
  constructor(table) {
    this.payload = { table, method: 'GET', select: '*', filters: [], orders: [] }
  }
  select(columns = '*') { this.payload.select = columns; if (this.payload.method !== 'GET') this.payload.returning = true; return this }
  insert(body) { this.payload.method = 'POST'; this.payload.body = body; this.payload.returning = false; return this }
  upsert(body, options = {}) { this.payload.method = 'POST'; this.payload.body = body; this.payload.onConflict = options.onConflict; this.payload.returning = false; return this }
  update(body) { this.payload.method = 'PATCH'; this.payload.body = body; this.payload.returning = false; return this }
  delete() { this.payload.method = 'DELETE'; this.payload.returning = false; return this }
  filter(op, column, value) { this.payload.filters.push({ op, column, value }); return this }
  eq(c, v) { return this.filter('eq', c, v) }
  neq(c, v) { return this.filter('neq', c, v) }
  gt(c, v) { return this.filter('gt', c, v) }
  gte(c, v) { return this.filter('gte', c, v) }
  lt(c, v) { return this.filter('lt', c, v) }
  lte(c, v) { return this.filter('lte', c, v) }
  ilike(c, v) { return this.filter('ilike', c, v) }
  like(c, v) { return this.filter('like', c, v) }
  is(c, v) { return this.filter('is', c, v) }
  in(c, v) { return this.filter('in', c, v) }
  or(v) { return this.filter('or', '', v) }
  not(c, operator, v) { this.payload.filters.push({ op: 'not', column: c, operator, value: v }); return this }
  order(column, options = {}) { this.payload.orders.push({ column, ascending: options.ascending !== false }); return this }
  limit(value) { this.payload.limit = value; return this }
  single() { this.payload.single = 'single'; return this }
  maybeSingle() { this.payload.single = 'maybeSingle'; return this }
  then(resolve, reject) { return this.execute().then(resolve, reject) }
  async execute() {
    try {
      const response = await fetch('/api/admin/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('session_token') || ''}` },
        body: JSON.stringify(this.payload)
      })
      const { ok, body: result } = await readAdminResponse(response)
      return ok ? { data: result.data ?? null, error: null } : { data: null, error: { message: result.error || 'Admin request failed', code: result.code } }
    } catch (error) { return { data: null, error: { message: error.message || 'Network error' } } }
  }
}

export const supabaseAdmin = {
  from: table => new AdminQuery(table),
  rpc: async (name, args = {}) => {
    try {
      const response = await fetch(`/api/admin/rpc/${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('session_token') || ''}` }, body: JSON.stringify(args)
      })
      const { ok, body: result } = await readAdminResponse(response)
      return ok ? { data: result.data ?? null, error: null } : { data: null, error: { message: result.error || 'Admin request failed', code: result.code } }
    } catch (error) { return { data: null, error: { message: error.message || 'Network error' } } }
  },
  auth: { admin: {
    createUser: async attributes => adminAuthRequest('create-user', attributes),
    updateUserById: async (id, attributes) => adminAuthRequest('update-user', { id, attributes })
  } }
}

async function adminAuthRequest(action, body) {
  try {
    const response = await fetch(`/api/admin/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('session_token') || ''}` }, body: JSON.stringify(body) })
    const { ok, body: result } = await readAdminResponse(response)
    return ok ? { data: result.data, error: null } : { data: null, error: { message: result.error || 'Admin request failed' } }
  } catch (error) { return { data: null, error: { message: error.message || 'Network error' } } }
}
export default supabaseAdmin
