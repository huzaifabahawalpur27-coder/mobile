import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { printHTML, getShopBranding } from '../utils/printUtils'
import {
  Smartphone,
  Search,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  User,
  Phone,
  Calendar,
  Printer,
  MessageSquare,
  X,
  ArrowRight,
  ArrowLeft,
  Store,
  Users,
  UserCheck,
  Barcode,
  MapPin,
  ExternalLink
} from 'lucide-react'

// Common Market Dealer Suggestions to ensure the dropdown always has options ready
const DEFAULT_MARKET_DEALERS = [
  { id: 'market_1', name: 'Al-Madina Mobiles (Neighbour Shop)', phone: '03001234567', company: 'Shop # 12, Market' },
  { id: 'market_2', name: 'Bismillah Telecom (Opposite Shop)', phone: '03019876543', company: 'Shop # 14, Main Floor' },
  { id: 'market_3', name: 'Khan Mobile Zone (Market Dealer)', phone: '03215551234', company: '1st Floor Counter' },
  { id: 'market_4', name: 'Rehman Cellular (Wholesale Partner)', phone: '03338889999', company: 'Shop # 28' }
]

export default function Custody() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('active') // 'active' | 'history' | 'in_stock' | 'dealers'
  const [custodies, setCustodies] = useState([])
  const [phones, setPhones] = useState([])
  const [dealers, setDealers] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  // Instant 2-Step Issue Custody Modal State
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [issueStep, setIssueStep] = useState(1) // 1 = Select Phone (Model/IMEI search), 2 = Recipient & Terms
  const [phoneSearchQuery, setPhoneSearchQuery] = useState('')
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [issueSubmitting, setIssueSubmitting] = useState(false)
  const [issueForm, setIssueForm] = useState({
    issue_type: 'dealer_trial',
    recipient_name: '',
    recipient_phone: '',
    deposit_amount: '',
    expected_return_date: '',
    notes: ''
  })

  // One-Time Dealer / Neighbouring Shopkeeper Registration Modal
  const [showAddDealerModal, setShowAddDealerModal] = useState(false)
  const [savingDealer, setSavingDealer] = useState(false)
  const [newDealerForm, setNewDealerForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    address: ''
  })

  // Return Confirmation Modal
  const [custodyToReturn, setCustodyToReturn] = useState(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [returnSubmitting, setReturnSubmitting] = useState(false)

  // Feedback Notification Toast
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    if (user?.shop_id) {
      loadData()
    }
  }, [user?.shop_id])

  const showNotification = (msg, isError = false) => {
    setFeedback({ msg, isError })
    setTimeout(() => setFeedback(null), 4000)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // 1. Fetch all phones for the shop
      let loadedPhones = []
      const { data: phonesData, error: phonesErr } = await supabase
        .from('phones')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      if (!phonesErr && phonesData) {
        loadedPhones = phonesData
      } else {
        const localPhones = await db.phones?.toArray ? await db.phones.toArray() : []
        loadedPhones = localPhones.filter(p => String(p.shop_id) === String(user.shop_id))
      }
      setPhones(loadedPhones)

      // 2. Fetch custodies records
      let loadedCustodies = []
      const { data: custodiesData, error: custodiesErr } = await supabase
        .from('phone_custody')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      if (!custodiesErr && custodiesData) {
        loadedCustodies = custodiesData
      } else {
        try {
          const localCustody = await db.phone_custody?.toArray ? await db.phone_custody.toArray() : []
          loadedCustodies = localCustody.filter(c => String(c.shop_id) === String(user.shop_id))
        } catch (_) {
          loadedCustodies = []
        }
      }

      // If phone_custody table is empty but phones have status 'issued' or 'reserved', synthesize records
      const phoneMap = new Map(loadedPhones.map(p => [p.id, p]))
      const enrichedCustodies = loadedCustodies.map(c => ({
        ...c,
        phone: phoneMap.get(c.phone_id) || null
      }))

      // Check if any phone is currently issued/reserved but missing from phone_custody table
      const registeredPhoneIds = new Set(loadedCustodies.filter(c => c.status === 'active').map(c => c.phone_id))
      const orphanCustodyPhones = loadedPhones.filter(p =>
        ['issued', 'reserved', 'personal'].includes(p.status) && !registeredPhoneIds.has(p.id)
      )

      orphanCustodyPhones.forEach(p => {
        enrichedCustodies.unshift({
          id: `orphan-${p.id}`,
          shop_id: p.shop_id,
          phone_id: p.id,
          status: 'active',
          issue_type: p.status === 'reserved' ? 'customer_reservation' : p.status === 'personal' ? 'personal_use' : 'dealer_trial',
          recipient_name: 'Direct In-Store Hold',
          recipient_phone: '',
          deposit_amount: 0,
          expected_return_date: null,
          notes: 'Handover initiated via stock register',
          created_at: p.updated_at || p.created_at,
          phone: p
        })
      })

      setCustodies(enrichedCustodies)

      // 3. Fetch Dealers / Suppliers for dropdown
      try {
        let loadedDealers = []
        const { data: supData } = await supabase
          .from('suppliers')
          .select('id, name, phone, address')
          .eq('shop_id', user.shop_id)
          .order('name')
        if (supData && supData.length > 0) {
          loadedDealers = supData
        } else if (db.suppliers?.toArray) {
          loadedDealers = await db.suppliers.toArray()
        }
        setDealers(loadedDealers.filter(d => String(d.shop_id) === String(user.shop_id)))
      } catch (_) {
        // graceful fallback
      }

      // 4. Fetch Customers for dropdown
      try {
        let loadedCustomers = []
        const { data: custData } = await supabase
          .from('customers')
          .select('id, name, phone')
          .eq('shop_id', user.shop_id)
          .order('name')
          .limit(100)
        if (custData && custData.length > 0) {
          loadedCustomers = custData
        } else if (db.customers?.toArray) {
          loadedCustomers = await db.customers.toArray()
        }
        setCustomers(loadedCustomers.filter(c => String(c.shop_id) === String(user.shop_id)))
      } catch (_) {
        // graceful fallback
      }

    } catch (err) {
      console.error('Error loading custody records:', err)
      showNotification('Failed to load custody data', true)
    } finally {
      setLoading(false)
    }
  }

  // Active Custodies (Currently out of stock / On Hold)
  const activeCustodies = useMemo(() => {
    return custodies.filter(c => c.status === 'active')
  }, [custodies])

  // Returned Custodies History
  const returnedCustodies = useMemo(() => {
    return custodies.filter(c => c.status === 'returned')
  }, [custodies])

  // Available In-Stock Phones (Eligible to be issued)
  const inStockPhones = useMemo(() => {
    return phones.filter(p => p.status === 'in_stock')
  }, [phones])

  // Combined List of Dealers (User's saved dealers + default market suggestions if needed)
  const allAvailableDealers = useMemo(() => {
    if (dealers.length > 0) return dealers
    return DEFAULT_MARKET_DEALERS
  }, [dealers])

  // Filtered in-stock phones based on Instant Model or IMEI search query
  const searchedInStockPhones = useMemo(() => {
    if (!phoneSearchQuery.trim()) return inStockPhones
    const q = phoneSearchQuery.toLowerCase().trim()
    return inStockPhones.filter(p =>
      (p.model || '').toLowerCase().includes(q) ||
      (p.imei1 || '').toLowerCase().includes(q) ||
      (p.imei2 || '').toLowerCase().includes(q) ||
      (p.imei || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.color || '').toLowerCase().includes(q) ||
      (p.storage || '').toLowerCase().includes(q)
    )
  }, [inStockPhones, phoneSearchQuery])

  // Filtered List based on Search & Type
  const filteredActiveCustodies = useMemo(() => {
    return activeCustodies.filter(c => {
      const p = c.phone || {}
      const matchesSearch = !search || [
        c.recipient_name,
        c.recipient_phone,
        p.model,
        p.brand,
        p.imei1,
        p.imei2,
        p.imei,
        c.notes
      ].some(val => (val || '').toLowerCase().includes(search.toLowerCase()))

      const matchesType = typeFilter === 'all' || c.issue_type === typeFilter
      return matchesSearch && matchesType
    })
  }, [activeCustodies, search, typeFilter])

  // Metrics
  const totalDepositHeld = useMemo(() => {
    return activeCustodies.reduce((sum, c) => sum + (parseFloat(c.deposit_amount) || 0), 0)
  }, [activeCustodies])

  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return activeCustodies.filter(c => c.expected_return_date && c.expected_return_date < today).length
  }, [activeCustodies])

  // Count active phones held per dealer
  const getDealerActivePhoneCount = (dealerName) => {
    if (!dealerName) return 0
    const clean = dealerName.toLowerCase()
    return activeCustodies.filter(c => (c.recipient_name || '').toLowerCase().includes(clean)).length
  }

  // Open Issue Modal (Instant 2-Step Flow)
  const handleOpenIssueModal = (phone = null, prefilledRecipient = null) => {
    setSelectedPhone(phone)
    setPhoneSearchQuery('')
    setIssueStep(phone ? 2 : 1)
    setIssueForm({
      issue_type: prefilledRecipient ? 'dealer_trial' : 'dealer_trial',
      recipient_name: prefilledRecipient?.name || '',
      recipient_phone: prefilledRecipient?.phone || '',
      deposit_amount: '',
      expected_return_date: '',
      notes: ''
    })
    setShowIssueModal(true)
  }

  // Quick Preset Handlers
  const handleSelectMyself = () => {
    setIssueForm(prev => ({
      ...prev,
      issue_type: 'personal_use',
      recipient_name: user?.username ? `${user.username} (Self / Staff)` : 'Myself (Store Owner)',
      recipient_phone: user?.phone || '',
      notes: prev.notes || 'Personal store staff use'
    }))
  }

  const handleSelectDealerPreset = (dealer) => {
    if (!dealer) return
    setIssueForm(prev => ({
      ...prev,
      issue_type: 'dealer_trial',
      recipient_name: dealer.name + (dealer.company ? ` (${dealer.company})` : ''),
      recipient_phone: dealer.phone || prev.recipient_phone
    }))
  }

  const handleSelectCustomerPreset = (customer) => {
    if (!customer) return
    setIssueForm(prev => ({
      ...prev,
      issue_type: 'customer_reservation',
      recipient_name: customer.name,
      recipient_phone: customer.phone || prev.recipient_phone
    }))
  }

  // Quick Date Setters
  const handleSetQuickDate = (daysAhead) => {
    const d = new Date()
    d.setDate(d.getDate() + daysAhead)
    const formatted = d.toISOString().split('T')[0]
    setIssueForm(prev => ({ ...prev, expected_return_date: formatted }))
  }

  // Submit New Dealer / Shopkeeper (One-time registration)
  const handleSaveNewDealer = async (e) => {
    e.preventDefault()
    if (!newDealerForm.name.trim()) {
      showNotification('Shop / Dealer name is required', true)
      return
    }

    setSavingDealer(true)
    try {
      const combinedName = newDealerForm.contact_person.trim()
        ? `${newDealerForm.name.trim()} (${newDealerForm.contact_person.trim()})`
        : newDealerForm.name.trim()

      const payload = {
        shop_id: user.shop_id,
        name: combinedName,
        phone: newDealerForm.phone.trim() || null,
        address: newDealerForm.address.trim() || null,
        balance: 0
      }

      let savedDealer = null

      // Try Supabase insert
      const { data: inserted, error: insertErr } = await supabase
        .from('suppliers')
        .insert([payload])
        .select()
        .maybeSingle()

      if (!insertErr && inserted) {
        savedDealer = inserted
      } else {
        const localId = Date.now()
        savedDealer = { id: localId, ...payload, created_at: new Date().toISOString() }
        if (db.suppliers?.put) {
          await db.suppliers.put(savedDealer).catch(() => {})
        }
      }

      showNotification(`✅ Dealer "${combinedName}" saved permanently!`)
      setDealers(prev => [savedDealer, ...prev])

      // If issue modal is active, auto-select this new dealer right now!
      if (showIssueModal) {
        setIssueForm(prev => ({
          ...prev,
          recipient_name: combinedName,
          recipient_phone: newDealerForm.phone.trim() || prev.recipient_phone,
          issue_type: 'dealer_trial'
        }))
      }

      setShowAddDealerModal(false)
      setNewDealerForm({ name: '', contact_person: '', phone: '', address: '' })
    } catch (err) {
      console.error('Failed to save dealer:', err)
      showNotification('Dealer save karte waqt masla pesh aya.', true)
    } finally {
      setSavingDealer(false)
    }
  }

  // Submit Issue Custody
  const handleIssueCustody = async (e) => {
    e.preventDefault()
    if (!selectedPhone) {
      showNotification('Meharbani karke pehle phone select karein', true)
      setIssueStep(1)
      return
    }
    if (!issueForm.recipient_name.trim()) {
      showNotification('Recipient ka naam darj karna lazmi hai', true)
      return
    }

    setIssueSubmitting(true)
    try {
      const depositVal = parseFloat(issueForm.deposit_amount) || 0
      
      // Map UI issue type to the database CHECK constraint: ('temporary_issue', 'reservation', 'personal_use', 'repair')
      const mappedIssueType = 
        issueForm.issue_type === 'customer_reservation' || issueForm.issue_type === 'reservation'
          ? 'reservation'
          : issueForm.issue_type === 'personal_use' || issueForm.issue_type === 'personal'
            ? 'personal_use'
            : issueForm.issue_type === 'repair' || issueForm.issue_type === 'lab_repair'
              ? 'repair'
              : 'temporary_issue'

      // Valid phone status: 'reserved' (locks phone from active inventory & POS)
      const targetStatus = 'reserved'

      let rpcSuccess = false
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('issue_phone_custody', {
          p_phone_id: selectedPhone.id,
          p_issue_type: mappedIssueType,
          p_recipient_name: issueForm.recipient_name.trim(),
          p_recipient_phone: issueForm.recipient_phone.trim() || null,
          p_deposit_amount: depositVal,
          p_expected_return_date: issueForm.expected_return_date || null,
          p_notes: issueForm.notes.trim() || null
        })

        if (!rpcErr && rpcRes && rpcRes.success) {
          rpcSuccess = true
        }
      } catch (rpcCatchErr) {
        console.warn('issue_phone_custody RPC failed, falling back to direct query:', rpcCatchErr)
      }

      if (!rpcSuccess) {
        // Direct query fallback ensuring valid constraints
        const { error: insertErr } = await supabase
          .from('phone_custody')
          .insert({
            shop_id: user.shop_id,
            branch_id: user.branch_id || null,
            phone_id: selectedPhone.id,
            status: 'active',
            issue_type: mappedIssueType,
            recipient_name: issueForm.recipient_name.trim(),
            recipient_phone: issueForm.recipient_phone.trim() || null,
            deposit_amount: depositVal,
            token_deposit: depositVal,
            expected_return_date: issueForm.expected_return_date || null,
            notes: issueForm.notes.trim() || null
          })

        if (insertErr) {
          console.error('Direct insert to phone_custody failed:', insertErr)
          throw insertErr
        }

        const { error: phoneErr } = await supabase
          .from('phones')
          .update({ status: targetStatus, updated_at: new Date().toISOString() })
          .eq('id', selectedPhone.id)

        if (phoneErr) {
          console.error('Update phone status failed:', phoneErr)
          throw phoneErr
        }
      }

      if (db.phones) {
        await db.phones.update(selectedPhone.id, { status: targetStatus }).catch(() => {})
      }

      showNotification(`✅ ${selectedPhone.model} successfully locked & issued into custody!`)
      setShowIssueModal(false)
      loadData()
    } catch (err) {
      console.error('Failed to issue phone custody:', err)
      showNotification(`Custody issue karte waqt masla pesh aya: ${err.message || 'Error'}`, true)
    } finally {
      setIssueSubmitting(false)
    }
  }

  // Open Return Modal
  const handleOpenReturnModal = (custody) => {
    setCustodyToReturn(custody)
    setReturnNotes('')
  }

  // Execute Return to Stock
  const handleConfirmReturn = async () => {
    if (!custodyToReturn) return
    setReturnSubmitting(true)

    try {
      const phoneId = custodyToReturn.phone_id || custodyToReturn.phone?.id
      const custodyId = typeof custodyToReturn.id === 'number' ? custodyToReturn.id : null

      let success = false
      const { data: res, error: rpcErr } = await supabase.rpc('return_phone_custody', {
        p_custody_id: custodyId,
        p_return_notes: returnNotes.trim() || 'Returned to in_stock',
        p_phone_id: phoneId,
        p_notes: returnNotes.trim() || 'Returned to in_stock'
      })

      if (!rpcErr && res?.success) {
        success = true
      }

      if (!success) {
        if (custodyId) {
          await supabase
            .from('phone_custody')
            .update({
              status: 'returned',
              returned_at: new Date().toISOString(),
              notes: custodyToReturn.notes
                ? `${custodyToReturn.notes} | Return: ${returnNotes.trim()}`
                : returnNotes.trim()
            })
            .eq('id', custodyId)
        }

        if (phoneId) {
          await supabase
            .from('phones')
            .update({ status: 'in_stock', updated_at: new Date().toISOString() })
            .eq('id', phoneId)
        }
      }

      if (db.phones && phoneId) {
        await db.phones.update(phoneId, { status: 'in_stock' }).catch(() => {})
      }

      showNotification('✅ Phone successfully returned back to in-stock inventory!')
      setCustodyToReturn(null)
      loadData()
    } catch (err) {
      console.error('Failed to return custody phone:', err)
      showNotification('Phone return karte waqt masla pesh aya.', true)
    } finally {
      setReturnSubmitting(false)
    }
  }

  // Direct WhatsApp Reminder Message
  const handleWhatsAppReminder = (custody) => {
    if (!custody.recipient_phone) {
      showNotification('Is recipient ka phone number darj nahi hai', true)
      return
    }

    const cleanPhone = custody.recipient_phone.replace(/[^0-9]/g, '')
    const targetNumber = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone
    const phoneModel = custody.phone?.model || 'Mobile Phone'
    const imei = custody.phone?.imei1 || custody.phone?.imei || custody.phone?.imei2 || ''
    const deposit = custody.deposit_amount ? `Rs. ${parseFloat(custody.deposit_amount).toLocaleString()}` : '0'

    const message = encodeURIComponent(
      `Assalam-o-Alaikum ${custody.recipient_name}!\n\n` +
      `Yeh reminder hamari shop ki taraf se hai ke aap ke paas hamara device custody/checking par hai:\n` +
      `📱 *Model:* ${phoneModel}\n` +
      (imei ? `🔢 *IMEI:* ${imei}\n` : '') +
      `🤝 *Custody Reason:* ${getCustodyTypeBadge(custody.issue_type).label}\n` +
      (deposit !== '0' ? `💰 *Token Deposit:* ${deposit}\n` : '') +
      (custody.expected_return_date ? `📅 *Expected Return Date:* ${custody.expected_return_date}\n` : '') +
      `\nMeharbani farma kar time par checking mukammal karke confirm karein ya device wapas laiye. Shukriya!`
    )

    window.open(`https://wa.me/${targetNumber}?text=${message}`, '_blank')
  }

  // Print Custody Slip
  const handlePrintSlip = (custody) => {
    const branding = getShopBranding(user?.shop_id)
    const phone = custody.phone || {}
    const imeiText = phone.imei1 || phone.imei || phone.imei2 || 'N/A'

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Custody Voucher - ${phone.model || 'Phone'}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; color: #111; font-size: 13px; }
          .voucher-box { max-width: 650px; margin: auto; border: 2px solid #222; border-radius: 12px; padding: 24px; }
          .header { text-align: center; border-bottom: 2px dashed #999; padding-bottom: 15px; margin-bottom: 15px; }
          .title { font-size: 18px; font-weight: 800; text-transform: uppercase; margin: 6px 0; }
          .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; }
          .table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .table th, .table td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
          .table th { background: #f4f4f4; font-weight: 700; font-size: 11px; text-transform: uppercase; }
          .terms { font-size: 11px; color: #555; line-height: 1.5; margin-top: 15px; padding: 10px; background: #fafafa; border-radius: 6px; }
          .sig-row { display: flex; justify-content: space-between; margin-top: 50px; padding-top: 10px; }
          .sig-box { width: 45%; border-top: 1px solid #333; text-align: center; font-size: 12px; font-weight: 700; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="voucher-box">
          <div class="header">
            <h2 style="margin: 0; font-size: 22px;">${branding.shopName || 'Mobile Store POS'}</h2>
            <div style="font-size: 12px; color: #555;">${branding.address || ''} • Phone: ${branding.phone || ''}</div>
            <div class="title">Official Phone Custody / Handover Voucher</div>
            <div style="font-size: 11px; color: #666;">Date: ${new Date(custody.created_at || Date.now()).toLocaleString()}</div>
          </div>

          <div class="meta-row">
            <div><strong>Recipient:</strong> ${custody.recipient_name}</div>
            <div><strong>Contact:</strong> ${custody.recipient_phone || 'N/A'}</div>
          </div>
          <div class="meta-row">
            <div><strong>Handover Reason:</strong> ${getCustodyTypeBadge(custody.issue_type).label}</div>
            <div><strong>Return Expected:</strong> ${custody.expected_return_date || 'Open/Unspecified'}</div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th>Device Model</th>
                <th>Storage / Color</th>
                <th>Serialized IMEI 1</th>
                <th>IMEI 2 / PTA</th>
                <th>Token Deposit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${phone.model || 'N/A'}</strong></td>
                <td>${phone.storage || '-'} • ${phone.color || '-'}</td>
                <td><span style="font-family: monospace; font-weight: bold;">${imeiText}</span></td>
                <td>${phone.imei2 || '-'} (${phone.pta_status || 'PTA'})</td>
                <td><strong>Rs. ${(parseFloat(custody.deposit_amount) || 0).toLocaleString()}</strong></td>
              </tr>
            </tbody>
          </table>

          ${custody.notes ? `<div style="font-size: 12px; margin: 10px 0;"><strong>Notes:</strong> ${custody.notes}</div>` : ''}

          <div class="terms">
            <strong>Custody Agreement:</strong> The recipient acknowledges temporary custody of the above device in perfect physical and working condition. The device must be returned by the agreed return date. Any damage, scratches, or missing accessories will be deducted from the token deposit or billed to recipient.
          </div>

          <div class="sig-row">
            <div class="sig-box">Recipient Signature</div>
            <div class="sig-box">Shop Officer Signature & Stamp</div>
          </div>
        </div>
      </body>
      </html>
    `
    printHTML(html)
  }

  const getCustodyTypeBadge = (type) => {
    switch (type) {
      case 'dealer_trial':
      case 'temporary_issue':
        return { label: 'Dealer Checking', color: 'bg-blue-50 text-blue-700 border-blue-200' }
      case 'customer_reservation':
        return { label: 'Customer Reservation', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      case 'personal_use':
        return { label: 'Personal / Staff', color: 'bg-purple-50 text-purple-700 border-purple-200' }
      case 'repair_transit':
        return { label: 'Lab / Repair', color: 'bg-amber-50 text-amber-700 border-amber-200' }
      default:
        return { label: type || 'Custody', color: 'bg-gray-50 text-gray-700 border-gray-200' }
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* Header & Page Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
            <Smartphone size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Phone Custody & Hold
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                IMEI Lock
              </span>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 font-medium mt-0.5">
              عارضی فون، ڈیلر چیکنگ، اور کسٹمر بکنگ کی فوری 2-اسٹیپ مینجمنٹ
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddDealerModal(true)}
            className="px-3.5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 text-xs sm:text-sm font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Store size={16} className="text-blue-600" />
            <span>+ Add Dealer</span>
          </button>

          <button
            onClick={() => handleOpenIssueModal()}
            className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md shadow-blue-500/20 transition flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <Plus size={16} />
            <span>Issue Phone Custody</span>
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {feedback && (
        <div className={`p-4 rounded-xl border text-sm font-semibold flex items-center gap-2.5 transition animate-fadeIn ${
          feedback.isError ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
        }`}>
          {feedback.isError ? <AlertTriangle size={18} className="text-red-600 shrink-0" /> : <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Key Metric Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">
            <span>Active on Hold</span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          </div>
          <div className="text-2xl font-black text-gray-900">
            {activeCustodies.length} <span className="text-xs text-gray-400 font-medium">units</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Currently outside vault</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">
            Token Deposit Held
          </div>
          <div className="text-2xl font-black text-emerald-600">
            Rs. {totalDepositHeld.toLocaleString()}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Total security cash received</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">
            Overdue Returns
          </div>
          <div className={`text-2xl font-black ${overdueCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {overdueCount} <span className="text-xs text-gray-400 font-medium">units</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Passed expected return date</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs">
          <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">
            Available In-Stock
          </div>
          <div className="text-2xl font-black text-blue-600">
            {inStockPhones.length} <span className="text-xs text-gray-400 font-medium">units</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Ready for sale or custody</p>
        </div>
      </div>

      {/* Tabs and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'active' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>Active Custodies</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-700 font-bold">
              {activeCustodies.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('dealers')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'dealers' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Store size={13} className="text-blue-600" />
            <span>Market Dealers & Shops</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-100 text-purple-700 font-bold">
              {allAvailableDealers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'history' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>Return History</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-gray-200 text-gray-700 font-bold">
              {returnedCustodies.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('in_stock')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'in_stock' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>In-Stock Phones</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-700 font-bold">
              {inStockPhones.length}
            </span>
          </button>
        </div>

        {/* Search & Type Filter (For Active & History) */}
        {activeTab === 'active' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search recipient, model, IMEI..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              />
            </div>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
            >
              <option value="all">All Reasons</option>
              <option value="dealer_trial">Dealer Checking</option>
              <option value="customer_reservation">Customer Hold</option>
              <option value="personal_use">Personal Use</option>
              <option value="repair_transit">Lab / Repair</option>
            </select>
          </div>
        )}
      </div>

      {/* ── TAB 1: ACTIVE CUSTODIES ── */}
      {activeTab === 'active' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">Loading custody records...</div>
          ) : filteredActiveCustodies.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-base font-bold text-gray-800">No Phones on Custody</h3>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                Currently, all serialized mobile phones are safely inside your shop in-stock inventory vault.
              </p>
              <button
                onClick={() => handleOpenIssueModal()}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition cursor-pointer"
              >
                Issue a Phone on Custody
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                    <th className="p-3.5 pl-5">Phone & Serialized IMEI</th>
                    <th className="p-3.5">Custody Holder</th>
                    <th className="p-3.5">Reason & Purpose</th>
                    <th className="p-3.5">Handover / Due Date</th>
                    <th className="p-3.5">Deposit Held</th>
                    <th className="p-3.5 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredActiveCustodies.map((c) => {
                    const phone = c.phone || {}
                    const typeBadge = getCustodyTypeBadge(c.issue_type)
                    const isOverdue = c.expected_return_date && c.expected_return_date < new Date().toISOString().split('T')[0]
                    const imeiDisplay = phone.imei1 || phone.imei || phone.imei2 || 'No IMEI'

                    return (
                      <tr key={c.id} className="hover:bg-blue-50/40 transition">
                        <td className="p-3.5 pl-5">
                          <div className="font-extrabold text-sm text-gray-900">
                            {phone.model || 'Unknown Phone'}
                          </div>
                          <div className="flex items-center gap-1.5 text-gray-500 font-mono text-[11px] mt-0.5">
                            <span className="font-bold text-gray-800">IMEI:</span>
                            <span className="font-bold text-blue-700 bg-blue-50 px-1 py-0.2 rounded border border-blue-200">
                              {imeiDisplay}
                            </span>
                            {phone.color && <span className="text-gray-400">• {phone.color}</span>}
                            {phone.storage && <span className="text-gray-400">• {phone.storage}</span>}
                          </div>
                        </td>

                        <td className="p-3.5">
                          <div className="font-bold text-gray-900 flex items-center gap-1.5">
                            <User size={13} className="text-gray-400" />
                            <span>{c.recipient_name}</span>
                          </div>
                          {c.recipient_phone ? (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-gray-500 font-mono text-[11px]">{c.recipient_phone}</span>
                              <button
                                onClick={() => handleWhatsAppReminder(c)}
                                className="p-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition cursor-pointer"
                                title="Send WhatsApp Reminder"
                              >
                                <MessageSquare size={12} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-[11px]">No phone listed</span>
                          )}
                        </td>

                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${typeBadge.color}`}>
                            {typeBadge.label}
                          </span>
                          {c.notes && (
                            <p className="text-[11px] text-gray-500 mt-1 max-w-xs truncate" title={c.notes}>
                              {c.notes}
                            </p>
                          )}
                        </td>

                        <td className="p-3.5">
                          <div className="text-gray-600 text-[11px]">
                            Issued: {new Date(c.created_at || Date.now()).toLocaleDateString()}
                          </div>
                          {c.expected_return_date ? (
                            <div className={`flex items-center gap-1 text-[11px] font-bold mt-0.5 ${
                              isOverdue ? 'text-red-600' : 'text-gray-700'
                            }`}>
                              <Calendar size={11} />
                              <span>Due: {c.expected_return_date}</span>
                              {isOverdue && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-bold">OVERDUE</span>}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-[11px]">No deadline</span>
                          )}
                        </td>

                        <td className="p-3.5">
                          <div className="font-bold text-gray-900">
                            Rs. {(parseFloat(c.deposit_amount) || 0).toLocaleString()}
                          </div>
                          <span className="text-[10px] text-gray-400">Security Deposit</span>
                        </td>

                        <td className="p-3.5 pr-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenReturnModal(c)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition cursor-pointer"
                              title="Return Phone back to In-Stock Inventory"
                            >
                              <RotateCcw size={12} />
                              <span>Wapas In-Stock</span>
                            </button>

                            <button
                              onClick={() => handlePrintSlip(c)}
                              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition cursor-pointer"
                              title="Print Custody Handover Slip"
                            >
                              <Printer size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: SEPARATE MODULE: MARKET DEALERS & NEIGHBOURING SHOPS DIRECTORY ── */}
      {activeTab === 'dealers' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden space-y-4 p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-gray-100">
            <div>
              <h2 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                <Store size={18} className="text-blue-600" />
                <span>Market Dealers & Neighbouring Shop Directory</span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                ایک بار پڑوسی دکاندار کا نام و نمبر محفوظ کریں تاکہ ہر بار ڈراپ ڈاؤن میں موجود رہے
              </p>
            </div>

            <button
              onClick={() => setShowAddDealerModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus size={15} />
              <span>+ Register New Neighbour Dealer</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allAvailableDealers.map((d) => {
              const activeCount = getDealerActivePhoneCount(d.name)

              return (
                <div key={d.id} className="p-4 rounded-2xl border border-gray-200 hover:border-blue-300 hover:shadow-xs transition bg-slate-50/50 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-extrabold text-sm text-gray-900 flex items-center gap-2">
                        <Store size={15} className="text-blue-600 shrink-0" />
                        <span>{d.name}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        activeCount > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {activeCount} on hold
                      </span>
                    </div>

                    {d.phone && (
                      <div className="text-xs text-gray-600 font-mono flex items-center gap-1.5">
                        <Phone size={12} className="text-gray-400" />
                        <span>{d.phone}</span>
                      </div>
                    )}

                    {d.address || d.company ? (
                      <div className="text-xs text-gray-500 flex items-center gap-1.5">
                        <MapPin size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{d.address || d.company}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="pt-2 border-t border-gray-200/80 flex items-center justify-between gap-2">
                    {d.phone ? (
                      <a
                        href={`https://wa.me/${d.phone.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-bold flex items-center gap-1 transition"
                      >
                        <MessageSquare size={11} />
                        <span>WhatsApp</span>
                      </a>
                    ) : <span />}

                    <button
                      onClick={() => handleOpenIssueModal(null, d)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>Issue Phone</span>
                      <ArrowRight size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── TAB 3: RETURN HISTORY ── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
          {returnedCustodies.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              Abhi tak koi returned custody record nahi mila.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                    <th className="p-3.5 pl-5">Phone & IMEI</th>
                    <th className="p-3.5">Previous Holder</th>
                    <th className="p-3.5">Reason</th>
                    <th className="p-3.5">Issue & Return Dates</th>
                    <th className="p-3.5">Deposit Released</th>
                    <th className="p-3.5 pr-5">Return Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {returnedCustodies.map((c) => {
                    const phone = c.phone || {}
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/60 transition">
                        <td className="p-3.5 pl-5">
                          <div className="font-bold text-gray-900">{phone.model || 'Phone'}</div>
                          <div className="text-[11px] font-mono text-gray-500">{phone.imei1 || phone.imei || '-'}</div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-semibold text-gray-900">{c.recipient_name}</div>
                          <div className="text-[11px] text-gray-500">{c.recipient_phone || 'N/A'}</div>
                        </td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                            {getCustodyTypeBadge(c.issue_type).label}
                          </span>
                        </td>
                        <td className="p-3.5 text-gray-600">
                          <div>Issued: {new Date(c.created_at).toLocaleDateString()}</div>
                          <div className="text-emerald-700 font-bold">
                            Returned: {c.returned_at ? new Date(c.returned_at).toLocaleDateString() : 'Yes'}
                          </div>
                        </td>
                        <td className="p-3.5 font-bold text-gray-700">
                          Rs. {(parseFloat(c.deposit_amount) || 0).toLocaleString()}
                        </td>
                        <td className="p-3.5 pr-5 text-gray-500">
                          {c.notes || '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: IN-STOCK PHONES (Quick Issue) ── */}
      {activeTab === 'in_stock' && (
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
          <div className="p-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
              Available In-Stock Phones ({inStockPhones.length})
            </span>
            <span className="text-xs text-gray-500">Click any phone to issue custody immediately</span>
          </div>

          <div className="divide-y divide-gray-100">
            {inStockPhones.map(phone => (
              <div key={phone.id} className="p-3.5 hover:bg-blue-50/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                    <Smartphone size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900">{phone.model}</div>
                    <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5 font-mono">
                      <span className="font-bold text-blue-700">IMEI: {phone.imei1 || phone.imei || phone.imei2 || 'Recorded Device'}</span>
                      {phone.color && <span>• {phone.color}</span>}
                      {phone.storage && <span>• {phone.storage}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <div className="text-right">
                    <div className="text-xs font-bold text-gray-900">Rs. {(phone.sale_price || 0).toLocaleString()}</div>
                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">In Stock</span>
                  </div>
                  <button
                    onClick={() => handleOpenIssueModal(phone)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    <span>Issue Custody</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════
          INSTANT 2-STEP ISSUE PHONE CUSTODY / HANDOVER MODAL
          ═════════════════════════════════════════════════════════════════════════ */}
      {showIssueModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-gray-100 overflow-hidden animate-scaleIn flex flex-col max-h-[92vh]">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 text-cyan-300 flex items-center justify-center">
                  <Smartphone size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight leading-tight">
                    Issue Phone Custody / Handover
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    فوری 2-اسٹیپ پروسیجر (ماڈل یا IMEI سرچ اور شخص کا انتخاب)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowIssueModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Step Progress Pills */}
            <div className="px-5 py-3 bg-slate-50 border-b border-gray-200/80 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIssueStep(1)}
                  className={`flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-full transition cursor-pointer ${
                    issueStep === 1
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">1</span>
                  <span>Select Phone (ماڈل یا IMEI)</span>
                </button>

                <span className="text-gray-300">→</span>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedPhone) setIssueStep(2)
                    else showNotification('Pehle Step 1 mein phone select karein', true)
                  }}
                  className={`flex items-center gap-1.5 font-bold px-3 py-1.5 rounded-full transition cursor-pointer ${
                    issueStep === 2
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">2</span>
                  <span>Assign Recipient (کس کو دینا ہے)</span>
                </button>
              </div>

              {selectedPhone && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 hidden sm:inline">
                  Phone Ready ✓
                </span>
              )}
            </div>

            {/* Modal Body with internal scrolling */}
            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              
              {/* ══════════════════════════════════════════════════════════
                  STEP 1: SELECT PHONE (Instant Model or IMEI Search)
                  ══════════════════════════════════════════════════════════ */}
              {issueStep === 1 && (
                <div className="space-y-4">
                  {/* Search Input */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-gray-700">
                      Step 1: Search In-Stock Phone by Model or IMEI *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
                        <Search size={16} />
                      </div>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Search Model (e.g. 15 Pro, S24) or 15-digit IMEI number..."
                        value={phoneSearchQuery}
                        onChange={e => setPhoneSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-10 py-3 bg-gray-50 border-2 border-blue-200 focus:border-blue-600 rounded-2xl text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white outline-none transition"
                      />
                      <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-gray-400">
                        <Barcode size={18} />
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      بارکوڈ اسکینر یا کی بورڈ سے ماڈل یا IMEI ٹائپ کریں اور مطلوبہ فون پر کلک کریں۔
                    </p>
                  </div>

                  {/* Matching Phones Card List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-gray-500 px-1">
                      <span>Available Matching Phones ({searchedInStockPhones.length})</span>
                      <span>Click to select & proceed</span>
                    </div>

                    {searchedInStockPhones.length === 0 ? (
                      <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-300 space-y-2">
                        <p className="text-sm font-bold text-gray-700">No in-stock phone matched "{phoneSearchQuery}"</p>
                        <p className="text-xs text-gray-400">Please check the model name or IMEI spelling, or clear the search.</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {searchedInStockPhones.map(p => {
                          const imeiDisplay = p.imei1 || p.imei || p.imei2 || 'Recorded Device'
                          const isSelected = selectedPhone?.id === p.id

                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                setSelectedPhone(p)
                                setIssueStep(2) // Instant advance to Step 2
                              }}
                              className={`p-3.5 rounded-2xl border transition flex items-center justify-between cursor-pointer group ${
                                isSelected
                                  ? 'bg-blue-50/90 border-blue-600 shadow-sm ring-2 ring-blue-500/20'
                                  : 'bg-white hover:bg-blue-50/40 border-gray-200 hover:border-blue-300'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0 group-hover:scale-105 transition-transform">
                                  <Smartphone size={20} />
                                </div>
                                <div>
                                  <div className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
                                    <span>{p.model}</span>
                                    {p.pta_status && (
                                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                                        {p.pta_status}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5 font-mono">
                                    <span className="font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                      IMEI: {imeiDisplay}
                                    </span>
                                    {p.storage && <span>{p.storage}</span>}
                                    {p.color && <span>• {p.color}</span>}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-right hidden sm:block">
                                  <div className="text-xs font-bold text-gray-900">
                                    Rs. {(p.sale_price || 0).toLocaleString()}
                                  </div>
                                  <span className="text-[10px] text-emerald-600 font-bold">Available</span>
                                </div>
                                <button
                                  type="button"
                                  className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-xs group-hover:bg-blue-700 transition flex items-center gap-1"
                                >
                                  <span>Select</span>
                                  <ArrowRight size={12} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════
                  STEP 2: RECIPIENT ASSIGNMENT & CUSTODY TERMS
                  ══════════════════════════════════════════════════════════ */}
              {issueStep === 2 && (
                <form id="issue-custody-form" onSubmit={handleIssueCustody} className="space-y-4">
                  
                  {/* Selected Phone Summary Bar */}
                  {selectedPhone && (
                    <div className="p-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                          <Smartphone size={18} />
                        </div>
                        <div>
                          <div className="font-black text-sm text-blue-950">
                            {selectedPhone.model}
                          </div>
                          <div className="text-xs font-mono text-blue-700 font-bold">
                            IMEI: {selectedPhone.imei1 || selectedPhone.imei || selectedPhone.imei2 || 'Recorded Device'}
                            {selectedPhone.color ? ` • ${selectedPhone.color}` : ''}
                            {selectedPhone.storage ? ` • ${selectedPhone.storage}` : ''}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIssueStep(1)}
                        className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-white hover:bg-blue-100 rounded-lg border border-blue-300 transition cursor-pointer"
                      >
                        ← Change Phone
                      </button>
                    </div>
                  )}

                  {/* 1-Click Quick Presets for Recipient */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-gray-700">
                      Step 2: Who is taking this phone? (فوری انتخاب کریں) *
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <button
                        type="button"
                        onClick={handleSelectMyself}
                        className={`p-2.5 rounded-xl text-xs font-bold text-center border transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                          issueForm.issue_type === 'personal_use'
                            ? 'bg-purple-50 border-purple-600 text-purple-700 ring-2 ring-purple-500/20 shadow-xs'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <UserCheck size={16} className="text-purple-600" />
                        <span>For Myself (ذاتی استعمال)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIssueForm(prev => ({ ...prev, issue_type: 'dealer_trial' }))}
                        className={`p-2.5 rounded-xl text-xs font-bold text-center border transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                          issueForm.issue_type === 'dealer_trial'
                            ? 'bg-blue-50 border-blue-600 text-blue-700 ring-2 ring-blue-500/20 shadow-xs'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Store size={16} className="text-blue-600" />
                        <span>Dealer / Neighbour</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIssueForm(prev => ({ ...prev, issue_type: 'customer_reservation' }))}
                        className={`p-2.5 rounded-xl text-xs font-bold text-center border transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                          issueForm.issue_type === 'customer_reservation'
                            ? 'bg-emerald-50 border-emerald-600 text-emerald-700 ring-2 ring-emerald-500/20 shadow-xs'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Users size={16} className="text-emerald-600" />
                        <span>Customer Token</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIssueForm(prev => ({ ...prev, issue_type: 'repair_transit' }))}
                        className={`p-2.5 rounded-xl text-xs font-bold text-center border transition cursor-pointer flex flex-col items-center justify-center gap-1 ${
                          issueForm.issue_type === 'repair_transit'
                            ? 'bg-amber-50 border-amber-600 text-amber-700 ring-2 ring-amber-500/20 shadow-xs'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-base">🛠️</span>
                        <span>Lab / Repair</span>
                      </button>
                    </div>
                  </div>

                  {/* Dropdown Selector for Dealers & Customers with "+ Add Dealer" Button */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-gray-700">
                        Pick from Registered Dealers or Customers (یا نیچے خود نام لکھیں)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowAddDealerModal(true)}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus size={12} />
                        <span>Add New Dealer</span>
                      </button>
                    </div>

                    <div className="relative">
                      <select
                        onChange={(e) => {
                          const val = e.target.value
                          if (!val) return
                          if (val === 'myself') {
                            handleSelectMyself()
                            return
                          }
                          const [type, id] = val.split(':')
                          if (type === 'dealer') {
                            const d = allAvailableDealers.find(x => String(x.id) === String(id))
                            if (d) handleSelectDealerPreset(d)
                          } else if (type === 'customer') {
                            const c = customers.find(x => String(x.id) === String(id))
                            if (c) handleSelectCustomerPreset(c)
                          }
                        }}
                        className="w-full p-2.5 bg-gray-50 hover:bg-white border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                      >
                        <option value="">⚡ Select Dealer, Neighbour Shop, or Customer from list...</option>
                        <option value="myself">👤 Myself / Store Staff ({user?.username || 'Owner'})</option>
                        
                        <optgroup label="🏪 Market Dealers & Neighbouring Shops">
                          {allAvailableDealers.map(d => (
                            <option key={`dealer:${d.id}`} value={`dealer:${d.id}`}>
                              {d.name} {d.company ? `(${d.company})` : ''} {d.phone ? `• ${d.phone}` : ''}
                            </option>
                          ))}
                        </optgroup>

                        {customers.length > 0 && (
                          <optgroup label="👥 Registered Customers">
                            {customers.map(c => (
                              <option key={`customer:${c.id}`} value={`customer:${c.id}`}>
                                {c.name} {c.phone ? `• ${c.phone}` : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Manual Recipient Details (Name and Phone) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-700">Recipient Name *</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                          <User size={14} />
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. Asif Mobile Dealer, Hamza, or Myself"
                          value={issueForm.recipient_name}
                          onChange={e => setIssueForm({ ...issueForm, recipient_name: e.target.value })}
                          required
                          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-xs font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-700">Recipient Phone</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                          <Phone size={14} />
                        </div>
                        <input
                          type="text"
                          placeholder="e.g. 03001234567"
                          value={issueForm.recipient_phone}
                          onChange={e => setIssueForm({ ...issueForm, recipient_phone: e.target.value })}
                          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-xs font-mono font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Token Deposit & Expected Return Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-700">Token Deposit Held (سیکیورٹی رقم)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-xs font-bold text-gray-400">Rs.</span>
                        <input
                          type="number"
                          placeholder="0"
                          value={issueForm.deposit_amount}
                          onChange={e => setIssueForm({ ...issueForm, deposit_amount: e.target.value })}
                          className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-gray-700">Expected Return Date</label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSetQuickDate(0)}
                            className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                          >
                            Today
                          </button>
                          <span className="text-gray-300">•</span>
                          <button
                            type="button"
                            onClick={() => handleSetQuickDate(1)}
                            className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                          >
                            Tomorrow
                          </button>
                          <span className="text-gray-300">•</span>
                          <button
                            type="button"
                            onClick={() => handleSetQuickDate(3)}
                            className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                          >
                            3 Days
                          </button>
                        </div>
                      </div>
                      <input
                        type="date"
                        value={issueForm.expected_return_date}
                        onChange={e => setIssueForm({ ...issueForm, expected_return_date: e.target.value })}
                        className="w-full p-2.5 border border-gray-300 rounded-xl text-xs font-semibold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* Notes / Remarks */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-700">Notes / Remarks</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Checking for 2 hours, accessories kept in shop"
                      value={issueForm.notes}
                      onChange={e => setIssueForm({ ...issueForm, notes: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    />
                  </div>

                </form>
              )}

            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
              {issueStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition"
                  >
                    Cancel
                  </button>
                  <div className="text-xs text-gray-500 font-medium">
                    Select a phone above to proceed to Step 2
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIssueStep(1)}
                    className="px-3.5 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft size={13} />
                    <span>Back to Step 1</span>
                  </button>

                  <button
                    form="issue-custody-form"
                    type="submit"
                    disabled={issueSubmitting}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2 shadow-md shadow-blue-500/25 disabled:opacity-50 cursor-pointer active:scale-95"
                  >
                    {issueSubmitting ? (
                      <span>Locking & Handing Over...</span>
                    ) : (
                      <>
                        <span>Confirm & Handover Phone</span>
                        <CheckCircle2 size={16} />
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════════
          ONE-TIME DEALER / NEIGHBOURING SHOPKEEPER ENTRY MODAL
          ═════════════════════════════════════════════════════════════════════════ */}
      {showAddDealerModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-gray-100 overflow-hidden animate-scaleIn space-y-4">
            <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Store size={20} />
                <div>
                  <h3 className="text-base font-bold text-white">Register Neighbour Dealer / Shop</h3>
                  <p className="text-xs text-blue-100">ایک بار درج کریں، ہمیشہ ڈراپ ڈاؤن میں دستیاب رہے گا</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddDealerModal(false)}
                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveNewDealer} className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">Shop / Dealer Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Al-Madina Mobiles, Hafeez Center"
                  value={newDealerForm.name}
                  onChange={e => setNewDealerForm({ ...newDealerForm, name: e.target.value })}
                  required
                  autoFocus
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">Contact Person / Owner Name</label>
                <input
                  type="text"
                  placeholder="e.g. Kashif Bhai, Usman"
                  value={newDealerForm.contact_person}
                  onChange={e => setNewDealerForm({ ...newDealerForm, contact_person: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">Phone Number (WhatsApp)</label>
                <input
                  type="text"
                  placeholder="e.g. 03001234567"
                  value={newDealerForm.phone}
                  onChange={e => setNewDealerForm({ ...newDealerForm, phone: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-xs font-mono font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">Shop Location / Floor / City</label>
                <input
                  type="text"
                  placeholder="e.g. Shop # 24, 1st Floor, Market Plaza"
                  value={newDealerForm.address}
                  onChange={e => setNewDealerForm({ ...newDealerForm, address: e.target.value })}
                  className="w-full p-2.5 border border-gray-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDealerModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDealer}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {savingDealer ? 'Saving...' : 'Save & Add to List'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRM RETURN TO IN-STOCK ── */}
      {custodyToReturn && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-gray-100 overflow-hidden animate-scaleIn p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <RotateCcw size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Return Phone to In-Stock?</h3>
                <p className="text-xs text-gray-500">موبائل واپس دکان کی انوینٹری میں داخل کریں</p>
              </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <div><strong>Device:</strong> {custodyToReturn.phone?.model || 'Mobile Phone'}</div>
              <div><strong>IMEI:</strong> {custodyToReturn.phone?.imei1 || custodyToReturn.phone?.imei || custodyToReturn.phone?.imei2 || 'Recorded Device'}</div>
              <div><strong>Holder:</strong> {custodyToReturn.recipient_name}</div>
              {custodyToReturn.deposit_amount > 0 && (
                <div className="text-emerald-700 font-bold">
                  Deposit to Refund / Adjust: Rs. {parseFloat(custodyToReturn.deposit_amount).toLocaleString()}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700">Return Notes / Device Condition</label>
              <input
                type="text"
                placeholder="e.g. Phone returned in 100% fine condition"
                value={returnNotes}
                onChange={e => setReturnNotes(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCustodyToReturn(null)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={returnSubmitting}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
              >
                {returnSubmitting ? 'Returning...' : 'Confirm Return to Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
