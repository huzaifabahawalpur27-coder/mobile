import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { Link } from 'react-router-dom'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { 
  MessageSquare, 
  Users, 
  Send, 
  Search, 
  CheckSquare, 
  Square, 
  Sparkles, 
  Smartphone, 
  CreditCard, 
  ArrowRight, 
  CheckCircle2, 
  X, 
  ExternalLink,
  ChevronRight,
  Filter,
  Copy,
  Check
} from 'lucide-react'

const CAMPAIGN_PRESETS = [
  {
    id: 'new_arrivals',
    title: 'New Stock & Arrivals',
    icon: '📦',
    text: 'Assalam-o-Alaikum [Name]! 🎉 Exciting new stock and fresh arrivals are here at [Shop Name]! Visit our store today or reply here to check models and best prices. Thank you!'
  },
  {
    id: 'special_offer',
    title: 'Special Customer Discount',
    icon: '🎁',
    text: 'Hello [Name]! As our valued customer at [Shop Name], you have an exclusive special discount on all mobile accessories and phones this week. We look forward to seeing you!'
  },
  {
    id: 'phone_followup',
    title: 'Phone Customer Check-up',
    icon: '📱',
    text: 'Assalam-o-Alaikum [Name]! We hope you are enjoying your device. If you need any accessories, screen protection, or software support, [Shop Name] is always happy to assist you!'
  },
  {
    id: 'general_thanks',
    title: 'Store Appreciation Note',
    icon: '🤝',
    text: 'Hello [Name]! Thank you for shopping with us at [Shop Name]. We truly value your business and trust. Let us know whenever you need anything!'
  }
]

function formatPakistanPhone(rawPhone) {
  if (!rawPhone) return ''
  const cleaned = rawPhone.replace(/[^0-9]/g, '')
  if (cleaned.startsWith('03') && cleaned.length === 11) {
    return '92' + cleaned.substring(1)
  }
  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    return '92' + cleaned
  }
  return cleaned
}

function WhatsAppMessaging() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('broadcast') // 'broadcast' | 'reminders' | 'templates'
  const [customers, setCustomers] = useState([])
  const [phoneBuyerIds, setPhoneBuyerIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState(null)
  
  // Broadcast Campaign State
  const [audienceFilter, setAudienceFilter] = useState('all') // 'all' | 'phone_buyers' | 'debtors'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCustomerIds, setSelectedCustomerIds] = useState(new Set())
  const [campaignMessage, setCampaignMessage] = useState(CAMPAIGN_PRESETS[0].text)
  const textareaRef = useRef(null)

  // Dispatch Queue Modal
  const [dispatchQueue, setDispatchQueue] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false)
  const [dispatchedIds, setDispatchedIds] = useState(new Set())
  const [copiedTemplate, setCopiedTemplate] = useState(null)

  // Reminders Filter
  const [reminderSearch, setReminderSearch] = useState('')

  useEffect(() => {
    fetchData()
  }, [user?.shop_id])

  const fetchData = async () => {
    if (!user?.shop_id) return
    setLoading(true)
    try {
      // 1. Fetch Shop Settings
      const { data: shopData } = await supabase
        .from('shops')
        .select('*')
        .eq('id', user.shop_id)
        .maybeSingle()
      setShop(shopData)
      if (shopData) await db.shops.put(shopData)

      // 2. Fetch Customers
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('name', { ascending: true })

      if (custErr) throw custErr
      const allCustomers = custData || []
      setCustomers(allCustomers)

      // 3. Identify Phone Buyers from sales or Dexie
      try {
        const { data: phoneSales } = await supabase
          .from('sales')
          .select('customer_id, sale_items(is_phone, phone_id, name)')
          .eq('shop_id', user.shop_id)

        const buyers = new Set()
        if (phoneSales) {
          phoneSales.forEach(s => {
            if (s.customer_id && s.sale_items?.some(i => i.is_phone || i.phone_id || (i.name && i.name.toLowerCase().includes('phone')))) {
              buyers.add(s.customer_id)
            }
          })
        }
        setPhoneBuyerIds(buyers)
      } catch (err) {
        console.warn('Could not fetch phone sales linkage:', err)
      }

    } catch (err) {
      console.error('WhatsApp data fetch error, loading from local DB:', err)
      const localCustomers = await db.customers
        .where('shop_id')
        .equals(user.shop_id)
        .toArray()
      setCustomers(localCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || '')))

      const localShop = await db.shops.get(user.shop_id)
      setShop(localShop)
    } finally {
      setLoading(false)
    }
  }

  // Filtered Customers for Broadcast
  const broadcastList = useMemo(() => {
    return customers.filter(c => {
      const hasPhone = Boolean(c.phone && c.phone.trim().length >= 7)
      if (!hasPhone) return false

      if (audienceFilter === 'phone_buyers' && !phoneBuyerIds.has(c.id)) return false
      if (audienceFilter === 'debtors' && !(Number(c.outstanding_balance) > 0)) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesName = (c.name || '').toLowerCase().includes(q)
        const matchesPhone = (c.phone || '').includes(q)
        if (!matchesName && !matchesPhone) return false
      }

      return true
    })
  }, [customers, audienceFilter, phoneBuyerIds, searchQuery])

  // Select all / Deselect all
  const handleToggleSelectAll = () => {
    const allFilteredIds = broadcastList.map(c => c.id)
    const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedCustomerIds.has(id))

    const newSet = new Set(selectedCustomerIds)
    if (isAllSelected) {
      allFilteredIds.forEach(id => newSet.delete(id))
    } else {
      allFilteredIds.forEach(id => newSet.add(id))
    }
    setSelectedCustomerIds(newSet)
  }

  const handleToggleCustomer = (id) => {
    const newSet = new Set(selectedCustomerIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedCustomerIds(newSet)
  }

  const handleSelectAudienceFilter = (filter) => {
    setAudienceFilter(filter)
    // Clear or pre-select
    setSelectedCustomerIds(new Set())
  }

  // Insert tag into campaign message
  const handleInsertTag = (tag) => {
    if (!textareaRef.current) {
      setCampaignMessage(prev => prev + ' ' + tag)
      return
    }
    const start = textareaRef.current.selectionStart
    const end = textareaRef.current.selectionEnd
    const text = campaignMessage
    const newText = text.substring(0, start) + tag + text.substring(end)
    setCampaignMessage(newText)
    setTimeout(() => {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(start + tag.length, start + tag.length)
    }, 50)
  }

  // Generate personalized message for a customer
  const renderMessageForCustomer = (customer, template = campaignMessage) => {
    const shopName = shop?.name || localStorage.getItem(`shop_name_${user?.shop_id}`) || 'EdgeX POS Store'
    const today = new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
    const balance = Number(customer?.outstanding_balance || 0).toLocaleString()

    return template
      .replace(/\[Name\]/g, customer?.name || 'Customer')
      .replace(/\[Shop Name\]/g, shopName)
      .replace(/\[Date\]/g, today)
      .replace(/\[Balance\]/g, balance)
  }

  // Start Campaign Dispatch
  const handleStartBroadcast = () => {
    const recipients = broadcastList.filter(c => selectedCustomerIds.has(c.id))
    if (recipients.length === 0) {
      alert('Please select at least one customer to send messages.')
      return
    }
    setDispatchQueue(recipients)
    setCurrentIndex(0)
    setDispatchedIds(new Set())
    setIsDispatchModalOpen(true)
  }

  const handleOpenCurrentCustomerWA = () => {
    const current = dispatchQueue[currentIndex]
    if (!current) return
    const formattedPhone = formatPakistanPhone(current.phone)
    const msg = renderMessageForCustomer(current)
    const url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`
    
    // Mark as sent
    setDispatchedIds(prev => new Set(prev).add(current.id))
    window.open(url, '_blank')
  }

  const handleNextRecipient = () => {
    if (currentIndex < dispatchQueue.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      setIsDispatchModalOpen(false)
      alert(`🎉 Broadcast queue completed! ${dispatchedIds.size} messages dispatched.`)
    }
  }

  // Debt Reminders list
  const debtorCustomers = useMemo(() => {
    return customers
      .filter(c => Number(c.outstanding_balance) > 0)
      .filter(c => {
        if (!reminderSearch.trim()) return true
        const q = reminderSearch.toLowerCase()
        return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
      })
      .sort((a, b) => Number(b.outstanding_balance) - Number(a.outstanding_balance))
  }, [customers, reminderSearch])

  const totalOutstanding = useMemo(() => {
    return debtorCustomers.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
  }, [debtorCustomers])

  const getReminderLink = (customer) => {
    const phone = formatPakistanPhone(customer.phone)
    if (!phone) return null
    const template = shop?.wa_reminder_template || "Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!"
    const shopName = shop?.name || localStorage.getItem(`shop_name_${user?.shop_id}`) || 'EdgeX POS Store'
    const message = template
      .replace(/\[Name\]/g, customer.name)
      .replace(/\[Amount\]/g, Number(customer.outstanding_balance || 0).toLocaleString())
      .replace(/\[Shop Name\]/g, shopName)

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  }

  // First selected customer for preview
  const previewCustomer = useMemo(() => {
    const selected = broadcastList.find(c => selectedCustomerIds.has(c.id))
    return selected || broadcastList[0] || { name: 'Customer Name', phone: '03001234567', outstanding_balance: 0 }
  }, [broadcastList, selectedCustomerIds])

  if (!hasFeature('whatsapp')) return <UpgradeWall feature="whatsapp" />

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Apple HIG Header & Navigation Segmented Control */}
      <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-green-400 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <MessageSquare size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                WhatsApp Customer Messaging
              </h1>
              <p className="text-xs text-[#86868b] dark:text-[#98989d] mt-0.5">
                Send personalized broadcasts, promotional deals, and payment reminders in 1 click.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/settings"
              className="px-4 py-2 text-xs font-semibold rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] transition"
            >
              ⚙️ Manage Templates
            </Link>
          </div>
        </div>

        {/* Segmented Control Pills */}
        <div className="mt-6 flex p-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl max-w-md border border-black/[0.04] dark:border-white/[0.04]">
          <button
            onClick={() => setActiveTab('broadcast')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'broadcast'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm font-bold'
                : 'text-[#86868b] dark:text-[#98989d] hover:text-[#1d1d1f]'
            }`}
          >
            <span>📢</span>
            <span>Broadcast & Deals</span>
          </button>
          <button
            onClick={() => setActiveTab('reminders')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'reminders'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm font-bold'
                : 'text-[#86868b] dark:text-[#98989d] hover:text-[#1d1d1f]'
            }`}
          >
            <span>💳</span>
            <span>Debt Reminders</span>
            {debtorCustomers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-red-500 text-white rounded-full text-[10px]">
                {debtorCustomers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'templates'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm font-bold'
                : 'text-[#86868b] dark:text-[#98989d] hover:text-[#1d1d1f]'
            }`}
          >
            <span>📋</span>
            <span>Templates</span>
          </button>
        </div>
      </div>

      {/* ──────────────── TAB 1: BROADCAST & PROMOTIONS ──────────────── */}
      {activeTab === 'broadcast' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel: Customer Selection List */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[22px] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                    <Users size={16} className="text-emerald-500" />
                    <span>Select Audience</span>
                  </h2>
                  <p className="text-[11px] text-[#86868b] dark:text-[#98989d]">
                    Choose which customers should receive this message.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    {selectedCustomerIds.size} Selected
                  </span>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  onClick={() => handleSelectAudienceFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                    audienceFilter === 'all'
                      ? 'bg-emerald-500 text-white font-semibold'
                      : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#86868b] hover:bg-[#e5e5ea]'
                  }`}
                >
                  All ({customers.filter(c => c.phone).length})
                </button>
                <button
                  onClick={() => handleSelectAudienceFilter('phone_buyers')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1 ${
                    audienceFilter === 'phone_buyers'
                      ? 'bg-emerald-500 text-white font-semibold'
                      : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#86868b] hover:bg-[#e5e5ea]'
                  }`}
                >
                  <Smartphone size={12} />
                  <span>Phone Buyers ({customers.filter(c => c.phone && phoneBuyerIds.has(c.id)).length})</span>
                </button>
                <button
                  onClick={() => handleSelectAudienceFilter('debtors')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1 ${
                    audienceFilter === 'debtors'
                      ? 'bg-emerald-500 text-white font-semibold'
                      : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#86868b] hover:bg-[#e5e5ea]'
                  }`}
                >
                  <CreditCard size={12} />
                  <span>With Debt ({customers.filter(c => c.phone && Number(c.outstanding_balance) > 0).length})</span>
                </button>
              </div>

              {/* Search & Select All row */}
              <div className="flex items-center gap-2 pt-1">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-2.5 text-[#86868b]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search customer by name or phone..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f5f7] dark:bg-[#2c2c2e] border-0 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-[#1d1d1f] dark:text-white"
                  />
                </div>
                <button
                  onClick={handleToggleSelectAll}
                  className="px-3 py-2 text-xs font-semibold bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-white rounded-xl transition flex items-center gap-1.5 shrink-0"
                >
                  {broadcastList.length > 0 && broadcastList.every(c => selectedCustomerIds.has(c.id)) ? (
                    <>
                      <CheckSquare size={14} className="text-emerald-500" />
                      <span>Deselect All</span>
                    </>
                  ) : (
                    <>
                      <Square size={14} />
                      <span>Select All</span>
                    </>
                  )}
                </button>
              </div>

              {/* Customer Scroll List */}
              <div className="max-h-[460px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {broadcastList.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[#86868b]">
                    No matching customers with phone numbers found.
                  </div>
                ) : (
                  broadcastList.map(customer => {
                    const isSelected = selectedCustomerIds.has(customer.id)
                    const isPhoneBuyer = phoneBuyerIds.has(customer.id)
                    const hasBalance = Number(customer.outstanding_balance) > 0

                    return (
                      <div
                        key={customer.id}
                        onClick={() => handleToggleCustomer(customer.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500/40 shadow-xs'
                            : 'bg-white dark:bg-[#2c2c2e]/40 border-black/[0.04] dark:border-white/[0.04] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            className={`w-5 h-5 rounded-md flex items-center justify-center transition shrink-0 ${
                              isSelected
                                ? 'bg-emerald-500 text-white'
                                : 'border border-[#d1d1d6] dark:border-[#48484a]'
                            }`}
                          >
                            {isSelected && <Check size={12} strokeWidth={3} />}
                          </button>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate flex items-center gap-1.5">
                              <span>{customer.name}</span>
                              {isPhoneBuyer && (
                                <span className="px-1.5 py-0.2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-[9px] font-bold">
                                  📱 Phone
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#86868b] font-mono">
                              {customer.phone}
                            </div>
                          </div>
                        </div>

                        {hasBalance && (
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded-full border border-red-500/20">
                              Rs. {Number(customer.outstanding_balance).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Message Composer & Live iPhone Preview */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[22px] p-6 shadow-sm space-y-5">
              <div>
                <h2 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                  <Sparkles size={16} className="text-emerald-500" />
                  <span>Compose WhatsApp Campaign</span>
                </h2>
                <p className="text-[11px] text-[#86868b] dark:text-[#98989d]">
                  Choose a high-converting message preset or type your custom announcement.
                </p>
              </div>

              {/* Quick Presets */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[#86868b] uppercase tracking-wider">
                  Quick Campaign Presets
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CAMPAIGN_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setCampaignMessage(preset.text)}
                      className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${
                        campaignMessage === preset.text
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/40 text-emerald-800 dark:text-emerald-300 shadow-xs'
                          : 'bg-[#f5f5f7] dark:bg-[#2c2c2e]/60 border-transparent hover:bg-[#e5e5ea] dark:hover:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]'
                      }`}
                    >
                      <span className="text-base">{preset.icon}</span>
                      <span className="text-xs font-semibold truncate">{preset.title}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Variables Chips */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[#86868b] uppercase tracking-wider flex items-center justify-between">
                  <span>Dynamic Tag Chips (Click to insert)</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">Auto-replaced per customer</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { tag: '[Name]', desc: "Customer's Name" },
                    { tag: '[Shop Name]', desc: 'Your Store Name' },
                    { tag: '[Date]', desc: "Today's Date" },
                    { tag: '[Balance]', desc: 'Outstanding Balance' }
                  ].map(item => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => handleInsertTag(item.tag)}
                      className="px-2.5 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hover:text-emerald-700 text-[#1d1d1f] dark:text-[#f5f5f7] border border-black/[0.04] dark:border-white/[0.04] rounded-lg text-xs font-mono font-bold transition flex items-center gap-1"
                      title={item.desc}
                    >
                      <span>+</span>
                      <span>{item.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Input */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#86868b]">
                  <span>Message Body</span>
                  <span>{campaignMessage.length} characters</span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={campaignMessage}
                  onChange={e => setCampaignMessage(e.target.value)}
                  rows={4}
                  className="w-full p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl text-xs sm:text-sm text-[#1d1d1f] dark:text-[#f5f5f7] focus:ring-2 focus:ring-emerald-500 outline-none leading-relaxed transition"
                  placeholder="Type your message here..."
                />
              </div>

              {/* Live iPhone Chat Bubble Mockup */}
              <div className="p-4 bg-[#e5ddd5]/30 dark:bg-[#1a2324]/40 rounded-2xl border border-black/[0.04] dark:border-white/[0.04] space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[#86868b]">
                  <span className="font-bold flex items-center gap-1">
                    <span>📱 Live WhatsApp Preview</span>
                    <span className="text-[10px] text-emerald-600 font-normal">
                      (Simulating: {previewCustomer.name})
                    </span>
                  </span>
                  <span className="text-[10px]">WhatsApp Web / App</span>
                </div>

                {/* WhatsApp Chat Bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-2xl rounded-tr-xs p-3.5 shadow-sm text-xs leading-relaxed space-y-1.5 relative">
                    <p className="whitespace-pre-wrap">
                      {renderMessageForCustomer(previewCustomer)}
                    </p>
                    <div className="flex items-center justify-end gap-1 text-[9px] text-[#667781] dark:text-[#8696a0] font-mono">
                      <span>Just now</span>
                      <span className="text-emerald-500 dark:text-emerald-400 font-bold">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dispatch Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleStartBroadcast}
                  disabled={selectedCustomerIds.size === 0}
                  className={`w-full py-3.5 px-6 rounded-2xl text-sm font-bold transition flex items-center justify-center gap-2 shadow-lg ${
                    selectedCustomerIds.size > 0
                      ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-emerald-500/25 cursor-pointer'
                      : 'bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#86868b] cursor-not-allowed shadow-none'
                  }`}
                >
                  <Send size={16} />
                  <span>
                    Launch WhatsApp Queue ({selectedCustomerIds.size} Customers)
                  </span>
                  <ArrowRight size={16} />
                </button>
                <p className="text-[10px] text-center text-[#86868b] mt-2">
                  Opens WhatsApp Web or Desktop with each message pre-loaded. 100% official, zero ban risk.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 2: DEBT REMINDERS ──────────────── */}
      {activeTab === 'reminders' && (
        <div className="space-y-6">
          {/* Outstanding Summary Metric Card */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center font-bold text-xl">
                Rs
              </div>
              <div>
                <p className="text-xs font-bold text-[#86868b] uppercase tracking-wider">
                  Total Outstanding Customer Balance
                </p>
                <h3 className="text-2xl font-black text-red-600 dark:text-red-400 tracking-tight">
                  Rs. {totalOutstanding.toLocaleString()}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-3 py-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full">
                {debtorCustomers.length} Customers with dues
              </span>
            </div>
          </div>

          {/* Debtors List Table */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] overflow-hidden shadow-sm">
            <div className="p-4 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3 top-3 text-[#86868b]" />
                <input
                  type="text"
                  value={reminderSearch}
                  onChange={e => setReminderSearch(e.target.value)}
                  placeholder="Search debtor by name or phone..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f5f7] dark:bg-[#2c2c2e] border-0 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-[#1d1d1f] dark:text-white"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f5f5f7]/60 dark:bg-[#2c2c2e]/40 text-[#86868b] text-[10px] font-bold uppercase tracking-wider border-b border-black/[0.04] dark:border-white/[0.04]">
                    <th className="px-6 py-4">Customer</th>
                    <th className="px-6 py-4">Phone Number</th>
                    <th className="px-6 py-4 text-right">Outstanding Balance</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {debtorCustomers.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="px-6 py-12 text-center text-xs text-[#86868b]">
                        🎉 Excellent! No customers currently have outstanding balances.
                      </td>
                    </tr>
                  ) : (
                    debtorCustomers.map(customer => {
                      const waLink = getReminderLink(customer)
                      return (
                        <tr key={customer.id} className="hover:bg-emerald-50/20 dark:hover:bg-emerald-950/10 transition">
                          <td className="px-6 py-4">
                            <div className="text-xs font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {customer.name}
                            </div>
                            <div className="text-[10px] text-[#86868b]">
                              ID: {customer.id?.slice(-6)}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs font-mono text-[#86868b]">
                              {customer.phone || 'No Phone Number'}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="text-xs font-black text-red-600 dark:text-red-400">
                              Rs. {Number(customer.outstanding_balance).toLocaleString()}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {waLink ? (
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition shadow-sm shadow-emerald-500/20"
                              >
                                <Send size={12} />
                                <span>Send Reminder</span>
                              </a>
                            ) : (
                              <span className="text-[10px] text-amber-500 font-semibold">
                                Missing Phone
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 3: TEMPLATES & OVERVIEW ──────────────── */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Bill Template */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <span>🧾</span>
                <span>Invoice / Bill WhatsApp Template</span>
              </h3>
              <button
                onClick={() => {
                  const tpl = shop?.wa_bill_template || 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount].\n📱 Model: [Model]\n📅 Date: [Date]\nThank you for your business!'
                  navigator.clipboard.writeText(tpl)
                  setCopiedTemplate('bill')
                  setTimeout(() => setCopiedTemplate(null), 2000)
                }}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1"
              >
                {copiedTemplate === 'bill' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedTemplate === 'bill' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-[#86868b]">
              Sent automatically after checkout from POS billing. Includes customer name, bill amount, phone model, and date.
            </p>
            <div className="p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-xs font-mono whitespace-pre-wrap text-[#1d1d1f] dark:text-[#f5f5f7]">
              {shop?.wa_bill_template || 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount].\n📱 Model: [Model]\n📅 Date: [Date]\nThank you for your business!'}
            </div>
          </div>

          {/* Phone Thank You Template */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <span>🎉</span>
                <span>Phone Purchase Special Thank You</span>
              </h3>
              <button
                onClick={() => {
                  const tpl = '🎉 *Thank you for purchasing your phone from [Shop Name]!*\n\nHello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount].\n\n📱 Model: [Model]\n📅 Date: [Date]\n\n🛡️ Official warranty / checking warranty applies.\nIf you need any setup help or accessories, we are always happy to help!\n\nThank you for your business! 🤝'
                  navigator.clipboard.writeText(tpl)
                  setCopiedTemplate('phone_thanks')
                  setTimeout(() => setCopiedTemplate(null), 2000)
                }}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1"
              >
                {copiedTemplate === 'phone_thanks' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedTemplate === 'phone_thanks' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-[#86868b]">
              Special warranty & appreciation message sent when customer buys a mobile phone in POS.
            </p>
            <div className="p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-xs font-mono whitespace-pre-wrap text-[#1d1d1f] dark:text-[#f5f5f7]">
              {`🎉 *Thank you for purchasing your phone from [Shop Name]!*

Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount].

📱 Model: [Model]
📅 Date: [Date]

🛡️ Official warranty / checking warranty applies.
If you need any setup help or accessories, we are always happy to help!

Thank you for your business! 🤝`}
            </div>
          </div>

          {/* Debt Reminder Template */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <span>💳</span>
                <span>Outstanding Balance Reminder</span>
              </h3>
              <button
                onClick={() => {
                  const tpl = shop?.wa_reminder_template || 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!'
                  navigator.clipboard.writeText(tpl)
                  setCopiedTemplate('reminder')
                  setTimeout(() => setCopiedTemplate(null), 2000)
                }}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1"
              >
                {copiedTemplate === 'reminder' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedTemplate === 'reminder' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-[#86868b]">
              Used when dispatching reminders to customers with unpaid balances.
            </p>
            <div className="p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-xs font-mono whitespace-pre-wrap text-[#1d1d1f] dark:text-[#f5f5f7]">
              {shop?.wa_reminder_template || 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!'}
            </div>
          </div>

          {/* Low Stock Reorder Template */}
          <div className="bg-white/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-[24px] p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <span>📦</span>
                <span>Supplier Low Stock Reorder</span>
              </h3>
              <button
                onClick={() => {
                  const tpl = shop?.wa_reorder_template || 'Assalam-o-Alaikum *[Supplier Name]*! 🙏\n\n*[Shop Name]* se order:\n\n[Items]\n\nMeharbani farma kar supply karein.'
                  navigator.clipboard.writeText(tpl)
                  setCopiedTemplate('reorder')
                  setTimeout(() => setCopiedTemplate(null), 2000)
                }}
                className="text-xs text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1"
              >
                {copiedTemplate === 'reorder' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedTemplate === 'reorder' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-xs text-[#86868b]">
              Used in Stock Inventory when placing instant restocking orders to suppliers.
            </p>
            <div className="p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl text-xs font-mono whitespace-pre-wrap text-[#1d1d1f] dark:text-[#f5f5f7]">
              {shop?.wa_reorder_template || 'Assalam-o-Alaikum *[Supplier Name]*! 🙏\n\n*[Shop Name]* se order:\n\n[Items]\n\nMeharbani farma kar supply karein.'}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL: RAPID DISPATCH QUEUE ──────────────── */}
      {isDispatchModalOpen && dispatchQueue.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1c1c1e] border border-black/[0.08] dark:border-white/[0.1] rounded-[28px] max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Sending {currentIndex + 1} of {dispatchQueue.length}
                </span>
                <h3 className="text-lg font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mt-1.5">
                  WhatsApp Dispatch Queue
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDispatchModalOpen(false)}
                className="w-8 h-8 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-[#f5f5f7] dark:bg-[#2c2c2e] h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${((currentIndex + 1) / dispatchQueue.length) * 100}%`
                }}
              />
            </div>

            {/* Current Recipient Card */}
            {dispatchQueue[currentIndex] && (
              <div className="p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {dispatchQueue[currentIndex].name}
                    </h4>
                    <p className="text-xs font-mono text-[#86868b]">
                      {dispatchQueue[currentIndex].phone}
                    </p>
                  </div>
                  {dispatchedIds.has(dispatchQueue[currentIndex].id) && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 rounded-full">
                      <CheckCircle2 size={12} />
                      <span>Sent</span>
                    </span>
                  )}
                </div>

                {/* Message preview */}
                <div className="p-3 bg-white dark:bg-[#1c1c1e] rounded-xl text-xs text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed border border-black/[0.04] dark:border-white/[0.04] whitespace-pre-wrap">
                  {renderMessageForCustomer(dispatchQueue[currentIndex])}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  handleOpenCurrentCustomerWA()
                }}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 cursor-pointer"
              >
                <ExternalLink size={16} />
                <span>Open in WhatsApp & Send 💬</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNextRecipient}
                  className="flex-1 py-2.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1"
                >
                  <span>{currentIndex < dispatchQueue.length - 1 ? 'Next Customer ➡️' : 'Finish Queue 🎉'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDispatchModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-[#86868b] hover:text-[#1d1d1f] transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WhatsAppMessaging
