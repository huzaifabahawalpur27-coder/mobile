import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hekqzkrpxqsjfkosilpr.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// This client uses only the public anon key for Supabase Auth flows.
export const supabase = globalThis.__superadminSupabase || createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'sb-superadmin-auth-token', persistSession: true, autoRefreshToken: true }
})
if (import.meta.env.DEV) globalThis.__superadminSupabase = supabase

class AdminQuery {
  constructor(table) { this.payload = { table, method: 'GET', select: '*', filters: [], orders: [] } }
  select(columns = '*') { this.payload.select = columns; if (this.payload.method !== 'GET') this.payload.returning = true; return this }
  insert(body) { this.payload.method = 'POST'; this.payload.body = body; return this }
  upsert(body, options = {}) { this.payload.method = 'POST'; this.payload.body = body; this.payload.onConflict = options.onConflict; return this }
  update(body) { this.payload.method = 'PATCH'; this.payload.body = body; return this }
  delete() { this.payload.method = 'DELETE'; return this }
  filter(op, column, value) { this.payload.filters.push({ op, column, value }); return this }
  eq(c,v){return this.filter('eq',c,v)} neq(c,v){return this.filter('neq',c,v)} gt(c,v){return this.filter('gt',c,v)}
  gte(c,v){return this.filter('gte',c,v)} lt(c,v){return this.filter('lt',c,v)} lte(c,v){return this.filter('lte',c,v)}
  ilike(c,v){return this.filter('ilike',c,v)} like(c,v){return this.filter('like',c,v)} is(c,v){return this.filter('is',c,v)}
  in(c,v){return this.filter('in',c,v)} or(v){return this.filter('or','',v)}
  not(c,operator,v){this.payload.filters.push({op:'not',column:c,operator,value:v});return this}
  order(column,options={}){this.payload.orders.push({column,ascending:options.ascending!==false});return this}
  limit(value){this.payload.limit=value;return this} single(){this.payload.single='single';return this} maybeSingle(){this.payload.single='maybeSingle';return this}
  then(resolve,reject){return this.execute().then(resolve,reject)}
  async execute(){return request('/api/admin/query',this.payload)}
}

async function request(path, body) {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('admin_session_token') || ''}` }, body:JSON.stringify(body) })
    const result = await response.json()
    return response.ok ? {data:result.data ?? null,error:null} : {data:null,error:{message:result.error || 'Admin request failed',code:result.code}}
  } catch(error) { return {data:null,error:{message:error.message || 'Network error'}} }
}

export const supabaseAdmin = {
  from: table => new AdminQuery(table),
  rpc: (name,args={}) => request(`/api/admin/rpc/${encodeURIComponent(name)}`,args),
  auth: { admin: {
    createUser: attributes => request('/api/admin/auth/create-user',attributes),
    updateUserById: (id,attributes) => request('/api/admin/auth/update-user',{id,attributes})
  } }
}
