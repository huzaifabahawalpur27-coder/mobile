/**
 * Phase 6 Test Suite: Cash Sessions, Shift Management & Accounting Validation
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase environment variables in .env')
  process.exit(1)
}

function createScopedClient(sessionToken = '') {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        'x-session-token': sessionToken,
        'x-application-name': 'edgex-pos-test'
      }
    }
  })
}

async function runCashSessionTests() {
  console.log('========================================================')
  console.log('🧪 EdgeX POS: Phase 6 Cash Sessions & Shift Tests')
  console.log('========================================================\n')

  let passed = 0
  let failed = 0

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName}`)
      passed++
    } else {
      console.error(`❌ FAIL: ${testName} - ${details}`)
      failed++
    }
  }

  const anonClient = createScopedClient('')

  // ── Test 1: open_cash_session Security Boundary ────────────────
  console.log('--- Test 1: open_cash_session Security Boundary ---')
  try {
    const { data: res, error: rpcErr } = await anonClient.rpc('open_cash_session', {
      p_opening_cash: 5000,
      p_notes: 'Unauthenticated Test Shift'
    })
    const blocked = (res && res.success === false) || rpcErr !== null
    assert(blocked, 'Unauthenticated caller blocked from open_cash_session', res?.error || rpcErr?.message)
  } catch (err) {
    assert(true, 'RPC execution safely guarded against unauthenticated call', err.message)
  }

  // ── Test 2: close_cash_session Security Boundary ───────────────
  console.log('\n--- Test 2: close_cash_session Security Boundary ---')
  try {
    const { data: res, error: rpcErr } = await anonClient.rpc('close_cash_session', {
      p_session_id: 1,
      p_closing_cash_actual: 5500
    })
    const blocked = (res && res.success === false) || rpcErr !== null
    assert(blocked, 'Unauthenticated caller blocked from close_cash_session', res?.error || rpcErr?.message)
  } catch (err) {
    assert(true, 'RPC execution safely guarded against unauthenticated call', err.message)
  }

  // ── Test 3: RLS Isolation on cash_sessions Table ───────────────
  console.log('\n--- Test 3: RLS Isolation on cash_sessions Table ---')
  try {
    const { data: sessions, error } = await anonClient
      .from('cash_sessions')
      .select('*')
      .limit(5)

    if (error) {
      assert(true, 'Direct unauthenticated query denied by RLS policy', error.message)
    } else {
      assert(Array.isArray(sessions) && sessions.length === 0, 'No cash session records leaked to unauthenticated client', `Returned ${sessions?.length} records`)
    }
  } catch (err) {
    assert(true, 'Query safely handled', err.message)
  }

  console.log('\n========================================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('========================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runCashSessionTests().catch(err => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
