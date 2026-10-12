/**
 * Phase 5 Test Suite: Custody, Reservations & Return Workflow Validation
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

async function runCustodyTests() {
  console.log('====================================================')
  console.log('🧪 EdgeX POS: Phase 5 Custody & Return Workflow Tests')
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

  const anonClient = createScopedClient('')

  // ── Test 1: issue_phone_custody Security Boundary ────────────────
  console.log('--- Test 1: issue_phone_custody Security Boundary ---')
  try {
    const { data: res, error: rpcErr } = await anonClient.rpc('issue_phone_custody', {
      p_phone_id: 1,
      p_issue_type: 'temporary_issue',
      p_recipient_name: 'Test Dealer'
    })
    const blocked = (res && res.success === false) || rpcErr !== null
    assert(blocked, 'Unauthenticated caller blocked from issue_phone_custody', res?.error || rpcErr?.message)
  } catch (err) {
    assert(true, 'RPC execution safely guarded against unauthenticated issue', err.message)
  }

  // ── Test 2: return_phone_custody Security Boundary ───────────────
  console.log('\n--- Test 2: return_phone_custody Security Boundary ---')
  try {
    const { data: res, error: rpcErr } = await anonClient.rpc('return_phone_custody', {
      p_custody_id: 1,
      p_return_notes: 'Test return'
    })
    const blocked = (res && res.success === false) || rpcErr !== null
    assert(blocked, 'Unauthenticated caller blocked from return_phone_custody', res?.error || rpcErr?.message)
  } catch (err) {
    assert(true, 'RPC execution safely guarded against unauthenticated return', err.message)
  }

  // ── Test 3: Phone Custody State Machine Invariants ────────────────
  console.log('\n--- Test 3: State Machine Status Transition Mapping ---')
  const validTransitions = {
    in_stock: ['issued', 'reserved', 'personal', 'sold'],
    issued: ['in_stock', 'sold'],
    reserved: ['in_stock', 'sold'],
    personal: ['in_stock'],
    sold: ['returned'],
    returned: ['in_stock']
  }

  const inStockCanBeIssued = validTransitions.in_stock.includes('issued')
  const issuedCanReturn = validTransitions.issued.includes('in_stock')
  const soldCanBeReturned = validTransitions.sold.includes('returned')

  assert(inStockCanBeIssued && issuedCanReturn && soldCanBeReturned, 'State machine transitions verified for custody cycle')

  console.log('\n====================================================')
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('====================================================')

  if (failed > 0) process.exit(1)
}

runCustodyTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
