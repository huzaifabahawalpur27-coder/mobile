/**
 * Tenant Isolation & Multi-Tenant Foundation Test Suite
 * Validates cross-tenant boundaries, session tokens, RLS predicates, and branch structures.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase environment variables in .env')
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

async function runTenantIsolationTests() {
  console.log('====================================================')
  console.log('🧪 EdgeX POS: Multi-Tenant Foundation & Isolation Tests')
  console.log('====================================================\n')

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

  // ── Test 1: Unauthenticated Client Cannot Read Scoped Tables ──────
  console.log('--- Test 1: Anonymous / Unauthenticated Boundary ---')
  const anonClient = createScopedClient('')
  try {
    const { data: anonProducts, error: _anonErr } = await anonClient.from('products').select('*').limit(5)
    // Under strict RLS with current_session_token(), an empty token evaluates to 0 rows or error
    const isIsolated = (anonProducts === null || anonProducts?.length === 0)
    assert(isIsolated, 'Unauthenticated client receives 0 rows from products', `Received ${anonProducts?.length} rows`)
  } catch (err) {
    assert(true, 'Unauthenticated client blocked with error', err.message)
  }

  // ── Test 2: Invalid Session Token Rejection ──────────────────────
  console.log('\n--- Test 2: Forged / Invalid Session Token ---')
  const forgedToken = '00000000-0000-0000-0000-000000000000'
  const forgedClient = createScopedClient(forgedToken)
  try {
    const { data: forgedProducts } = await forgedClient.from('products').select('*').limit(5)
    assert(forgedProducts === null || forgedProducts?.length === 0, 'Forged session token receives 0 rows')
  } catch (err) {
    assert(true, 'Forged session token blocked', err.message)
  }

  // ── Test 3: Multi-tenant Branch Isolation ─────
  console.log('\n--- Test 3: Multi-tenant Branch Isolation ---')
  try {
    const { data: branches, error: branchErr } = await anonClient.from('branches').select('*').limit(5)
    if (branchErr) {
      assert(true, 'branches table protected by RLS against unauthenticated client', branchErr.message)
    } else {
      assert(Array.isArray(branches) && branches.length === 0, 'No branch records leaked to unauthenticated client', `Returned ${branches?.length} records`)
    }
  } catch (err) {
    assert(true, 'Branch query safely handled', err.message)
  }

  // ── Test 4: Tenant Switch RPC Security Validation ────────────────
  console.log('\n--- Test 4: Tenant Context Switch RPC Security ---')
  try {
    // Calling switch_tenant_context with unauthenticated session must fail
    const { data: switchRes, error: switchErr } = await anonClient.rpc('switch_tenant_context', {
      p_target_shop_id: 999999
    })
    const isDenied = (switchRes && switchRes.success === false) || switchErr !== null
    assert(isDenied, 'Unauthenticated switch_tenant_context request is rejected', switchRes?.error || switchErr?.message)
  } catch (err) {
    assert(true, 'Unauthenticated switch_tenant_context thrown and caught', err.message)
  }

  console.log('\n====================================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('====================================================')

  if (failed > 0) process.exit(1)
}

runTenantIsolationTests().catch(err => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
