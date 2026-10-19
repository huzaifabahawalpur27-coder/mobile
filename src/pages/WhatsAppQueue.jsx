import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchWhatsAppQueue,
  markWhatsAppMessageSent,
  deleteWhatsAppMessage
} from '../services/whatsappQueueService'
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
  Check
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

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchWhatsAppQueue(user?.shop_id, 'all')
      setMessages(data)
    } catch (err) {
      console.error('Failed to load WhatsApp queue:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.shop_id])

  useEffect(() => {
    loadQueue()
    // Poll every 15s for new sales coming from desktop
    const timer = setInterval(() => {
      fetchWhatsAppQueue(user?.shop_id, 'all').then(data => {
        setMessages(data)
      })
    }, 15000)
    return () => clearInterval(timer)
  }, [loadQueue, user?.shop_id])

  // Counts
  const pendingCount = useMemo(() => messages.filter(m => m.status === 'pending').length, [messages])
  const sentCount = useMemo(() => messages.filter(m => m.status === 'sent').length, [messages])

  // Filtered List
  const filteredMessages = useMemo(() => {
    return messages.filter(m => {
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
  }, [messages, filterTab, searchQuery])

  // Handle Send via Native WhatsApp
  const handleSendViaWhatsApp = async (item) => {
    if (!item.recipient_phone) {
      alert('Phone number missing!')
      return
    }

    setProcessingId(item.id)
    try {
      // Mark as sent
      await markWhatsAppMessageSent(item.id)
      setMessages(prev => prev.map(m => m.id === item.id ? { ...m, status: 'sent', sent_at: new Date().toISOString() } : m))

      // Direct WhatsApp URL
      const encodedMsg = encodeURIComponent(item.message_text || '')
      const waUrl = `https://wa.me/${item.recipient_phone}?text=${encodedMsg}`

      // Open Native WhatsApp
      window.open(waUrl, '_blank')
    } catch (err) {
      console.error('Error dispatching message:', err)
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
    navigator.clipboard.writeText(item.message_text || '')
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 1800)
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

  // Render type badge
  const renderTypeBadge = (type) => {
    switch (type) {
      case 'phone_sale_receipt':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200/50">
            <Smartphone size={12} />
            <span>Phone Sale</span>
          </span>
        )
      case 'sale_receipt_urdu':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50">
            <Receipt size={12} />
            <span>انوائس (اردو)</span>
          </span>
        )
      case 'sale_receipt_en':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
            <Receipt size={12} />
            <span>POS Invoice</span>
          </span>
        )
      case 'phone_purchase':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200/50">
            <Package size={12} />
            <span>Purchase Memo</span>
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <MessageSquare size={12} />
            <span>WhatsApp</span>
          </span>
        )
    }
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
                  WhatsApp Outbox
                </h1>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-black bg-red-500 text-white rounded-full animate-pulse shadow-sm">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-[#86868b] dark:text-[#98989d]">
                1-tap mobile dispatch for receipts & greetings
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

      {/* Quick Action Banner */}
      {filterTab === 'pending' && pendingCount > 1 && (
        <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 rounded-xl text-xs">
          <span className="text-emerald-800 dark:text-emerald-300 font-medium">
            💡 Tap <b>"Send on WhatsApp"</b> on each card to dispatch from your phone.
          </span>
          <button
            onClick={handleMarkAllPendingSent}
            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 underline shrink-0 ml-2"
          >
            Mark all sent
          </button>
        </div>
      )}

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
              ? 'When you sell a phone or complete an invoice on the desktop POS, receipts and greetings will automatically appear here for 1-tap mobile sending.'
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
                      {renderTypeBadge(item.message_type)}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono font-medium text-gray-600 dark:text-gray-400">
                      <span>📱 +{item.recipient_phone}</span>
                      {item.reference_id && (
                        <>
                          <span>•</span>
                          <span className="font-semibold text-gray-800 dark:text-gray-300">
                            INV-{item.reference_id.slice(-6).toUpperCase()}
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

                {/* Message Preview Box */}
                <div className="bg-[#f8f9fa] dark:bg-[#252528] rounded-xl p-3 border border-black/[0.04] dark:border-white/[0.04]">
                  <div className="flex items-center justify-between pb-1.5 border-b border-gray-200/60 dark:border-gray-700/60 mb-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                      Message Content (No Warranty • Invoice Details Only)
                    </span>
                    <button
                      onClick={(e) => handleCopyText(e, item)}
                      className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:text-emerald-600 flex items-center gap-1"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check size={12} className="text-emerald-600" />
                          <span className="text-emerald-600">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre
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
                      className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline mt-1 block"
                    >
                      {isExpanded ? '▲ Show less' : '▼ Read full invoice details...'}
                    </button>
                  )}
                </div>

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
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    {isPending ? (
                      <button
                        onClick={(e) => handleMarkSent(e, item)}
                        disabled={processingId === item.id}
                        title="Mark as already sent without opening WhatsApp"
                        className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition flex items-center gap-1"
                      >
                        <Check size={14} className="text-emerald-600" />
                        <span>Mark Sent</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSendViaWhatsApp(item)}
                        className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition flex items-center gap-1"
                      >
                        <RefreshCw size={12} />
                        <span>Resend</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => handleDelete(e, item.id)}
                      title="Delete from queue"
                      className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition"
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
