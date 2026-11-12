import { useEffect, useMemo, useState } from 'react'
import { Bell, Send, Users, History, Undo2, Sparkles, RefreshCw, ArrowRight, Search } from 'lucide-react'
import { supabaseAdmin } from '../../services/supabaseAdmin'
import { useAuth } from '../../context/AuthContext'
import { logAction } from '../../services/auditService'
import { NOTIFICATION_CATEGORIES } from '../../services/notificationService'

// Pages of the shop app a notification can open
const MODULES = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/pos', label: 'POS' },
  { path: '/exchange', label: 'Phone Exchange' },
  { path: '/sales', label: 'Sales' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/products', label: 'Products' },
  { path: '/purchases', label: 'Purchases' },
  { path: '/purchase-history', label: 'Purchase History' },
  { path: '/custody', label: 'Phone Custody' },
  { path: '/customers', label: 'Customers' },
  { path: '/customer-ledger', label: 'Customer Ledger' },
  { path: '/suppliers', label: 'Suppliers' },
  { path: '/accounts', label: 'Accounts' },
  { path: '/expenses', label: 'Expenses' },
  { path: '/reports', label: 'Reports' },
  { path: '/whatsapp-queue', label: 'WhatsApp Outbox' },
  { path: '/settings', label: 'Settings' },
  { path: '/users', label: 'Users' },
  { path: '/trash', label: 'Trash' },
  { path: '/help', label: 'Help' }
]

// Recent releases, ready to push (review and edit before sending)
const RECENT_UPDATES = [
  {
    title: 'Correct a mistaken bank or cash entry',
    body: 'Entered a wrong amount or the wrong account? Tap the pencil button on any entry in Accounts. The balance adjusts by the difference only, and the original amount and your reason are kept in the entry\'s note.',
    path: '/accounts', category: 'feature'
  },
  {
    title: 'POS sales now save safely in one step',
    body: 'A sale, its items, stock and the customer\'s balance are now saved together. Two counters selling at the same time can no longer overwrite stock, and a phone can never be sold twice.',
    path: '/pos', category: 'fix'
  },
  {
    title: 'Accurate cost price on purchases',
    body: 'Cost price is now averaged over your old stock and the new purchase instead of being replaced by the latest price, so profit stays correct. Phone buy-backs no longer add the supplier balance twice.',
    path: '/purchases', category: 'fix'
  },
  {
    title: 'Resale price for trade-in phones',
    body: 'When taking a phone in exchange, enter the price you want to sell it for; POS will offer it at that price. Exchange numbers now count for your shop only.',
    path: '/exchange', category: 'feature'
  },
  {
    title: 'Customer and supplier ledgers fixed',
    body: 'Deleting ledger entries now puts stock back correctly, and balances no longer wipe out advance payments. Entries made offline now sync.',
    path: '/customers', category: 'fix'
  },
  {
    title: 'Reports show the full picture',
    body: 'Voided exchanges are left out, busy months are no longer cut off, and profit uses the cost saved with each sale. If the server cannot be reached, a notice tells you the figures come from this device.',
    path: '/reports', category: 'fix'
  }
]

const emptyForm = { title: '', body: '', path: '/dashboard', category: 'feature', target: 'all', shopIds: [] }
const moduleLabel = (path) => MODULES.find(m => m.path === path)?.label || ''

export default function ShopNotificationsAdmin() {
  const { user } = useAuth()
  const [form, setForm] = useState(emptyForm)
  const [shops, setShops] = useState([])
  const [shopSearch, setShopSearch] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [pushing, setPushing] = useState(false)
  const [notice, setNotice] = useState(null)

  const loadCampaigns = async () => {
    setLoadingList(true)
    const { data, error } = await supabaseAdmin.rpc('list_notification_campaigns', { p_limit: 100 })
    if (error) setNotice({ type: 'error', text: /not available|not find|does not exist/i.test(error.message) ? 'Notifications are not set up yet: run sql/shop_notifications.sql and restart the API server.' : error.message })
    else setCampaigns(Array.isArray(data) ? data : [])
    setLoadingList(false)
  }

  useEffect(() => {
    loadCampaigns()
    supabaseAdmin.from('shops').select('id, name, status').order('name', { ascending: true })
      .then(({ data }) => setShops(data || []))
  }, [])

  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase()
    return q ? shops.filter(s => `${s.name} ${s.id}`.toLowerCase().includes(q)) : shops
  }, [shops, shopSearch])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const toggleShop = (id) => set({ shopIds: form.shopIds.includes(id) ? form.shopIds.filter(x => x !== id) : [...form.shopIds, id] })

  const handlePush = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    if (form.target === 'selected' && form.shopIds.length === 0) { alert('Choose at least one shop.'); return }
    const audience = form.target === 'all' ? 'all active shops' : `${form.shopIds.length} shop(s)`
    if (!confirm(`Push "${form.title.trim()}" to ${audience}?\n\nEach shop sees it once as a popup, then it stays in their bell until they delete it.`)) return
    setPushing(true)
    setNotice(null)
    try {
      const { data, error } = await supabaseAdmin.rpc('push_shop_notification', {
        p_title: form.title.trim(),
        p_body: form.body.trim(),
        p_link_path: form.path || null,
        p_module_label: moduleLabel(form.path) || null,
        p_category: form.category,
        p_shop_ids: form.target === 'selected' ? form.shopIds.map(Number) : null,
        p_created_by: user?.email || user?.username || 'superadmin'
      })
      if (error) throw new Error(error.message)
      setNotice({ type: 'success', text: `Pushed to ${data?.recipients ?? 0} shop(s).` })
      logAction({
        actor_id: user?.id,
        actor_email: user?.email || user?.username,
        action_type: 'PUSH_SHOP_NOTIFICATION',
        target_type: 'SYSTEM',
        target_id: data?.campaign_id ? String(data.campaign_id) : null,
        details: { title: form.title.trim(), link: form.path, recipients: data?.recipients }
      }).catch(() => {})
      setForm(emptyForm)
      loadCampaigns()
    } catch (err) {
      setNotice({ type: 'error', text: 'Push failed: ' + (err?.message || err) })
    } finally {
      setPushing(false)
    }
  }

  const handleWithdraw = async (c) => {
    if (!confirm(`Withdraw "${c.title}"?\n\nIt will be removed from every shop's notifications.`)) return
    const { error } = await supabaseAdmin.rpc('withdraw_notification_campaign', { p_campaign_id: c.id })
    if (error) { alert('Withdraw failed: ' + error.message); return }
    setNotice({ type: 'success', text: `"${c.title}" withdrawn.` })
    loadCampaigns()
  }

  const cat = NOTIFICATION_CATEGORIES[form.category] || NOTIFICATION_CATEGORIES.feature
  const fieldClass = 'w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
          <Bell className="text-blue-600" size={30} /> Shop Notifications
        </h1>
        <p className="text-slate-500 font-medium mt-1 text-sm">
          Tell shops about changes. Each shop sees a notification once as a popup with a link to the module, then it stays in their bell until the owner deletes it.
        </p>
      </div>

      {notice && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-semibold ${notice.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {notice.text}
        </div>
      )}

      {/* Recent updates ready to push */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
        <h2 className="font-bold text-slate-700 flex items-center gap-2"><Sparkles size={18} className="text-amber-500" /> Recent updates</h2>
        <p className="text-xs text-slate-500">Pick one to fill the form, review it, then push.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {RECENT_UPDATES.map(u => {
            const sent = campaigns.some(c => c.title === u.title && !c.withdrawn_at)
            return (
              <button key={u.title} type="button"
                onClick={() => setForm({ ...emptyForm, title: u.title, body: u.body, path: u.path, category: u.category })}
                className="text-left p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{u.title}</span>
                  {sent && <span className="text-[10px] font-black uppercase text-emerald-600 shrink-0">Sent</span>}
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">{moduleLabel(u.path)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Compose */}
        <form onSubmit={handlePush} className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 space-y-4 text-sm">
          <h2 className="font-bold text-slate-700 flex items-center gap-2"><Send size={18} className="text-blue-500" /> New notification</h2>

          <div>
            <label htmlFor="n-title" className="block font-bold text-slate-700 mb-1">Title *</label>
            <input id="n-title" required maxLength={120} value={form.title} onChange={e => set({ title: e.target.value })} className={fieldClass} placeholder="e.g. Correct a mistaken bank entry" />
          </div>
          <div>
            <label htmlFor="n-body" className="block font-bold text-slate-700 mb-1">Message</label>
            <textarea id="n-body" rows={4} maxLength={1000} value={form.body} onChange={e => set({ body: e.target.value })} className={fieldClass} placeholder="What changed and how to use it" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="n-module" className="block font-bold text-slate-700 mb-1">Opens module</label>
              <select id="n-module" value={form.path} onChange={e => set({ path: e.target.value })} className={fieldClass}>
                {MODULES.map(m => <option key={m.path} value={m.path}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="n-cat" className="block font-bold text-slate-700 mb-1">Type</label>
              <select id="n-cat" value={form.category} onChange={e => set({ category: e.target.value })} className={fieldClass}>
                <option value="feature">New feature</option>
                <option value="fix">Fix</option>
                <option value="important">Important</option>
              </select>
            </div>
          </div>

          <fieldset className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
            <legend className="font-bold text-slate-700 flex items-center gap-2 px-1"><Users size={16} className="text-blue-500" /> Send to</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[{ id: 'all', label: 'All active shops' }, { id: 'selected', label: 'Chosen shops' }].map(o => (
                <label key={o.id} className={`cursor-pointer border p-3 rounded-xl flex items-center gap-2 font-bold text-slate-700 ${form.target === o.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200'}`}>
                  <input type="radio" name="n-target" checked={form.target === o.id} onChange={() => set({ target: o.id })} /> {o.label}
                </label>
              ))}
            </div>
            {form.target === 'selected' && (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input aria-label="Search shops" value={shopSearch} onChange={e => setShopSearch(e.target.value)} placeholder="Search shops" className={`${fieldClass} pl-8`} />
                </div>
                <div className="max-h-48 overflow-y-auto bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {filteredShops.map(s => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={form.shopIds.includes(s.id)} onChange={() => toggleShop(s.id)} />
                      <span className="font-semibold text-slate-700">{s.name || `Shop #${s.id}`}</span>
                      {s.status && s.status !== 'active' && <span className="text-[10px] uppercase font-black text-amber-600">{s.status}</span>}
                    </label>
                  ))}
                  {filteredShops.length === 0 && <p className="px-3 py-4 text-center text-slate-400 text-xs">No shops found</p>}
                </div>
                <p className="text-xs text-slate-500">{form.shopIds.length} selected</p>
              </div>
            )}
          </fieldset>

          <button type="submit" disabled={pushing || !form.title.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black rounded-xl inline-flex items-center justify-center gap-2">
            <Send size={16} /> {pushing ? 'Pushing…' : 'Push notification'}
          </button>
        </form>

        {/* Preview */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Preview (shop popup)</p>
          <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-hidden">
            <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-black uppercase tracking-widest flex items-center gap-2"><Bell size={14} /> New update</div>
            <div className="p-4 space-y-2">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${cat.className}`}>{cat.label}</span>
              <p className="text-base font-extrabold text-slate-900">{form.title || 'Title'}</p>
              <p className="text-sm text-slate-600 whitespace-pre-line">{form.body || 'Message'}</p>
              <p className="pt-1 text-xs font-black text-blue-600 inline-flex items-center gap-1">Open {moduleLabel(form.path)} <ArrowRight size={12} /></p>
            </div>
          </div>
        </div>
      </div>

      {/* Sent list */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-700 flex items-center gap-2"><History size={18} className="text-slate-500" /> Sent</h2>
          <button type="button" onClick={loadCampaigns} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Refresh sent list"><RefreshCw size={16} /></button>
        </div>
        {loadingList ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Nothing pushed yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {campaigns.map(c => (
              <li key={c.id} className={`py-3 flex flex-col sm:flex-row sm:items-center gap-2 ${c.withdrawn_at ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm">{c.title}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(c.created_at).toLocaleString('en-PK')} • {c.module_label || c.link_path || 'No link'} • {c.target === 'all' ? 'All shops' : 'Chosen shops'}
                    {c.withdrawn_at ? ' • Withdrawn' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-600 shrink-0">
                  <span title="Shops that received it">{c.recipients} sent</span>
                  <span title="Shops that saw the popup and still keep it in their bell">{c.seen} seen</span>
                  <span title="Shops that deleted it">{c.deleted} deleted</span>
                  {!c.withdrawn_at && (
                    <button type="button" onClick={() => handleWithdraw(c)} className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1">
                      <Undo2 size={13} /> Withdraw
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
