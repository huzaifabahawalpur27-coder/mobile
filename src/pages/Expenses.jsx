import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import PasswordModal from '../components/PasswordModal'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { Calendar, Search, Filter, Plus, X, Edit3, Trash2, Wallet, Tag } from 'lucide-react'
import { getBankAccounts, deductBankBalance, creditBankBalance } from '../services/bankService'

export const getTodayDateStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const getYesterdayDateStr = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const formatDateDDMMYYYY = (dateStr) => {
  if (!dateStr) return ''
  const parts = String(dateStr).slice(0, 10).split('-')
  if (parts.length === 3) {
    const [y, m, d] = parts
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return String(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}-${month}-${year}`
}

export const formatDateFullHuman = (dateStr) => {
  if (!dateStr) return ''
  let d = null
  const parts = String(dateStr).slice(0, 10).split('-')
  if (parts.length === 3) {
    const [y, m, day] = parts.map(Number)
    d = new Date(y, m - 1, day)
  } else {
    d = new Date(dateStr)
  }
  if (!d || isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Tea/Food', 'Salary', 'Misc', 'Repairing', 'Transport']

function Expenses() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)

  // Bank accounts & Cash Drawer selection
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState('')

  // Custom expense categories per shop
  const [customCategories, setCustomCategories] = useState([])
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  const [form, setForm] = useState({
    category: 'Misc',
    amount: '',
    note: '',
    date: getTodayDateStr()
  })

  const [summary, setSummary] = useState({ today: 0, monthly: 0 })
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])
  const [monthlyBudget, setMonthlyBudget] = useState(() => Number(localStorage.getItem('monthly_expense_budget') || 0))
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')

  // Filter states
  const [dateFilter, setDateFilter] = useState('all') // 'all' | 'today' | 'yesterday' | 'this_month' | 'custom'
  const [customDate, setCustomDate] = useState(getTodayDateStr())
  const [searchQuery, setSearchQuery] = useState('')

  // Refs for programmatic calendar picker opening
  const formDateRef = useRef(null)
  const filterDateRef = useRef(null)

  const openFormDatePicker = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const el = formDateRef.current
    if (!el) return
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker()
        return
      }
    } catch (_err) {
      console.warn('showPicker error:', _err)
    }
    try {
      el.focus()
    } catch (_e) {}
  }

  const openFilterDatePicker = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const el = filterDateRef.current
    if (!el) return
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker()
        return
      }
    } catch (_err) {
      console.warn('showPicker error:', _err)
    }
    try {
      el.focus()
    } catch (_e) {}
  }

  // Combined categories list (defaults + custom)
  const allCategories = useMemo(() => {
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...customCategories]))
  }, [customCategories])

  // Load custom categories and bank accounts when shop changes
  useEffect(() => {
    if (user?.shop_id) {
      try {
        const saved = localStorage.getItem(`custom_expense_categories_${user.shop_id}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) setCustomCategories(parsed)
        }
      } catch (_) {}
      fetchExpenses()
      loadBankAccounts()
    }
  }, [user?.shop_id])

  const loadBankAccounts = async () => {
    if (!user?.shop_id) return
    try {
      const list = await getBankAccounts(user.shop_id)
      setBankAccounts(list)
      setSelectedAccountId(prev => {
        if (prev && list.some(a => String(a.id) === String(prev))) return prev
        const cash = list.find(a => 
          a.bank_name?.toLowerCase().includes('cash') || 
          a.account_name?.toLowerCase().includes('cash') ||
          a.is_default
        ) || list[0]
        return cash ? String(cash.id) : ''
      })
    } catch (err) {
      console.warn('Expenses: failed to load bank accounts:', err)
    }
  }

  const handleAddCustomCategory = (e) => {
    e?.preventDefault()
    const trimmed = newCategoryName.trim()
    if (!trimmed) return

    const exists = allCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())
    if (!exists) {
      const updated = [...customCategories, trimmed]
      setCustomCategories(updated)
      if (user?.shop_id) {
        localStorage.setItem(`custom_expense_categories_${user.shop_id}`, JSON.stringify(updated))
      }
    }

    setForm(f => ({ ...f, category: trimmed }))
    setNewCategoryName('')
    setShowAddCategoryModal(false)
  }

  const handleDeleteCustomCategory = (catToDelete) => {
    const updated = customCategories.filter(c => c !== catToDelete)
    setCustomCategories(updated)
    if (user?.shop_id) {
      localStorage.setItem(`custom_expense_categories_${user.shop_id}`, JSON.stringify(updated))
    }
    if (form.category === catToDelete) {
      setForm(f => ({ ...f, category: 'Misc' }))
    }
  }

  const fetchExpenses = async () => {
    setLoading(true)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase
        .from('expenses')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        // account_id lives on this device only: keep it when re-caching the server rows
        try {
          const localRows = await db.expenses.bulkGet(cleanData.map(r => r.id))
          localRows.forEach((row, i) => {
            if (row?.account_id && cleanData[i].account_id == null) {
              cleanData[i].account_id = row.account_id
              data[i].account_id = row.account_id
            }
          })
        } catch (_) { /* cache only */ }
        setExpenses(data)
        calculateSummary(data)
        await db.expenses.bulkPut(cleanData)
      }
    } catch (_e) {
      console.log('Expenses: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.expenses.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))
        const filtered = sorted.filter(x => String(x.shop_id) === String(user.shop_id))
        setExpenses(filtered)
        calculateSummary(filtered)
      } catch (err) {
        console.error('Local DB Expenses Error:', err)
      }
    } finally {
      setLoading(false)
    }
  }

  // Which cash / bank account an expense was paid from
  const accountIdOfExpense = (exp) => {
    if (!exp) return ''
    if (exp.account_id && bankAccounts.some(a => String(a.id) === String(exp.account_id))) return String(exp.account_id)
    const pm = String(exp.payment_method || 'cash').toLowerCase()
    const isCash = (a) => a.bank_name?.toLowerCase().includes('cash') || a.account_name?.toLowerCase().includes('cash')
    const matched = bankAccounts.find(a =>
      (pm === 'cash' && isCash(a)) ||
      a.bank_name?.toLowerCase() === pm ||
      a.account_name?.toLowerCase() === pm
    )
    return matched ? String(matched.id) : ''
  }

  const calculateSummary = (data) => {
    const todayStr = getTodayDateStr()
    const today = new Date()
    const currentMonth = today.getMonth()
    const currentYear = today.getFullYear()

    const todayTotal = data
      .filter(e => {
        if (e.date) return String(e.date).slice(0, 10) === todayStr
        const d = new Date(e.created_at)
        if (isNaN(d.getTime())) return false
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        return dStr === todayStr
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0)

    const monthlyTotal = data
      .filter(e => {
        let d = null
        if (e.date) {
          const [y, m, day] = String(e.date).split('-').map(Number)
          d = new Date(y, m - 1, day)
        } else if (e.created_at) {
          d = new Date(e.created_at)
        }
        if (!d || isNaN(d.getTime())) return false
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear
      })
      .reduce((sum, e) => sum + Number(e.amount || 0), 0)

    setSummary({ today: todayTotal, monthly: monthlyTotal })
  }

  const resetForm = () => {
    setEditingId(null)
    setForm({
      category: 'Misc',
      amount: '',
      note: '',
      date: getTodayDateStr()
    })
    // Reset to default cash drawer or first account
    const cash = bankAccounts.find(a => 
      a.bank_name?.toLowerCase().includes('cash') || 
      a.account_name?.toLowerCase().includes('cash') ||
      a.is_default
    ) || bankAccounts[0]
    if (cash) setSelectedAccountId(String(cash.id))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    const selectedDateStr = form.date || getTodayDateStr()
    const isToday = selectedDateStr === getTodayDateStr()
    const now = new Date()
    const [y, m, d] = selectedDateStr.split('-').map(Number)
    // If today, keep current time; if past/future, set to midday to avoid UTC date boundary shifts
    const expenseDate = isToday ? now : new Date(y, m - 1, d, 12, 0, 0)
    const isoString = expenseDate.toISOString()

    const selectedAcc = bankAccounts.find(a => String(a.id) === String(selectedAccountId))
    const isCashAcc = selectedAcc ? (
      selectedAcc.bank_name?.toLowerCase().includes('cash') || 
      selectedAcc.account_name?.toLowerCase().includes('cash')
    ) : true
    const paymentMethodStr = selectedAcc ? (isCashAcc ? 'cash' : (selectedAcc.bank_name || selectedAcc.account_name || 'bank')) : 'cash'

    const payload = {
      category: form.category,
      amount: parseFloat(form.amount) || 0,
      note: form.note || '',
      description: form.note || '',
      date: selectedDateStr,
      created_at: isoString,
      shop_id: user.shop_id,
      payment_method: paymentMethodStr
    }

    try {
      let savedExpenseId = editingId
      if (editingId) {
        let { error } = await supabase.from('expenses').update(payload).eq('id', editingId)
        if (error && (error.message?.includes('column') || error.code === 'PGRST204')) {
          const minimal = {
            category: payload.category,
            amount: payload.amount,
            description: payload.description,
            shop_id: payload.shop_id,
            created_at: payload.created_at
          }
          const retryRes = await supabase.from('expenses').update(minimal).eq('id', editingId)
          error = retryRes.error
        }
        if (error) throw error
      } else {
        let { data, error } = await supabase.from('expenses').insert([payload]).select().maybeSingle()
        if (error && (error.message?.includes('column') || error.code === 'PGRST204')) {
          const minimal = {
            category: payload.category,
            amount: payload.amount,
            description: payload.description,
            shop_id: payload.shop_id,
            created_at: payload.created_at
          }
          const retryRes = await supabase.from('expenses').insert([minimal]).select().maybeSingle()
          data = retryRes.data
          error = retryRes.error
        }
        if (error) throw error
        if (data?.id) savedExpenseId = data.id
      }

      // Deduct or adjust expense in the selected Bank Account or Cash Drawer
      try {
        if (selectedAccountId && payload.amount > 0) {
          const accDesc = selectedAcc ? (selectedAcc.bank_name ? `${selectedAcc.bank_name} - ${selectedAcc.account_name}` : selectedAcc.account_name) : 'Cash Drawer'

          if (!editingId) {
            // New expense: deduct full amount from the chosen bank account / cash drawer
            await deductBankBalance({
              shopId: user.shop_id,
              accountId: selectedAccountId,
              amount: payload.amount,
              referenceType: 'EXPENSE',
              referenceId: String(savedExpenseId || ''),
              description: `Shop Expense: ${payload.category} (${accDesc})${payload.note ? ` - ${payload.note}` : ''}`
            })
          } else {
            // Editing existing expense: handle amount and account differences
            const oldExpense = expenses.find(e => e.id === editingId)
            const oldAmount = Number(oldExpense?.amount || 0)
            const newAmount = Number(payload.amount || 0)
            // The account the expense was really paid from. The account id is kept on this
            // device only, so after a reload it is worked out from the saved payment method
            // (it used to fall back to the newly chosen account, hiding an account change).
            const oldAccId = accountIdOfExpense(oldExpense) || selectedAccountId

            if (String(oldAccId) === String(selectedAccountId)) {
              // Same account: adjust net difference
              const diff = newAmount - oldAmount
              if (diff > 0) {
                await deductBankBalance({
                  shopId: user.shop_id,
                  accountId: selectedAccountId,
                  amount: diff,
                  referenceType: 'EXPENSE_EDIT',
                  referenceId: String(editingId),
                  description: `Expense Increase: ${payload.category} (+Rs. ${diff.toLocaleString()})`
                })
              } else if (diff < 0) {
                await creditBankBalance({
                  shopId: user.shop_id,
                  accountId: selectedAccountId,
                  amount: Math.abs(diff),
                  referenceType: 'EXPENSE_EDIT',
                  referenceId: String(editingId),
                  description: `Expense Reduction: ${payload.category} (-Rs. ${Math.abs(diff).toLocaleString()})`
                })
              }
            } else {
              // Account changed: refund old account completely, deduct new amount from new account
              if (oldAmount > 0) {
                await creditBankBalance({
                  shopId: user.shop_id,
                  accountId: oldAccId,
                  amount: oldAmount,
                  referenceType: 'EXPENSE_ACCOUNT_SWITCH',
                  referenceId: String(editingId),
                  description: `Expense Account Switch Refund: ${payload.category}`
                })
              }
              if (newAmount > 0) {
                await deductBankBalance({
                  shopId: user.shop_id,
                  accountId: selectedAccountId,
                  amount: newAmount,
                  referenceType: 'EXPENSE',
                  referenceId: String(editingId),
                  description: `Shop Expense: ${payload.category} (${accDesc})${payload.note ? ` - ${payload.note}` : ''}`
                })
              }
            }
          }
        }
      } catch (accErr) {
        console.warn('Could not adjust bank balance on expense change:', accErr)
      }

      // Mirror account_id to local Dexie for seamless client caching
      if (savedExpenseId) {
        await db.expenses.update(savedExpenseId, {
          account_id: selectedAccountId,
          payment_method: paymentMethodStr
        }).catch(() => {})
      }

      resetForm()
      setShowForm(false)
      await Promise.all([fetchExpenses(), loadBankAccounts()])
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId
          ? { ...payload, id: editingId, account_id: selectedAccountId }
          : { ...payload, id: crypto.randomUUID(), created_at: payload.created_at, date: payload.date, account_id: selectedAccountId }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('expenses', action, offlineData)
        if (editingId) {
          await db.expenses.update(editingId, offlineData)
        } else {
          await db.expenses.add(offlineData)
        }
        resetForm()
        setShowForm(false)
        fetchExpenses()
        alert('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        alert(error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (exp) => {
    let dateStr = getTodayDateStr()
    if (exp.date) {
      dateStr = String(exp.date).slice(0, 10)
    } else if (exp.created_at) {
      const d = new Date(exp.created_at)
      if (!isNaN(d.getTime())) {
        dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }

    if (exp.account_id) {
      setSelectedAccountId(String(exp.account_id))
    } else if (exp.payment_method) {
      const pm = String(exp.payment_method).toLowerCase()
      const matched = bankAccounts.find(a => 
        (pm === 'cash' && (a.bank_name?.toLowerCase().includes('cash') || a.account_name?.toLowerCase().includes('cash'))) ||
        a.bank_name?.toLowerCase() === pm ||
        a.account_name?.toLowerCase() === pm
      )
      if (matched) setSelectedAccountId(String(matched.id))
    }

    setForm({
      category: exp.category || 'Misc',
      amount: exp.amount ?? '',
      note: exp.note || exp.description || '',
      date: dateStr
    })
    setEditingId(exp.id)
    setShowForm(true)
  }

  const requestDelete = (ids) => {
    setPendingDeleteIds(ids)
    setShowPasswordModal(true)
  }

  const executeDelete = async () => {
    setShowPasswordModal(false)
    const ids = pendingDeleteIds
    setPendingDeleteIds([])

    let successCount = 0
    let failCount = 0
    const successfulIds = []

    for (const id of ids) {
      const item = expenses.find(e => e.id === id)
      if (!item) continue

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('expenses').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue('expenses', 'DELETE', { id })
        }

        await moveToTrash('expenses', id, item, user.id, user.shop_id)
        await db.expenses.delete(id)

        // Refund expense back to the selected Account / Cash Drawer
        if (item.amount > 0) {
          try {
            const targetAccountId = accountIdOfExpense(item) || bankAccounts[0]?.id

            if (targetAccountId) {
              await creditBankBalance({
                shopId: user.shop_id,
                accountId: targetAccountId,
                amount: item.amount,
                referenceType: 'EXPENSE_REVERSAL',
                referenceId: String(id),
                description: `Expense Deletion Refund: ${item.category}`
              })
            }
          } catch (accErr) {
            console.warn('Could not refund account for deleted expense:', accErr)
          }
        }

        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setExpenses(prev => prev.filter(e => !successfulIds.includes(e.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} expense(s) moved to Trash!`)
    }
    await Promise.all([fetchExpenses(), loadBankAccounts()])
  }

  const saveBudget = () => {
    const val = Number(budgetInput)
    if (!isNaN(val) && val >= 0) {
      setMonthlyBudget(val)
      localStorage.setItem('monthly_expense_budget', val)
    }
    setEditingBudget(false)
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Filtered expenses list
  const filteredExpenses = useMemo(() => {
    const todayStr = getTodayDateStr()
    const yesterdayStr = getYesterdayDateStr()
    const now = new Date()
    const curMonth = now.getMonth()
    const curYear = now.getFullYear()

    return expenses.filter(exp => {
      let dStr = ''
      let d = null
      if (exp.date) {
        dStr = String(exp.date).slice(0, 10)
        const [y, m, day] = dStr.split('-').map(Number)
        d = new Date(y, m - 1, day)
      } else if (exp.created_at) {
        d = new Date(exp.created_at)
        if (!isNaN(d.getTime())) {
          dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        }
      }

      if (dateFilter === 'today' && dStr !== todayStr) return false
      if (dateFilter === 'yesterday' && dStr !== yesterdayStr) return false
      if (dateFilter === 'this_month') {
        if (!d || d.getMonth() !== curMonth || d.getFullYear() !== curYear) return false
      }
      if (dateFilter === 'custom' && customDate) {
        if (dStr !== customDate) return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const cat = (exp.category || '').toLowerCase()
        const note = (exp.note || exp.description || '').toLowerCase()
        const amt = String(exp.amount || '')
        const pm = String(exp.payment_method || '').toLowerCase()
        if (!cat.includes(q) && !note.includes(q) && !amt.includes(q) && !dStr.includes(q) && !pm.includes(q)) {
          return false
        }
      }

      return true
    })
  }, [expenses, dateFilter, customDate, searchQuery])

  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)
  }, [filteredExpenses])

  const toggleSelectAll = () => {
    if (selected.length === filteredExpenses.length && filteredExpenses.length > 0) {
      setSelected([])
    } else {
      setSelected(filteredExpenses.map(x => x.id))
    }
  }

  const formatExpenseDate = (dateVal, createdAtVal) => {
    let d = null
    let rawDateStr = ''
    if (dateVal) {
      rawDateStr = String(dateVal).slice(0, 10)
      const [y, m, day] = rawDateStr.split('-').map(Number)
      d = new Date(y, m - 1, day)
    } else if (createdAtVal) {
      d = new Date(createdAtVal)
      if (!isNaN(d.getTime())) {
        rawDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }
    if (!d || isNaN(d.getTime())) return '-'

    const todayStr = getTodayDateStr()
    const yesterdayStr = getYesterdayDateStr()
    const ddMmYyyy = formatDateDDMMYYYY(rawDateStr)
    const monthText = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

    if (rawDateStr === todayStr) {
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            Today
          </span>
          <span className="font-extrabold text-gray-900 dark:text-white tabular-nums tracking-wide">{ddMmYyyy}</span>
          <span className="text-xs text-gray-400 font-medium">({monthText})</span>
        </div>
      )
    }
    if (rawDateStr === yesterdayStr) {
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            Yesterday
          </span>
          <span className="font-extrabold text-gray-900 dark:text-white tabular-nums tracking-wide">{ddMmYyyy}</span>
          <span className="text-xs text-gray-400 font-medium">({monthText})</span>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-extrabold text-gray-900 dark:text-white tabular-nums tracking-wide">{ddMmYyyy}</span>
        <span className="text-xs text-gray-400 font-medium">({monthText})</span>
      </div>
    )
  }

  if (!hasFeature('expenses')) return <UpgradeWall feature="expenses" />

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Top Banner / Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
            <span>💸 Expenses</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
              خرچے
            </span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-xs sm:text-sm mt-0.5">
            Track daily expenditures with automatic bank account & cash drawer deduction
          </p>
        </div>

        <div className="flex gap-3 w-full sm:w-auto overflow-x-auto pb-1 items-center flex-wrap">
          {/* Today's Expense Card */}
          <div className="bg-white dark:bg-[#1c1c1e] p-3.5 sm:p-4 rounded-2xl shadow-2xs border border-gray-200/80 dark:border-white/10 text-center min-w-[125px]">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Today (آج)</p>
            <p className="text-xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
              Rs. {Math.round(summary.today).toLocaleString()}
            </p>
          </div>

          {/* This Month's Expense Card */}
          <div className="bg-white dark:bg-[#1c1c1e] p-3.5 sm:p-4 rounded-2xl shadow-2xs border border-gray-200/80 dark:border-white/10 text-center min-w-[125px]">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">This Month (اس مہینے)</p>
            <p className="text-xl font-black text-gray-900 dark:text-white tabular-nums">
              Rs. {Math.round(summary.monthly).toLocaleString()}
            </p>
          </div>

          {/* Monthly Budget Card */}
          {(() => {
            const pct = monthlyBudget > 0 ? Math.min((summary.monthly / monthlyBudget) * 100, 100) : 0
            const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'
            const textColor = pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-emerald-600'
            return (
              <div className="bg-white dark:bg-[#1c1c1e] p-3.5 sm:p-4 rounded-2xl shadow-2xs border border-gray-200/80 dark:border-white/10 min-w-[170px]">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Monthly Budget</p>
                  <button
                    onClick={() => { setBudgetInput(monthlyBudget); setEditingBudget(true) }}
                    className="text-[10px] text-blue-500 hover:text-blue-700 font-bold cursor-pointer"
                    title="Edit budget"
                  >
                    ✏️
                  </button>
                </div>
                {editingBudget ? (
                  <div className="flex gap-1 mt-1">
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveBudget(); if (e.key === 'Escape') setEditingBudget(false) }}
                      autoFocus
                      className="w-24 px-2 py-1 border rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white"
                      placeholder="Budget..."
                    />
                    <button onClick={saveBudget} className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs font-bold cursor-pointer">✓</button>
                  </div>
                ) : monthlyBudget > 0 ? (
                  <>
                    <p className={`text-base sm:text-lg font-black ${textColor} tabular-nums`}>
                      Rs. {Math.round(summary.monthly).toLocaleString()} <span className="text-xs text-gray-400 font-normal">/ {monthlyBudget.toLocaleString()}</span>
                    </p>
                    <div className="w-full bg-gray-100 dark:bg-white/10 rounded-full h-1.5 mt-1.5">
                      <div className={`${barColor} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className={`text-[10px] font-bold mt-1 ${textColor}`}>${pct.toFixed(0)}% used</p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 italic mt-1">Set a budget ✏️</p>
                )}
              </div>
            )
          })()}

          {/* New Expense Button */}
          <button
            onClick={() => {
              if (showForm) {
                setShowForm(false)
                resetForm()
              } else {
                resetForm()
                setShowForm(true)
              }
            }}
            className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl shadow-md transition font-bold text-sm flex items-center gap-2 cursor-pointer active:scale-95"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            <span>{showForm ? 'Cancel' : '+ Add Expense (نیا خرچہ)'}</span>
          </button>
        </div>
      </div>

      {/* Expense Input / Edit Form */}
      {showForm && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl shadow-xl p-6 sm:p-7 border border-blue-100 dark:border-white/10 max-w-2xl mx-auto transition-all animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-black text-gray-900 dark:text-white text-lg sm:text-xl flex items-center gap-2">
                <span>{editingId ? 'Edit Expense' : 'Record Expense'}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                  {editingId ? 'خرچہ تبدیل کریں' : 'نیا خرچہ'}
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Expense will be deducted from your chosen Cash Drawer or Bank Account automatically
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm() }}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition cursor-pointer"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Date Selector with Quick Past-Date Pills & Explicit DD-MM-YYYY Display */}
            <div className="bg-gradient-to-br from-blue-50/70 to-indigo-50/40 dark:from-blue-950/30 dark:to-indigo-950/20 p-4 rounded-2xl border border-blue-200/80 dark:border-blue-800/40">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                <label className="text-xs font-bold text-blue-950 dark:text-blue-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar size={14} className="text-blue-600 dark:text-blue-400" />
                  <span>Expense Date (خرچے کی تاریخ)</span>
                  {form.date !== getTodayDateStr() && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                      Previous Date (پرانی تاریخ)
                    </span>
                  )}
                </label>

                {/* Quick Date Pills */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, date: getTodayDateStr() }))}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      form.date === getTodayDateStr()
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 hover:bg-gray-100 border border-gray-200/60 dark:border-white/10'
                    }`}
                  >
                    Today (آج)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, date: getYesterdayDateStr() }))}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                      form.date === getYesterdayDateStr()
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white dark:bg-[#2c2c2e] text-gray-700 dark:text-gray-300 hover:bg-gray-100 border border-gray-200/60 dark:border-white/10'
                    }`}
                  >
                    Yesterday (گزشتہ کل)
                  </button>
                </div>
              </div>

              {/* Explicit DD-MM-YYYY Date Box with Working Calendar showPicker */}
              <div className="relative">
                <input
                  ref={formDateRef}
                  type="date"
                  required
                  value={form.date}
                  max={getTodayDateStr()}
                  onChange={e => {
                    if (e.target.value) setForm(f => ({ ...f, date: e.target.value }))
                  }}
                  className="absolute inset-0 opacity-0 pointer-events-none w-full h-full -z-10"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <div
                  onClick={openFormDatePicker}
                  className="w-full px-4 py-3 bg-white dark:bg-[#2c2c2e] border-2 border-blue-300 dark:border-blue-700/80 rounded-xl flex items-center justify-between shadow-2xs hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
                    <span className="text-base sm:text-lg font-black text-blue-700 dark:text-blue-400 tabular-nums tracking-wider">
                      {formatDateDDMMYYYY(form.date)}
                    </span>
                    <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                      📅 {formatDateFullHuman(form.date)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={openFormDatePicker}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-lg shadow-2xs transition shrink-0 cursor-pointer"
                  >
                    <Calendar size={15} />
                    <span>Change Date</span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-blue-900/90 dark:text-blue-300/90 mt-2 flex items-center gap-1.5 flex-wrap">
                <span>💡 Displayed as:</span>
                <span className="font-extrabold text-blue-800 dark:text-blue-200 underline">DD-MM-YYYY</span>
                <span>({formatDateDDMMYYYY(form.date)} = {formatDateFullHuman(form.date)})</span>
              </p>
            </div>

            {/* 2. Category & Amount Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Category Dropdown with Custom Add Button */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    Category (قسم / خرچے کی قسم)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowAddCategoryModal(true)}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1 cursor-pointer transition active:scale-95"
                  >
                    <Plus size={13} />
                    <span>Add Custom</span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <select
                    value={form.category}
                    onChange={e => {
                      if (e.target.value === '__ADD_NEW__') {
                        setShowAddCategoryModal(true)
                      } else {
                        setForm({ ...form, category: e.target.value })
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl font-semibold text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__ADD_NEW__" className="font-bold text-blue-600 dark:text-blue-400">
                      ➕ + Add Custom Expense Type...
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCategoryModal(true)}
                    className="px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition flex items-center justify-center shrink-0 cursor-pointer font-bold text-xs"
                    title="Add custom expense type"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                  Amount (Rs.) (رقم)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">Rs.</span>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                    className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl font-black text-gray-900 dark:text-white text-base focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* 3. Deduct From (Bank Account or Cash Drawer) */}
              <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                  <label className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet size={15} className="text-blue-600 dark:text-blue-400" />
                    <span>Deduct From (Account / Cash Drawer)</span>
                    <span className="text-[10px] text-gray-400 font-normal">(رقم کی کٹوتی)</span>
                  </label>
                  {(() => {
                    const selectedAcc = bankAccounts.find(a => String(a.id) === String(selectedAccountId))
                    if (!selectedAcc) return null
                    const isSufficient = selectedAcc.current_balance >= Number(form.amount || 0)
                    return (
                      <span className={`text-xs font-black tabular-nums font-mono px-2.5 py-0.5 rounded-lg border inline-flex items-center gap-1 self-start sm:self-auto ${
                        isSufficient
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                      }`}>
                        <span>Available Balance:</span>
                        <span>Rs. {Number(selectedAcc.current_balance).toLocaleString()}</span>
                      </span>
                    )
                  })()}
                </div>

                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl font-bold text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {bankAccounts.length === 0 ? (
                    <option value="">Loading accounts...</option>
                  ) : (
                    bankAccounts.map(acc => {
                      const isCash = acc.bank_name?.toLowerCase().includes('cash') || acc.account_name?.toLowerCase().includes('cash')
                      return (
                        <option key={acc.id} value={acc.id}>
                          {isCash ? '💵 Cash in Hand / Drawer (گلہ)' : `🏦 ${acc.bank_name ? `${acc.bank_name} - ` : ''}${acc.account_name}`} (Bal: Rs. {Number(acc.current_balance).toLocaleString()})
                        </option>
                      )
                    })
                  )}
                </select>

                {(() => {
                  const selectedAcc = bankAccounts.find(a => String(a.id) === String(selectedAccountId))
                  if (selectedAcc && Number(form.amount || 0) > selectedAcc.current_balance) {
                    return (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 font-semibold flex items-center gap-1">
                        <span>⚠️ Note:</span>
                        <span>Expense amount (Rs. {Number(form.amount || 0).toLocaleString()}) exceeds balance in {selectedAcc.account_name}. Balance will become negative after deduction.</span>
                      </p>
                    )
                  }
                  return null
                })()}
              </div>

              {/* Note / Description */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                  Note / Description (تفصیل)
                </label>
                <input
                  type="text"
                  value={form.note}
                  onChange={e => setForm({ ...form, note: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl font-medium text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. Electricity bill, Staff lunch, Courier fee, Shop cleaning..."
                />
              </div>
            </div>

            {/* Submit Action */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-98 text-white font-black text-sm rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {saving ? (
                  <span>Saving & Deducting...</span>
                ) : (
                  <>
                    <span>{editingId ? 'Update Expense' : 'Save & Deduct Expense (خرچہ محفوظ کریں)'}</span>
                    <span className="text-blue-200 text-xs font-medium">
                      • {formatDateDDMMYYYY(form.date)} ({formatDateFullHuman(form.date)})
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Bar & Controls */}
      <div className="bg-white dark:bg-[#1c1c1e] p-4 rounded-2xl shadow-2xs border border-gray-200/80 dark:border-white/10 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Quick Date Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Filter size={13} />
              <span>Date:</span>
            </span>
            {[
              { id: 'all', label: 'All (سب)' },
              { id: 'today', label: 'Today (آج)' },
              { id: 'yesterday', label: 'Yesterday (کل)' },
              { id: 'this_month', label: 'This Month (ماہ)' },
              { id: 'custom', label: 'Select Date 📅' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setDateFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                  dateFilter === tab.id
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search category, account or note..."
              className="w-full pl-9 pr-3 py-1.5 text-xs font-medium bg-gray-50 dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {/* Custom Date Input Strip (with explicit DD-MM-YYYY format and working picker) */}
        {dateFilter === 'custom' && (
          <div className="pt-2 border-t border-gray-100 dark:border-white/5 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Choose Specific Date:</span>
            <div className="relative">
              <input
                ref={filterDateRef}
                type="date"
                value={customDate}
                max={getTodayDateStr()}
                onChange={e => {
                  if (e.target.value) setCustomDate(e.target.value)
                }}
                className="absolute inset-0 opacity-0 pointer-events-none w-full h-full -z-10"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={openFilterDatePicker}
                className="px-3.5 py-1.5 border-2 border-blue-300 dark:border-blue-700 rounded-xl text-xs font-extrabold bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 flex items-center gap-2 hover:border-blue-500 transition cursor-pointer"
              >
                <span className="tabular-nums tracking-wide">{formatDateDDMMYYYY(customDate)}</span>
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">({formatDateFullHuman(customDate)})</span>
                <Calendar size={14} className="text-blue-600 dark:text-blue-400" />
              </button>
            </div>
            <span className="text-xs text-gray-500">
              Showing records for {formatDateDDMMYYYY(customDate)}
            </span>
          </div>
        )}

        {/* Filter Summary & Bulk Delete */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-100 dark:border-white/5 text-gray-500 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span>
              Showing <strong className="text-gray-900 dark:text-white">{filteredExpenses.length}</strong> of {expenses.length} expenses
            </span>
            <span>•</span>
            <span>
              Total: <strong className="text-rose-600 dark:text-rose-400 font-black">Rs. {Math.round(filteredTotal).toLocaleString()}</strong>
            </span>
          </div>

          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Trash2 size={13} />
              <span>Delete Selected ({selected.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Expenses List */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-3xl shadow-sm border border-gray-200/80 dark:border-white/10 overflow-hidden">
        {/* Mobile View: Cards */}
        <div className="divide-y divide-gray-100 dark:divide-white/5 md:hidden">
          {loading ? (
            <p className="px-6 py-12 text-center text-gray-400">Loading expenses...</p>
          ) : filteredExpenses.length === 0 ? (
            <p className="px-6 py-12 text-center text-gray-400 italic">No expenses match your filter.</p>
          ) : filteredExpenses.map(exp => {
            const pm = (exp.payment_method || 'cash').toLowerCase()
            const isCash = pm === 'cash'
            return (
              <div key={exp.id} className={`p-4 ${selected.includes(exp.id) ? 'bg-blue-50/80 dark:bg-blue-950/40' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 rounded-md text-[10px] font-black uppercase tracking-wider">
                        {exp.category}
                      </span>
                      {/* Paid From Pill */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                        isCash
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800'
                      }`}>
                        <span>{isCash ? '💵' : '🏦'}</span>
                        <span>{isCash ? 'Cash Drawer' : exp.payment_method}</span>
                      </span>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatExpenseDate(exp.date, exp.created_at)}
                      </div>
                    </div>
                    <p className="mt-1.5 font-bold text-gray-900 dark:text-white text-sm">
                      {exp.note || exp.description || 'No description'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.includes(exp.id)}
                    onChange={() => toggleSelect(exp.id)}
                    className="mt-1 h-4 w-4 rounded text-blue-600"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-white/5">
                  <p className="text-base font-black text-rose-600 dark:text-rose-400 tabular-nums">
                    Rs. {Number(exp.amount || 0).toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(exp)}
                      className="rounded-lg bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 size={12} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => requestDelete([exp.id])}
                      className="rounded-lg bg-rose-50 dark:bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Desktop View: Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left">
            <thead className="bg-gray-50 dark:bg-white/[0.03] border-b border-gray-100 dark:border-white/10">
              <tr>
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={selected.length === filteredExpenses.length && filteredExpenses.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                </th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Expense Date (DD-MM-YYYY)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Category (قسم)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Paid From (کٹوتی کھاتہ)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap min-w-[180px]">Description (تفصیل)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-right whitespace-nowrap">Amount (رقم)</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400">Loading expenses...</td>
                </tr>
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400 italic">No expenses match your selected filter.</td>
                </tr>
              ) : filteredExpenses.map(exp => {
                const pm = (exp.payment_method || 'cash').toLowerCase()
                const isCash = pm === 'cash'
                return (
                  <tr
                    key={exp.id}
                    className={`hover:bg-gray-50/80 dark:hover:bg-white/[0.02] transition group ${
                      selected.includes(exp.id) ? 'bg-blue-50/70 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(exp.id)}
                        onChange={() => toggleSelect(exp.id)}
                        className="w-4 h-4 rounded text-blue-600"
                      />
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {formatExpenseDate(exp.date, exp.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 rounded-full text-xs font-bold uppercase tracking-wider">
                        {exp.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${
                        isCash
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800'
                      }`}>
                        <span>{isCash ? '💵' : '🏦'}</span>
                        <span>{isCash ? 'Cash Drawer' : exp.payment_method}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 font-medium">
                      {exp.note || exp.description || <span className="text-gray-400 italic">-</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-black text-rose-600 dark:text-rose-400 text-base tabular-nums">
                      Rs. {Number(exp.amount || 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={() => handleEdit(exp)}
                          className="text-blue-600 dark:text-blue-400 hover:underline font-bold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => requestDelete([exp.id])}
                          className="text-rose-600 dark:text-rose-400 hover:underline font-bold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Custom Category Modal */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-3xl p-6 shadow-2xl border border-gray-200 dark:border-white/10 animate-in fade-in duration-150">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                  <Tag size={16} />
                </div>
                <h3 className="text-base font-black text-gray-900 dark:text-white">
                  Add Custom Expense Type
                </h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddCategoryModal(false); setNewCategoryName('') }}
                className="w-7 h-7 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Enter a new expense category name. It will be added to your dropdown and saved for future use.
            </p>

            <form onSubmit={handleAddCustomCategory} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                  Expense Type Name (خرچے کا نام)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Generator Fuel, Internet, Printing, Courier..."
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#2c2c2e] border border-gray-200 dark:border-white/10 rounded-xl font-bold text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Existing Custom Categories List */}
              {customCategories.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    Your Custom Categories:
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1.5 bg-gray-50 dark:bg-[#2c2c2e] rounded-xl border border-gray-200/60 dark:border-white/5">
                    {customCategories.map(cat => (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-[#1c1c1e] text-gray-800 dark:text-gray-200 text-xs font-bold rounded-lg border border-gray-200 dark:border-white/10 shadow-2xs"
                      >
                        <span>{cat}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomCategory(cat)}
                          className="text-gray-400 hover:text-red-500 cursor-pointer text-xs"
                          title={`Delete ${cat}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddCategoryModal(false); setNewCategoryName('') }}
                  className="flex-1 py-2.5 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-gray-700 dark:text-gray-300 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-sm transition cursor-pointer active:scale-95"
                >
                  Add & Select (محفوظ کریں)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <PasswordModal
          title="Delete Expense(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Expenses
