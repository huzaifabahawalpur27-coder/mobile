import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchWhatsAppQueue,
  markWhatsAppMessageSent,
  deleteWhatsAppMessage,
  isSoldPhoneQueueItem,
  updateWhatsAppMessageText,
  updateExistingQueueMessagesWithWarranty,
  getShopWarrantyTerms,
  replaceOrInjectWarrantyInTemplate,
  upgradeLegacyWhatsAppMessage,
  repairQueueInvoiceLinks,
  registerLegacyInvoiceTokens,
  backfillBillCustomersFromQueue
} from '../services/whatsappQueueService'

const needsLinkUpgrade = (text) => !String(text || '').includes('/invoice/')
import {
  MessageSquare,
  Smartphone,
  CheckCircle,
  Clock,
  Trash2,
  Copy,
  ExternalLink,
  Search,
  RefreshCw,
  Send,
  Receipt,
  Package,
  Check,
  Pencil,
  Save,
  CheckCircle2,
  FileText
} from 'lucide-react'

export default function WhatsAppQueue() {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTab, setFilterTab] = useState('pending') // 'pending' | 'sent' | 'all'
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [processingId, setProcessingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [updatingWarranty, setUpdatingWarranty] = useState(false)
  const [warrantyStatusMsg, setWarrantyStatusMsg] = useState(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchWhatsAppQueue(user?.shop_id, 'all')
      // Keep links customers already received resolvable (their tokens may exist only
      // in this device's outbox), then point pending links at the token the server
      // really stored (fixes links queued with a client-only or corrupted token).
      await registerLegacyInvoiceTokens(data).catch(err => console.warn('Legacy invoice token upload failed:', err))
      // Bills saved without the customer's name/phone get them from the outbox recipient
      await backfillBillCustomersFromQueue(data).catch(err => console.warn('Bill customer backfill failed:', err))
      await repairQueueInvoiceLinks(data).catch(err => console.warn('Invoice link repair failed:', err))
      setMessages(data)
    } catch (err) {
      console.error('Failed to load WhatsApp queue:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.shop_id])

  useEffect(() => {
    loadQueue()
    // Auto-heal any preexisting outbox items missing warranty terms in background
    if (user?.shop_id) {
      updateExistingQueueMessagesWithWarranty(user.shop_id)
        .then(count => {
          if (count > 0) loadQueue()
        })
        .catch(() => {})
    }
    // Poll every 15s for new sales coming from desktop
    const timer = setInterval(() => {
      fetchWhatsAppQueue(user?.shop_id, 'all').then(data => {
        setMessages(data)
      })
    }, 15000)
    return () => clearInterval(timer)
  }, [loadQueue, user?.shop_id])

  // Ensure strictly sold phone entries are displayed and auto-healed with random tokens & invoice links
  const phoneMessages = useMemo(() => {
    return messages.filter(isSoldPhoneQueueItem).map(m => {
      const text = m.message_text || ''
      if (needsLinkUpgrade(text)) {
        const upgraded = upgradeLegacyWhatsAppMessage(text, m.shop_id || user?.shop_id, m.reference_data)
        if (upgraded && upgraded !== text) {
          return { ...m, message_text: upgraded }
        }
      }
      return m
    })
  }, [messages, user?.shop_id])

  // Counts
  const pendingCount = useMemo(() => phoneMessages.filter(m => m.status === 'pending').length, [phoneMessages])
  const sentCount = useMemo(() => phoneMessages.filter(m => m.status === 'sent').length, [phoneMessages])

  // Filtered List
  const filteredMessages = useMemo(() => {
    return phoneMessages.filter(m => {
      // Tab filter
      if (filterTab === 'pending' && m.status !== 'pending') return false
      if (filterTab === 'sent' && m.status !== 'sent') return false

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const nameMatch = (m.recipient_name || '').toLowerCase().includes(q)
        const phoneMatch = (m.recipient_phone || '').includes(q)
        const refMatch = (m.reference_id || '').toLowerCase().includes(q)
        const textMatch = (m.message_text || '').toLowerCase().includes(q)
        return nameMatch || phoneMatch || refMatch || textMatch
      }
      return true
    })
  }, [phoneMessages, filterTab, searchQuery])

  // Handle Send via Native WhatsApp
  const handleSendViaWhatsApp = async (item) => {
    if (!item.recipient_phone) {
      alert('Phone number missing!')
      return
    }

    let textToSend = item.message_text || ''
    if (needsLinkUpgrade(textToSend)) {
      textToSend = upgradeLegacyWhatsAppMessage(textToSend, item.shop_id || user?.shop_id, item.reference_data)
    }
    const waUrl = `https://wa.me/${item.recipient_phone}?text=${encodeURIComponent(textToSend)}`

    // Open WhatsApp synchronously inside the tap handler, before any await, so mobile
    // browsers and installed PWAs keep the user gesture and do not block the popup.
    const opened = window.open(waUrl, '_blank')
    if (!opened) {
      // Popup blocked (common in standalone PWAs): navigate this tab instead.
      window.location.href = waUrl
    }

    setProcessingId(item.id)
    try {
      await markWhatsAppMessageSent(item.id)
      setMessages(prev => prev.map(m => m.id === item.id ? { ...m, message_text: textToSend, status: 'sent', sent_at: new Date().toISOString() } : m))
    } catch (err) {
      console.error('Error marking message sent:', err)
    } finally {
      setProcessingId(null)
    }
  }

  // Handle Manual Mark Sent
  const handleMarkSent = async (e, item) => {
    e.stopPropagation()
    setProcessingId(item.id)
    try {
      await markWhatsAppMessageSent(item.id)
      setMessages(prev => prev.map(m => m.id === item.id ? { ...m, status: 'sent', sent_at: new Date().toISOString() } : m))
    } finally {
      setProcessingId(null)
    }
  }

  // Handle Delete
  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this message from queue?')) return
    try {
      await deleteWhatsAppMessage(id)
      setMessages(prev => prev.filter(m => m.id !== id))
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  // Copy text
  const handleCopyText = (e, item) => {
    e.stopPropagation()
    let textToCopy = item.message_text || ''
    if (needsLinkUpgrade(textToCopy)) {
      textToCopy = upgradeLegacyWhatsAppMessage(textToCopy, item.shop_id || user?.shop_id, item.reference_data)
    }
    navigator.clipboard.writeText(textToCopy)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 1800)
  }

  // Edit message inline
  const handleStartEdit = (e, item) => {
    e.stopPropagation()
    setEditingId(item.id)
    setEditingText(item.message_text || '')
  }

  const handleCancelEdit = (e) => {
    e?.stopPropagation()
    setEditingId(null)
    setEditingText('')
  }

  const handleSaveEdit = async (e, id) => {
    e?.stopPropagation()
    try {
      await updateWhatsAppMessageText(id, editingText)
      setMessages(prev => prev.map(m => m.id === id ? { ...m, message_text: editingText } : m))
      setEditingId(null)
      setEditingText('')
      setWarrantyStatusMsg('✅ میسج محفوظ کر دیا گیا ہے! (Message saved successfully)')
      setTimeout(() => setWarrantyStatusMsg(null), 3000)
    } catch (err) {
      alert('Failed to save message: ' + (err?.message || String(err)))
    }
  }

  const handleAppendWarrantyToEdit = (e) => {
    e?.stopPropagation()
    const shopWarranty = getShopWarrantyTerms(user?.shop_id)
    setEditingText(prev => replaceOrInjectWarrantyInTemplate(prev, shopWarranty))
  }

  // 1-Click reset to full professional Urdu template with warranty in editor
  const handleResetToUrduInEdit = (e, item) => {
    e?.stopPropagation()
    const shopWarranty = getShopWarrantyTerms(item.shop_id || user?.shop_id)
    const upgraded = upgradeLegacyWhatsAppMessage(item.message_text, item.shop_id || user?.shop_id, item.reference_data)
    // Replace (not just add) so the shop's current terms from Settings win
    setEditingText(replaceOrInjectWarrantyInTemplate(upgraded, shopWarranty))
  }

  // 1-Click direct add / refresh warranty for an individual card without opening editor
  const handleDirectAddWarranty = async (e, item) => {
    e?.stopPropagation()
    try {
      const shopWarranty = getShopWarrantyTerms(item.shop_id || user?.shop_id)
      const upgraded = upgradeLegacyWhatsAppMessage(item.message_text, item.shop_id || user?.shop_id, item.reference_data)
      // Replace (not just add) so the shop's current terms from Settings win
      const newText = replaceOrInjectWarrantyInTemplate(upgraded, shopWarranty)
      await updateWhatsAppMessageText(item.id, newText)
      setMessages(prev => prev.map(m => m.id === item.id ? { ...m, message_text: newText } : m))
      setWarrantyStatusMsg(`✅ وارنٹی شرائط شامل کر دی گئیں! (Warranty terms added for ${item.recipient_name})`)
      setTimeout(() => setWarrantyStatusMsg(null), 3500)
    } catch (err) {
      alert('Failed to update warranty: ' + (err?.message || String(err)))
    }
  }

  // Bulk update all pending with warranty terms
  const handleUpdateAllPendingWarranty = async () => {
    if (!window.confirm('کیا آپ آؤٹ باکس کے تمام پینڈنگ میسجز میں وارنٹی شرائط شامل کرنا چاہتے ہیں؟\n\nUpdate all pending outbox messages with current warranty terms?')) {
      return
    }
    setUpdatingWarranty(true)
    setWarrantyStatusMsg(null)
    try {
      const shopWarranty = getShopWarrantyTerms(user?.shop_id)
      const count = await updateExistingQueueMessagesWithWarranty(user?.shop_id, shopWarranty)
      setWarrantyStatusMsg(`Updated ${count} pending messages with warranty terms! ✅`)
      await loadQueue()
      setTimeout(() => setWarrantyStatusMsg(null), 6000)
    } catch (err) {
      setWarrantyStatusMsg('Error: ' + (err?.message || String(err)))
    } finally {
      setUpdatingWarranty(false)
    }
  }

  // Mark all pending as sent
  const handleMarkAllPendingSent = async () => {
    const pendingList = messages.filter(m => m.status === 'pending')
    if (pendingList.length === 0) return
    if (!window.confirm(`Mark all ${pendingList.length} pending messages as sent?`)) return

    for (const item of pendingList) {
      await markWhatsAppMessageSent(item.id)
    }
    loadQueue()
  }

  // Render type badge (Sold Phone Receipts & Exchange Memos)
  const renderTypeBadge = (messageType, referenceData) => {
    const isExchange =
      messageType === 'phone_exchange_receipt' ||
      messageType === 'exchange_receipt' ||
      messageType === 'exchange' ||
      Boolean(referenceData?.is_exchange)

    if (isExchange) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200/50">
          <RefreshCw size={12} />
          <span>Exchange Phone Receipt</span>
        </span>
      )
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200/50">
        <Smartphone size={12} />
        <span>Sold Phone Receipt</span>
      </span>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-16 px-2 sm:px-4">
      {/* Mobile-Friendly App Header */}
      <div className="bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-green-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <MessageSquare size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                  WhatsApp Outbox (Sold & Exchange Phones)
                </h1>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-black bg-red-500 text-white rounded-full animate-pulse shadow-sm">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-[#86868b] dark:text-[#98989d]">
                1-tap mobile dispatch for customer sold phone receipts & exchange memos
              </p>
            </div>
          </div>

          <button
            onClick={loadQueue}
            disabled={loading}
            className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition shrink-0 active:scale-95"
            title="Refresh queue"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin text-emerald-600' : ''} />
          </button>
        </div>

        {/* Filter Tabs (Touch Friendly Segmented Control) */}
        <div className="mt-4 flex p-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl border border-black/[0.04] dark:border-white/[0.04]">
          <button
            onClick={() => setFilterTab('pending')}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              filterTab === 'pending'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm'
                : 'text-[#86868b] dark:text-[#98989d]'
            }`}
          >
            <Clock size={13} className={filterTab === 'pending' ? 'text-amber-500' : ''} />
            <span>Pending</span>
            {pendingCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setFilterTab('sent')}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              filterTab === 'sent'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm'
                : 'text-[#86868b] dark:text-[#98989d]'
            }`}
          >
            <CheckCircle size={13} className={filterTab === 'sent' ? 'text-emerald-500' : ''} />
            <span>Sent</span>
            {sentCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-[10px]">
                {sentCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
              filterTab === 'all'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-white shadow-sm'
                : 'text-[#86868b] dark:text-[#98989d]'
            }`}
          >
            <span>All ({messages.length})</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="mt-3 relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by customer name, phone, or invoice..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          />
        </div>
      </div>

      {/* Status Notice */}
      {warrantyStatusMsg && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 font-medium">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{warrantyStatusMsg}</span>
        </div>
      )}

      {/* Quick Global Action Bar - Available across all tabs and mobile devices */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-3.5 py-3 bg-white/90 dark:bg-[#1c1c1e]/90 border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleUpdateAllPendingWarranty}
            disabled={updatingWarranty}
            className="text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            title="Add or refresh shop warranty terms across all pending outbox messages"
          >
            <span>🛡️</span>
            <span>{updatingWarranty ? 'Updating...' : 'تمام میسجز میں وارنٹی شامل کریں (Add Warranty to All)'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
          {pendingCount > 0 && (
            <button
              onClick={handleMarkAllPendingSent}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 underline cursor-pointer px-1"
            >
              Mark all sent
            </button>
          )}

          <button
            onClick={() => {
              if (window.confirm('کیا آپ تمام پیجز کا کیشے صاف کر کے تازہ ترین اپڈیٹ لوڈ کرنا چاہتے ہیں؟\n\nForce refresh and purge device cache to load the latest app update?')) {
                if ('caches' in window) {
                  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
                }
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.update()))
                }
                window.location.reload()
              }
            }}
            className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer"
            title="Clear device cache and update app"
          >
            <span>⚡ اپڈیٹ چیک کریں (Update App)</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin mb-3" />
          <p className="text-xs">Loading WhatsApp outbox...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredMessages.length === 0 && (
        <div className="text-center py-12 px-4 bg-white/70 dark:bg-[#1c1c1e]/70 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center text-2xl">
            {filterTab === 'pending' ? '🎉' : '📬'}
          </div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">
            {filterTab === 'pending'
              ? 'No pending messages!'
              : filterTab === 'sent'
              ? 'No sent messages yet'
              : 'Queue is currently empty'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
            {filterTab === 'pending'
              ? 'When you sell or exchange a phone on the POS, customer receipts and greetings will automatically appear here for 1-tap mobile sending.'
              : 'Sent messages history will be archived here.'}
          </p>
        </div>
      )}

      {/* Cards List */}
      <div className="space-y-3">
        {filteredMessages.map((item) => {
          const isPending = item.status === 'pending'
          const isExpanded = expandedId === item.id
          const formattedDate = item.created_at
            ? new Date(item.created_at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })
            : ''

          return (
            <div
              key={item.id}
              className={`bg-white dark:bg-[#1c1c1e] rounded-2xl border transition shadow-sm overflow-hidden ${
                isPending
                  ? 'border-emerald-300 dark:border-emerald-800/80 ring-1 ring-emerald-400/20'
                  : 'border-gray-200 dark:border-gray-800 opacity-80 hover:opacity-100'
              }`}
            >
              {/* Card Header & Details */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm sm:text-base text-gray-900 dark:text-white">
                        {item.recipient_name || 'Customer'}
                      </span>
                      {renderTypeBadge(item.message_type, item.reference_data)}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono font-medium text-gray-600 dark:text-gray-400">
                      <span>📱 +{item.recipient_phone}</span>
                      {item.reference_id && (
                        <>
                          <span>•</span>
                          <span className="font-semibold text-gray-800 dark:text-gray-300">
                            {/^(INV|EXC)-/i.test(item.reference_id)
                              ? item.reference_id.toUpperCase()
                              : `${item.message_type?.includes('exchange') || item.reference_data?.is_exchange ? 'EXC' : 'INV'}-${item.reference_id.toUpperCase()}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status & Time */}
                  <div className="text-right shrink-0">
                    <div className="flex items-center justify-end gap-1">
                      {isPending ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full">
                          <Clock size={11} />
                          <span>Pending</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                          <CheckCircle size={11} />
                          <span>Sent</span>
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {formattedDate}
                    </div>
                  </div>
                </div>

                {/* Message Box: Edit Mode or Preview Mode */}
                {editingId === item.id ? (
                  <div className="bg-[#f8f9fa] dark:bg-[#252528] rounded-xl p-3 sm:p-4 border-2 border-emerald-500/80 shadow-md space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <Pencil size={13} />
                        <span>ترمیم میسج (Edit Message & Warranty)</span>
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={handleAppendWarrantyToEdit}
                          className="px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 rounded-lg transition flex items-center gap-1 cursor-pointer"
                          title="Append or refresh shop warranty terms"
                        >
                          <span>🛡️ + وارنٹی شامل کریں</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleResetToUrduInEdit(e, item)}
                          className="px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/40 rounded-lg transition flex items-center gap-1 cursor-pointer"
                          title="Reset to professional Urdu template with warranty"
                        >
                          <span>✨ ری سیٹ رسید</span>
                        </button>
                      </div>
                    </div>
                    <textarea
                      dir="auto"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full p-3 bg-white dark:bg-[#1c1c1e] border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-800 dark:text-gray-100 font-sans leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-none min-h-[160px] shadow-inner"
                      placeholder="Enter WhatsApp invoice text and warranty terms..."
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition cursor-pointer"
                      >
                        Cancel (منسوخ)
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleSaveEdit(e, item.id)}
                        className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Save size={13} />
                        <span>Save (محفوظ کریں)</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#f8f9fa] dark:bg-[#252528] rounded-xl p-3 border border-black/[0.04] dark:border-white/[0.04]">
                    <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/60 dark:border-gray-700/60 mb-2 gap-1 flex-wrap">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 flex items-center gap-1">
                        <span>📄</span>
                        <span>Message Content (رسید و وارنٹی)</span>
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Direct Edit Button */}
                        <button
                          onClick={(e) => handleStartEdit(e, item)}
                          className="px-2 py-0.5 text-[11px] font-bold rounded-lg bg-emerald-100/80 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 transition flex items-center gap-1 cursor-pointer"
                          title="Edit message text and warranty terms"
                        >
                          <Pencil size={11} />
                          <span>ترمیم (Edit)</span>
                        </button>

                        {/* Direct Add Warranty Button */}
                        <button
                          onClick={(e) => handleDirectAddWarranty(e, item)}
                          className="px-2 py-0.5 text-[11px] font-bold rounded-lg bg-amber-100/80 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 transition flex items-center gap-1 cursor-pointer"
                          title="Directly append or refresh shop warranty terms"
                        >
                          <span>🛡️ + وارنٹی</span>
                        </button>

                        <button
                          onClick={(e) => handleCopyText(e, item)}
                          className="px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:text-emerald-600 flex items-center gap-1 cursor-pointer"
                          title="Copy text"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check size={11} className="text-emerald-600" />
                              <span className="text-emerald-600 font-bold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <pre
                      dir="auto"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className={`text-xs text-gray-700 dark:text-gray-300 font-sans whitespace-pre-wrap leading-relaxed cursor-pointer ${
                        isExpanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      {item.message_text}
                    </pre>
                    {item.message_text && item.message_text.split('\n').length > 3 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline mt-1.5 block cursor-pointer"
                      >
                        {isExpanded ? '▲ Show less (کم تفصیل)' : '▼ Read full invoice details & warranty (مکمل تفصیل دیکھیں)...'}
                      </button>
                    )}
                  </div>
                )}

                {/* Primary Action Button (Big Touch-Target for Mobile) */}
                <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    onClick={() => handleSendViaWhatsApp(item)}
                    disabled={processingId === item.id}
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 hover:from-emerald-700 hover:to-green-700 active:scale-[0.98] text-white rounded-xl font-black text-sm tracking-wide shadow-md shadow-emerald-600/25 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send size={16} />
                    <span>📲 Send via WhatsApp</span>
                    <ExternalLink size={13} className="opacity-70" />
                  </button>

                  {/* Secondary buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                    {/* Direct Edit Button */}
                    <button
                      onClick={(e) => handleStartEdit(e, item)}
                      title="Edit this invoice message"
                      className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <Pencil size={13} className="text-emerald-600" />
                      <span>Edit</span>
                    </button>

                    {/* Direct Add / Refresh Warranty Button */}
                    <button
                      onClick={(e) => handleDirectAddWarranty(e, item)}
                      title="Add or update shop warranty terms in this invoice"
                      className="py-2.5 px-3 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer border border-amber-200/60 dark:border-amber-800/60 shadow-2xs"
                    >
                      <span>🛡️ + Warranty</span>
                    </button>

                    {/* View Digital Invoice / PDF Button */}
                    {(() => {
                      const match = (item.message_text || '').match(/https?:\/\/[^\s]+\/invoice\/([^\s]+)/i)
                      const invoiceParam = match
                        ? match[1]
                        : (item.reference_data?.invoice_token
                            ? `INV-${item.reference_data.invoice_token}`
                            : (item.reference_id && !/^\d+$/.test(String(item.reference_id)) ? item.reference_id : null))
                      if (!invoiceParam) return null
                      return (
                        <a
                          href={`/invoice/${encodeURIComponent(invoiceParam)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View customer digital invoice & download PDF with Nastaleeq warranty"
                          className="py-2.5 px-3 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer border border-blue-200/60 dark:border-blue-800/60 shadow-2xs"
                        >
                          <FileText size={13} className="text-blue-600" />
                          <span>PDF / بل</span>
                        </a>
                      )
                    })()}

                    {isPending ? (
                      <button
                        onClick={(e) => handleMarkSent(e, item)}
                        disabled={processingId === item.id}
                        title="Mark as already sent without opening WhatsApp"
                        className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <Check size={14} className="text-emerald-600" />
                        <span>Mark Sent</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSendViaWhatsApp(item)}
                        className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <RefreshCw size={12} />
                        <span>Resend</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => handleDelete(e, item.id)}
                      title="Delete from queue"
                      className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
