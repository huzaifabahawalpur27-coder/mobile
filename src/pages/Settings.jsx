import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import PasswordModal from '../components/PasswordModal'
import * as XLSX from 'xlsx'
import { buildBillHTML } from '../utils/billTemplates'
import { hasFeature } from '../utils/featureGate'
import { syncOfflineData } from '../services/syncService'
import {
  Store,
  MessageSquare,
  Printer,
  Landmark,
  Palette,
  Database,
  Save,
  CheckCircle2,
  Plus,
  Smartphone,
  Trash2,
  RefreshCw,
  HardDrive,
  Lock,
  Check,
  Tag,
  Receipt,
  Sparkles,
  Eye,
  Upload,
  AlertTriangle,
  FileSpreadsheet,
  Boxes
} from 'lucide-react'
import { useTheme, THEME_STYLES } from '../context/ThemeContext'
import { getBankAccounts } from '../services/bankService'
import BankAccountModal from '../components/BankAccountModal'
import {
  DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE,
  DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE,
  DEFAULT_WARRANTY_TERMS_URDU,
  updateExistingQueueMessagesWithWarranty,
  replaceOrInjectWarrantyInTemplate,
  isLegacyEnglishInvoiceTemplate,
  withWarrantyPlaceholder,
  upgradeDefaultTemplate
} from '../services/whatsappQueueService'
import { notify } from '../utils/toast'
import { isCashName } from '../utils/moneyMath'
import { confirmDialog } from '../utils/dialog'

// A template using the [Warranty Terms] placeholder already follows the saved terms;
// pasting a fixed copy into it would freeze today's wording in the template.
const syncWarrantyIntoTemplate = (template, terms) =>
  /[Warranty(?: Terms)?]/.test(template || '') ? template : replaceOrInjectWarrantyInTemplate(template, terms)

function Settings() {
  const { user } = useAuth()
  const { isDark, toggleTheme, themeStyle, setThemeStyle } = useTheme()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'profile'
  const setActiveTab = (tabId) => setSearchParams({ tab: tabId }, { replace: true })

  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingOutbox, setUpdatingOutbox] = useState(false)
  const [outboxUpdateStatus, setOutboxUpdateStatus] = useState(null)

  const [form, setForm] = useState(() => {
    const sid = user?.shop_id
    const saved = sid ? localStorage.getItem(`shop_settings_${sid}`) : null
    let parsedSaved = null
    if (saved) {
      try {
        parsedSaved = JSON.parse(saved)
      } catch (_) { /* fallback */ }
    }
    const savedWarranty = (sid ? localStorage.getItem(`shop_warranty_${sid}`) : null)
    return {
      name: (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'EdgeX POS',
      phone: '',
      address: '',
      logo_url: (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || '',
      invoice_footer: 'Thank you! Visit again',
      quotation_footer: 'This is an estimate only',
      print_size: 'thermal',
      print_mode: 'manual',
      wa_reminder_template: parsedSaved?.wa_reminder_template || 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!',
      // Unedited earlier built-in defaults are upgraded to the current format
      wa_bill_template: (parsedSaved?.wa_bill_template && !isLegacyEnglishInvoiceTemplate(parsedSaved.wa_bill_template))
        ? withWarrantyPlaceholder(upgradeDefaultTemplate(parsedSaved.wa_bill_template))
        : DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE,
      wa_exchange_template: upgradeDefaultTemplate((sid ? localStorage.getItem(`shop_wa_exchange_${sid}`) : null) || parsedSaved?.wa_exchange_template || DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE, 'exchange'),
      wa_reorder_template: '',
      invoice_prefix: '',
      warranty_terms: savedWarranty || parsedSaved?.warranty_terms || DEFAULT_WARRANTY_TERMS_URDU,
      business_preset: 'general',
      pricing_mode: 'hidden',
      custom_price_label: '',
      tax_number: '',
      pos_layout: 'two_stage',
      batch_costing_enabled: parsedSaved?.batch_costing_enabled || false,
      costing_method: parsedSaved?.costing_method || 'fifo'
    }
  })

  // Dedicated logo state
  const [logoUrl, setLogoUrl] = useState(() => {
    const sid = user?.shop_id
    return (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || ''
  })

  useEffect(() => {
    if (!user?.shop_id) return
    const saved = localStorage.getItem(`shop_logo_${user.shop_id}`)
    if (saved) setLogoUrl(saved)
  }, [user?.shop_id])

  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [planInfo, setPlanInfo] = useState(null)
  const [printTemplate, setPrintTemplate] = useState(() => {
    const sid = user?.shop_id
    return (sid ? localStorage.getItem(`print_template_${sid}`) : null) || localStorage.getItem('print_template') || '2'
  })
  const [previewTemplateId, setPreviewTemplateId] = useState(null)
  const [previewSize, setPreviewSize] = useState('thermal')
  const [syncDeadLetters, setSyncDeadLetters] = useState([])

  const loadSyncDeadLetters = useCallback(async () => {
    try {
      const rows = await db.sync_dead_letter?.toArray?.() || []
      setSyncDeadLetters(rows.filter(row => String(row.shop_id) === String(user?.shop_id)))
    } catch (_) { setSyncDeadLetters([]) }
  }, [user?.shop_id])

  useEffect(() => { loadSyncDeadLetters() }, [loadSyncDeadLetters])

  // Bank Accounts Management State
  const [bankAccounts, setBankAccounts] = useState([])
  const [loadingBanks, setLoadingBanks] = useState(false)
  const [showBankModal, setShowBankModal] = useState(false)

  const loadBankAccounts = async () => {
    if (!user?.shop_id) return
    setLoadingBanks(true)
    try {
      const list = await getBankAccounts(user.shop_id)
      setBankAccounts(list)
    } catch (e) {
      console.warn('Settings loadBankAccounts error:', e)
    } finally {
      setLoadingBanks(false)
    }
  }

  useEffect(() => {
    if (user?.shop_id) {
      loadBankAccounts()
    }
  }, [user?.shop_id])

  const getDummyItems = (presetId) => {
    switch (presetId) {
      case 'grocery':
        return [
          { name: 'Nestlé Milk 1L TetraPak', brand: 'Nestlé', qty: 3, custom_price: 290, sku: 'GROC-MLK-1L' },
          { name: 'Super Basmati Rice 5kg', brand: 'Guard', qty: 1, custom_price: 1850, sku: 'GROC-RICE-5K' },
          { name: 'Cooking Oil 1L Pouch', brand: 'Dalda', qty: 2, custom_price: 540, sku: 'GROC-OIL-1L' }
        ]
      case 'apparel':
        return [
          { name: 'Cotton Polo T-Shirt Navy (L)', brand: 'Polo', qty: 1, custom_price: 2450, sku: 'APP-POLO-NV-L' },
          { name: 'Slim Fit Denim Jeans 32', brand: "Levi's", qty: 1, custom_price: 3800, sku: 'APP-JNS-BLU-32' },
          { name: 'Casual Sports Socks (Pair)', brand: 'Nike', qty: 3, custom_price: 250, sku: 'APP-SOX-01' }
        ]
      case 'pharmacy':
        return [
          { name: 'Panadol Extra 500mg (Strip)', brand: 'GSK', qty: 5, custom_price: 45, sku: 'MED-PAN-EXT' },
          { name: 'Augmentin 625mg Tablets', brand: 'GSK', qty: 1, custom_price: 340, sku: 'MED-AUG-625' },
          { name: 'Surgical Face Mask (Pack 50)', brand: 'Pharmatec', qty: 1, custom_price: 450, sku: 'MED-MSK-50' }
        ]
      case 'electronics':
        return [
          { name: 'Fast Charger 65W GaN Type-C', brand: 'Anker', qty: 1, custom_price: 3200, sku: 'ELEC-CHG-65W' },
          { name: 'True Wireless Earbuds Pro', brand: 'Xiaomi', qty: 1, custom_price: 4500, sku: 'ELEC-TWS-PRO' },
          { name: 'Braided USB-C Cable 2m', brand: 'Baseus', qty: 2, custom_price: 650, sku: 'ELEC-CAB-2M' }
        ]
      default: // general / mobile
        return [
          { name: 'iPhone 15 Pro Max 256GB Natural', brand: 'Apple', qty: 1, custom_price: 345000, sku: 'APL-IP15PM-256' },
          { name: '20W USB-C Power Adapter', brand: 'Apple', qty: 1, custom_price: 4800, sku: 'APL-ADPT-20W' },
          { name: 'Clear MagSafe Shockproof Case', brand: 'Baseus', qty: 1, custom_price: 1850, sku: 'ACC-CAS-MAG' }
        ]
    }
  }

  const dummyItems = getDummyItems(form.business_preset)
  const dummySubtotal = dummyItems.reduce((acc, i) => acc + (i.custom_price * i.qty), 0)
  const dummyDiscount = 500
  const dummyTotal = dummySubtotal - dummyDiscount

  const dummyInvoiceData = {
    sale: {
      id: 87654321,
      created_at: new Date().toISOString(),
      created_by: user?.username || 'Staff Cashier',
      payment_type: 'cash',
      paid_amount: dummyTotal,
    },
    items: dummyItems,
    customer: {
      name: 'Ahmed Tariq',
      phone: '0300-1234567'
    },
    total: dummyTotal,
    subtotal: dummySubtotal,
    totalDiscount: dummyDiscount,
    change: 0
  }

  const getPreviewHTML = (templateId, size) => {
    const tempSettings = {
      name: form.name || 'EdgeX POS Demo',
      address: form.address || '123 Main Bazaar, EdgeX Market',
      phone: form.phone || '0301-2616367',
      logo_url: form.logo_url || '',
      invoice_footer: form.invoice_footer || 'Thank you! Visit again',
      quotation_footer: 'This is an estimate only',
      invoice_prefix: form.invoice_prefix || 'INV',
      print_size: size,
      print_template: templateId,
      shop_id: user?.shop_id
    }
    
    let html = buildBillHTML(dummyInvoiceData, false, tempSettings)
    html = html.replace(/<script>[\s\S]*?<\/script>/gi, '')
    return html
  }

  useEffect(() => {
    fetchShop()
    fetchPlanInfo()
  }, [])

  const fetchShop = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const sid = Number(user.shop_id)
      const fetchPromise = supabase.from('shops').select('*').eq('id', sid).maybeSingle()
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      if (error) throw error

      if (data) {
        setShop(data)
        setSettingsForm(data)
        await db.shops.put(JSON.parse(JSON.stringify(data)))
      }
    } catch (e) {
      console.log('Settings: Loading from local DB (Offline)')
      try {
        const sid = Number(user.shop_id)
        const localData = await db.shops.get(sid)
        if (localData) {
          setShop(localData)
          setSettingsForm(localData)
        }
      } catch (err) { console.error('Local Shop Fetch Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const setSettingsForm = (data) => {
    let saved = {}
    const sid = user?.shop_id
    try { saved = JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || '{}') } catch (_) {}

    setForm(prev => {
      const updated = {
        name:                 data.name                 || saved.name                 || prev.name                 || 'EdgeX POS',
        phone:                data.phone                || saved.phone                || prev.phone                || '',
        address:              data.address              || saved.address              || prev.address              || '',
        logo_url:             data.logo_url             || saved.logo_url             || prev.logo_url             || '',
        invoice_footer:       data.invoice_footer       || saved.invoice_footer       || prev.invoice_footer       || 'Thank you! Visit again',
        quotation_footer:     'This is an estimate only',
        print_size:           data.print_size           || saved.print_size           || prev.print_size           || 'thermal',
        print_mode:           data.print_mode           || saved.print_mode           || prev.print_mode           || 'manual',
        wa_reminder_template: data.wa_reminder_template || saved.wa_reminder_template || prev.wa_reminder_template || '',
        wa_bill_template:     (() => {
          const raw = data.wa_bill_template || saved.wa_bill_template || prev.wa_bill_template
          return (raw && !isLegacyEnglishInvoiceTemplate(raw)) ? withWarrantyPlaceholder(upgradeDefaultTemplate(raw)) : DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE
        })(),
        wa_exchange_template: upgradeDefaultTemplate((sid ? localStorage.getItem(`shop_wa_exchange_${sid}`) : null) || data.wa_exchange_template || saved.wa_exchange_template || prev.wa_exchange_template || DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE, 'exchange'),
        wa_reorder_template:  '',
        invoice_prefix:       data.invoice_prefix       || saved.invoice_prefix       || prev.invoice_prefix       || '',
        // The server copy (shops.warranty_terms) is the source of truth so every device,
        // receipt and customer bill shows the same terms; fall back to this device's copy
        // only when the server has none (not saved yet, or column not migrated).
        warranty_terms:       (typeof data.warranty_terms === 'string' && data.warranty_terms.trim() ? data.warranty_terms : null) || (sid ? localStorage.getItem(`shop_warranty_${sid}`) : null) || saved.warranty_terms || prev.warranty_terms || DEFAULT_WARRANTY_TERMS_URDU,
        business_preset:      data.business_preset      || saved.business_preset      || prev.business_preset      || 'general',
        pricing_mode:         data.pricing_mode         || saved.pricing_mode         || prev.pricing_mode         || 'hidden',
        custom_price_label:   data.custom_price_label   || saved.custom_price_label   || prev.custom_price_label   || '',
        tax_number:           data.tax_number           || saved.tax_number           || prev.tax_number           || '',
        pos_layout:           data.pos_layout           || saved.pos_layout           || prev.pos_layout           || 'two_stage',
        batch_costing_enabled: data.batch_costing_enabled !== undefined ? Boolean(data.batch_costing_enabled) : (saved.batch_costing_enabled !== undefined ? Boolean(saved.batch_costing_enabled) : (prev.batch_costing_enabled || false)),
        costing_method:       data.costing_method       || saved.costing_method       || prev.costing_method       || 'fifo'
      }

      if (sid) {
        const fullSettings = { ...updated, print_template: data.print_template || saved.print_template || localStorage.getItem(`print_template_${sid}`) || '2' }
        localStorage.setItem(`shop_settings_${sid}`, JSON.stringify(fullSettings))
        localStorage.setItem(`shop_name_${sid}`, updated.name)
        // POS, Exchange and the outbox read shop_warranty_${sid}; keep it in step
        if (updated.warranty_terms) localStorage.setItem(`shop_warranty_${sid}`, updated.warranty_terms)
        if (updated.logo_url) {
          localStorage.setItem(`shop_logo_${sid}`, updated.logo_url)
        }
      }
      return updated
    })

    const tmpl = data.print_template || saved.print_template || (sid ? localStorage.getItem(`print_template_${sid}`) : null) || '2'
    setPrintTemplate(tmpl)
    if (sid) {
      localStorage.setItem(`print_template_${sid}`, tmpl)
    }

    const logo = data.logo_url || saved.logo_url || (sid ? localStorage.getItem(`shop_logo_${sid}`) : null) || ''
    setLogoUrl(logo)
    if (sid && logo) {
      localStorage.setItem(`shop_logo_${sid}`, logo)
    }
  }

  const fetchPlanInfo = async () => {
    const sid = user?.shop_id
    const cached = sid ? localStorage.getItem(`plan_limits_${sid}`) : null
    if (cached) {
      try {
        setPlanInfo(JSON.parse(cached))
      } catch (_) { /* ignore */ }
    }

    if (!navigator.onLine || !sid) return
    try {
      const { data, error } = await supabase.rpc('get_shop_config', { p_shop_id: sid })
      if (!error && data) {
        setPlanInfo(data)
        localStorage.setItem(`plan_limits_${sid}`, JSON.stringify(data))
        if (data.features) {
          localStorage.setItem(`plan_features_${sid}`, JSON.stringify(data.features))
        }
      }
    } catch (e) {
      console.error('Settings Plan Fetch Error', e)
    }
  }

  const handleUpdate = async (e) => {
    if (e && e.preventDefault) e.preventDefault()
    setSaving(true)

    const sid = Number(user.shop_id)
    const fullSettings = { ...form, logo_url: logoUrl, print_template: printTemplate }
    const previousWarranty = (localStorage.getItem(`shop_warranty_${sid}`) || '').trim()
    const warrantyChanged = Boolean(form.warranty_terms && form.warranty_terms.trim() !== previousWarranty)

    localStorage.setItem(`shop_settings_${sid}`, JSON.stringify(fullSettings))
    localStorage.setItem(`shop_name_${sid}`, form.name || 'EdgeX POS')
    if (form.warranty_terms) {
      localStorage.setItem(`shop_warranty_${sid}`, form.warranty_terms)
    }
    if (form.wa_exchange_template) {
      localStorage.setItem(`shop_wa_exchange_${sid}`, form.wa_exchange_template)
    }

    const supabasePayload = {
      name: form.name,
      phone: form.phone,
      address: form.address,
      invoice_footer: form.invoice_footer,
      quotation_footer: 'This is an estimate only',
      print_size: form.print_size,
      print_mode: form.print_mode,
      print_template: printTemplate,
      wa_reminder_template: form.wa_reminder_template,
      wa_bill_template: form.wa_bill_template,
      wa_reorder_template: '',
      invoice_prefix: form.invoice_prefix,
    }

    try {
      const baseParams = {
        p_shop_id: sid,
        p_name: form.name,
        p_phone: form.phone,
        p_address: form.address,
        p_invoice_footer: form.invoice_footer,
        p_quotation_footer: 'This is an estimate only',
        p_print_size: form.print_size,
        p_print_mode: form.print_mode,
        p_print_template: printTemplate,
        p_wa_reminder_template: form.wa_reminder_template,
        p_wa_bill_template: form.wa_bill_template,
        p_wa_reorder_template: '',
        p_invoice_prefix: form.invoice_prefix,
      }
      // Warranty terms and the exchange template are stored on the server so they do not
      // revert on other devices, after re-login, or on the customer's online bill.
      // Needs sql/phase1_warranty_settings.sql; older databases fall back to the base call.
      let warrantyOnServer = true
      let { data: rpcResult, error } = await supabase.rpc('update_shop_settings', {
        ...baseParams,
        p_warranty_terms: form.warranty_terms || null,
        p_wa_exchange_template: form.wa_exchange_template || null,
      })
      if (error && (error.code === 'PGRST202' || /p_warranty_terms|could not find the function/i.test(error.message || ''))) {
        warrantyOnServer = false
        console.warn('update_shop_settings has no p_warranty_terms yet; run sql/phase1_warranty_settings.sql. Warranty saved on this device only.')
        ;({ data: rpcResult, error } = await supabase.rpc('update_shop_settings', baseParams))
      }
      if (error) throw error
      if (rpcResult && !rpcResult.success) throw new Error(rpcResult.error || 'Update failed')

      // Sync batch costing settings directly to shops table
      if (form.batch_costing_enabled !== undefined) {
        try {
          await supabase.from('shops').update({
            batch_costing_enabled: Boolean(form.batch_costing_enabled),
            costing_method: form.costing_method || 'fifo'
          }).eq('id', sid)
        } catch (_) {}
      }

      // Older databases: the RPC cannot store these, try a direct update (works only
      // where RLS still allows shop updates).
      if (!warrantyOnServer) {
        const { error: directErr } = await supabase.from('shops').update({
          warranty_terms: form.warranty_terms || null,
          wa_exchange_template: form.wa_exchange_template || null
        }).eq('id', sid)
        if (!directErr) warrantyOnServer = true
        else console.warn('Could not store warranty terms on server:', directErr.message || directErr)
      }

      // Apply edited terms to messages already waiting in the WhatsApp outbox
      let outboxUpdated = 0
      if (warrantyChanged) {
        try {
          outboxUpdated = await updateExistingQueueMessagesWithWarranty(sid, form.warranty_terms)
        } catch (outboxErr) {
          console.warn('Could not apply warranty terms to outbox:', outboxErr)
        }
      }

      await db.shops.put({ ...fullSettings, id: sid })
      window.dispatchEvent(new Event('storage'))
      notify(
        'Settings saved successfully! ✅' +
        (outboxUpdated > 0 ? `\n\nوارنٹی شرائط ${outboxUpdated} پینڈنگ آؤٹ باکس میسجز میں بھی لاگو کر دی گئیں۔ (${outboxUpdated} pending outbox messages updated)` : '') +
        (!warrantyOnServer ? '\n\n⚠️ Warranty terms were saved on this device only (server database needs sql/phase1_warranty_settings.sql). Other devices and online bills will still show the old terms.' : '')
      )
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.shops.put({ ...fullSettings, id: sid })
        await addToSyncQueue('shops', 'UPDATE', { id: sid, ...supabasePayload })
        window.dispatchEvent(new Event('storage'))
        notify('Offline mode: Settings saved to device. Will sync when online. 🔄')
      } else {
        notify('Save failed: ' + errMsg)
      }
    } finally {
      setSaving(false)
    }
  }

  // Keyboard shortcut Ctrl+S / Cmd+S to save settings
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleUpdate(e)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [form, logoUrl, printTemplate])

  // Compress logo image via canvas
  const compressImage = (file) => {
    return new Promise((resolve) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const MAX = 300
        let w = img.width
        let h = img.height
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX }
        else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.onerror = () => {
        const reader = new FileReader()
        reader.onload = evt => resolve(evt.target.result)
        reader.readAsDataURL(file)
      }
      img.src = objectUrl
    })
  }

  const handleLogoUpload = async (e) => {
    const sid = Number(user.shop_id)
    const file = e.target.files[0]
    if (!file) return

    setSaving(true)
    try {
      const compressed = await compressImage(file)
      setLogoUrl(compressed)
      localStorage.setItem(`shop_logo_${sid}`, compressed)

      const updatedForm = { ...form, logo_url: compressed }
      setForm(updatedForm)
      localStorage.setItem(`shop_settings_${sid}`, JSON.stringify(updatedForm))

      try { await db.shops.update(sid, { logo_url: compressed }) } catch (_) {}
      window.dispatchEvent(new Event('storage'))

      if (navigator.onLine) {
        const { data: rpcResult, error } = await supabase.rpc('update_shop_settings', {
          p_shop_id: sid,
          p_logo_url: compressed,
        })
        if (error || (rpcResult && !rpcResult.success)) {
          const msg = error?.message || rpcResult?.error || 'Unknown error'
          notify('Logo saved locally ✅\n⚠️ Server sync notice: ' + msg)
        } else {
          notify('Logo uploaded & synced successfully! ✅')
        }
      } else {
        notify('Logo saved on this device ✅ (Offline — will sync when connected)')
      }
    } catch (err) {
      console.error('Logo upload error:', err)
      notify('Logo upload failed: ' + (err?.message || String(err)))
    } finally {
      setSaving(false)
    }
  }

  const handleApplyWarrantyToTemplate = () => {
    const updatedBill = syncWarrantyIntoTemplate(form.wa_bill_template, form.warranty_terms)
    const updatedExchange = syncWarrantyIntoTemplate(form.wa_exchange_template, form.warranty_terms)
    setForm(prev => ({
      ...prev,
      wa_bill_template: updatedBill,
      wa_exchange_template: updatedExchange
    }))
    notify('وارنٹی شرائط کو سیلز بل اور فون ایکسچینج ٹیمپلیٹس دونوں میں کامیابی سے شامل کر دیا گیا ہے! ✅\n\nWarranty terms have been synced to both invoice and exchange templates.')
  }

  const handleUpdateOutboxWarranty = async () => {
    if (!await confirmDialog('کیا آپ تمام پینڈنگ واٹس ایپ آؤٹ باکس میسجز میں اپنی تبدیل شدہ وارنٹی شرائط لاگو کرنا چاہتے ہیں؟\n\nAre you sure you want to update all pending outbox messages with your modified warranty terms?')) {
      return
    }
    setUpdatingOutbox(true)
    setOutboxUpdateStatus(null)
    try {
      const count = await updateExistingQueueMessagesWithWarranty(user?.shop_id, form.warranty_terms)
      setOutboxUpdateStatus(`کامیابی! ${count} میسجز میں تبدیل شدہ وارنٹی لاگو کر دی گئی ہے۔ (${count} messages updated in outbox)`)
      setTimeout(() => setOutboxUpdateStatus(null), 6000)
    } catch (err) {
      setOutboxUpdateStatus('Error updating outbox messages: ' + (err?.message || String(err)))
    } finally {
      setUpdatingOutbox(false)
    }
  }

  const NAV_SECTIONS = [
    { id: 'profile', label: 'Store Profile', icon: Store, badge: null, desc: 'Branding, logo, address & invoice prefix' },
    { id: 'whatsapp', label: 'WhatsApp & Warranty', icon: MessageSquare, badge: null, desc: 'Sale receipt, warranty terms & reminders' },
    { id: 'printing', label: 'Bill Printing', icon: Printer, badge: form.print_size === 'a4' ? 'A4' : '80mm', desc: 'Paper size, 4 invoice styles & preview' },
    { id: 'banking', label: 'Bank Accounts', icon: Landmark, badge: bankAccounts.length > 0 ? `${bankAccounts.length}` : null, desc: 'Balances, cash drawer & vaults' },
    { id: 'appearance', label: 'Theme & POS Layout', icon: Palette, badge: null, desc: 'Mobile OS styles, dark mode & checkout dock' },
    { id: 'system', label: 'Data & Maintenance', icon: Database, badge: syncDeadLetters.length > 0 ? '⚠️' : null, desc: 'Backups, offline sync & danger zone' },
  ]

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-500">
        <div className="w-9 h-9 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium">Loading store settings...</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-16 px-2 sm:px-4">
      {/* ── Top Header Bar ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-black text-xl shrink-0 shadow-xs">
            ⚙️
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-black text-gray-900 dark:text-white tracking-tight">
                Store Settings
              </h1>
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-xs font-bold uppercase rounded-md tracking-wider">
                Shop ID: #{user?.shop_id}
              </span>
              {planInfo && (
                <span className="px-2 py-0.5 bg-blue-100/80 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-xs font-extrabold rounded-md uppercase">
                  {planInfo.plan_name} Tier
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Customize shop profile, WhatsApp invoice receipts, warranty, thermal printing, and settlement accounts.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleUpdate}
          disabled={saving}
          className="self-stretch sm:self-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          <Save size={16} className={saving ? 'animate-spin' : ''} />
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          <span className="hidden sm:inline-block text-xs bg-blue-700/60 px-1.5 py-0.5 rounded font-mono text-blue-100">Ctrl+S</span>
        </button>
      </div>

      {/* ── Mobile Horizontal Pill Bar (Visible on mobile only) ── */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {NAV_SECTIONS.map((sec) => {
          const Icon = sec.icon
          const isActive = activeTab === sec.id
          return (
            <button
              key={sec.id}
              onClick={() => setActiveTab(sec.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer shrink-0 border ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-slate-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-white' : 'text-blue-500'} />
              <span>{sec.label}</span>
              {sec.badge && (
                <span className={`text-xs px-1.5 py-0.2 rounded-full font-mono ${
                  isActive ? 'bg-blue-700 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600'
                }`}>
                  {sec.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Main Master-Detail Layout ── */}
      <div className="flex flex-col md:flex-row items-start gap-4">
        {/* Desktop Sticky Side Navigation */}
        <aside className="hidden md:block w-64 shrink-0 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-2.5 shadow-xs sticky top-3 space-y-1">
          <div className="px-3 py-2">
            <span className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-slate-500">
              Settings Menu
            </span>
          </div>

          {NAV_SECTIONS.map((sec) => {
            const Icon = sec.icon
            const isActive = activeTab === sec.id
            return (
              <button
                key={sec.id}
                onClick={() => setActiveTab(sec.id)}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition text-left cursor-pointer group ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold ring-1 ring-blue-500/20'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700/60 font-medium'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 transition ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 group-hover:text-blue-600'
                  }`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-tight truncate">{sec.label}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">{sec.desc}</p>
                  </div>
                </div>

                {sec.badge && (
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full font-bold shrink-0 ${
                    isActive
                      ? 'bg-blue-200/80 dark:bg-blue-800 text-blue-900 dark:text-blue-100'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                  }`}>
                    {sec.badge}
                  </span>
                )}
              </button>
            )
          })}

          <div className="pt-3 mt-2 border-t border-gray-100 dark:border-slate-700 px-3 pb-1">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-500">
              <span>Status:</span>
              <span className="font-semibold text-emerald-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {navigator.onLine ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>
        </aside>

        {/* Right Active Section Canvas */}
        <main className="flex-1 min-w-0 w-full">
          <form onSubmit={handleUpdate} className="space-y-4">
            {/* ══════════════ 1. STORE PROFILE SECTION ══════════════ */}
            {activeTab === 'profile' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-6 shadow-xs">
                <div className="border-b border-gray-100 dark:border-slate-700 pb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Store className="text-blue-600" size={18} />
                      <span>Store Profile & Branding</span>
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      Store name, contact number, address, and invoice branding shown to customers.
                    </p>
                  </div>
                </div>

                {/* Logo Uploader */}
                <div className="p-4 bg-gray-50 dark:bg-slate-900/60 rounded-xl border border-gray-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-white dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center overflow-hidden shrink-0 shadow-xs relative">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Store Logo" className="w-full h-full object-contain p-1" />
                    ) : (
                      <div className="text-center text-gray-500">
                        <Upload size={22} className="mx-auto mb-1 opacity-60" />
                        <span className="text-xs font-bold uppercase tracking-wider block">No Logo</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 text-center sm:text-left flex-1">
                    <p className="text-xs font-bold text-gray-800 dark:text-gray-200">Shop Logo (Receipts & Invoices)</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                      PNG, JPG or WebP. Automatically compressed for thermal receipt printers and PDF exports.
                    </p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      <label className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5">
                        <Upload size={13} />
                        <span>Upload Logo</span>
                        <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                      </label>
                      {logoUrl && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!await confirmDialog('Remove the shop logo?', { confirmLabel: 'Remove logo', danger: true })) return
                            const sid = Number(user.shop_id)
                            setLogoUrl('')
                            localStorage.removeItem(`shop_logo_${sid}`)
                            setForm(prev => ({ ...prev, logo_url: '' }))
                            try { await db.shops.update(sid, { logo_url: '' }) } catch (_) {}
                            if (navigator.onLine) {
                              supabase.rpc('update_shop_settings', { p_shop_id: sid, p_logo_url: '' })
                              .then(({ error }) => { if (error) console.warn('Could not clear logo on server:', error.message || error) })
                            }
                          }}
                          className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-xs font-bold transition"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Profile Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Shop / Business Name <span className="text-red-500">*</span>
                    </label>
                    <input aria-label=" Shop / Business Name "
                      type="text"
                      required
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Star Mobile Zone"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Contact Phone / WhatsApp
                    </label>
                    <input aria-label=" Contact Phone / WhatsApp "
                      type="text"
                      value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. 0300-1234567"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Business Address / Shop Location
                    </label>
                    <input aria-label=" Business Address / Shop Location "
                      type="text"
                      value={form.address}
                      onChange={e => setForm({ ...form, address: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Shop # 14, Ground Floor, Hafeez Centre, Lahore"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Invoice Number Prefix
                    </label>
                    <input aria-label=" Invoice Number Prefix "
                      type="text"
                      value={form.invoice_prefix}
                      onChange={e => setForm({ ...form, invoice_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 8) })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-mono font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. INV or STAR"
                      maxLength={8}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Preview: <span className="font-mono font-bold text-blue-600">{form.invoice_prefix || 'INV'}-00001234</span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Tax / NTN / STRN No. (Optional)
                    </label>
                    <input aria-label=" Tax / NTN / STRN No. (Optional) "
                      type="text"
                      value={form.tax_number}
                      onChange={e => setForm({ ...form, tax_number: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. NTN: 1234567-8"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Invoice Closing / Footer Note (Urdu/Eng)
                    </label>
                    <input aria-label=" Invoice Closing / Footer Note (Urdu/Eng) "
                      type="text"
                      value={form.invoice_footer}
                      onChange={e => setForm({ ...form, invoice_footer: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Thank you for your business! Visit again"
                    />
                  </div>
                </div>

                {/* Business Model & Pricing Configuration */}
                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Secondary / Catalog Price Mode
                    </label>
                    <select aria-label=" Secondary / Catalog Price Mode "
                      value={form.pricing_mode}
                      onChange={e => setForm({ ...form, pricing_mode: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="hidden">Standard Retail (Only Cost & Sale Price)</option>
                      <option value="mrp">MRP / Printed List Price</option>
                      <option value="c_rate">Company Rate (C.Rate) with Discount Matrix</option>
                      <option value="custom">Custom Tag / Wholesale Price Label</option>
                    </select>
                  </div>

                  {form.pricing_mode === 'custom' && (
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                        Custom Price Label Name
                      </label>
                      <input aria-label=" Custom Price Label Name "
                        type="text"
                        value={form.custom_price_label}
                        onChange={e => setForm({ ...form, custom_price_label: e.target.value })}
                        placeholder="e.g. Tag Price / MSRP"
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* ─── FIFO Batch Inventory Costing Toggle ─── */}
                <div className="p-4 bg-gradient-to-r from-emerald-50/60 to-teal-50/40 dark:from-emerald-950/20 dark:to-teal-950/10 rounded-2xl border border-emerald-200 dark:border-emerald-800/50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                        <Boxes size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                            Batch-Based FIFO Inventory Costing (Lots)
                          </h3>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                            form.batch_costing_enabled 
                              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700' 
                              : 'bg-gray-100 dark:bg-slate-800 text-gray-500 border border-gray-200 dark:border-slate-700'
                          }`}>
                            {form.batch_costing_enabled ? 'Active (FIFO)' : 'Disabled (Legacy)'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          Enables lot-based First-In First-Out costing for non-serialized accessories. Each purchase creates a distinct lot, and sales consume oldest lots first for exact profit and inventory valuation.
                        </p>
                      </div>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0 self-start sm:self-center">
                      <input
                        type="checkbox"
                        checked={Boolean(form.batch_costing_enabled)}
                        onChange={e => setForm({ ...form, batch_costing_enabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  {form.batch_costing_enabled && (
                    <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/40 flex flex-wrap items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                      <span>Costing Strategy: <strong>First-In First-Out (FIFO)</strong></span>
                      <span className="text-gray-500 dark:text-slate-400">Products can be converted individually from the Products screen</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Update Store Profile'}
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════ 2. WHATSAPP & WARRANTY SECTION ══════════════ */}
            {activeTab === 'whatsapp' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-6 shadow-xs">
                <div className="border-b border-gray-100 dark:border-slate-700 pb-4">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <MessageSquare className="text-emerald-600" size={18} />
                    <span>WhatsApp Messaging & Mobile Warranty</span>
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Customer receipts, mobile checking warranty terms, and outstanding ledger balance reminders.
                  </p>
                </div>

                {outboxUpdateStatus && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 size={16} className="shrink-0" />
                    <span>{outboxUpdateStatus}</span>
                  </div>
                )}

                {/* Invoice WhatsApp Bill Template */}
                <div className="space-y-3 bg-gray-50/70 dark:bg-slate-900/50 p-4 rounded-2xl border border-gray-200 dark:border-slate-700">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-sm font-bold text-gray-800 dark:text-gray-100">
                        🧾 New Bill / Sale Template (انوائس بل میسج)
                      </label>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        پی او ایس پر فروخت مکمل ہوتے ہی یہ پیغام واٹس ایپ آؤٹ باکس میں خودکار طور پر تیار ہوتا ہے۔
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirmDialog('کیا آپ تجویز کردہ پروفیشنل انوائس اور وارنٹی لوڈ کرنا چاہتے ہیں؟')) {
                            setForm(prev => ({ ...prev, wa_bill_template: DEFAULT_PROFESSIONAL_INVOICE_TEMPLATE }))
                          }
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 transition flex items-center gap-1 cursor-pointer"
                        title="Load recommended professional invoice with warranty"
                      >
                        ✨ تجویز کردہ انوائس
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            wa_bill_template: syncWarrantyIntoTemplate(prev.wa_bill_template, prev.warranty_terms)
                          }))
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 transition flex items-center gap-1 cursor-pointer"
                        title="Insert or update warranty terms in current template"
                      >
                        🛡️ + وارنٹی شرائط شامل کریں
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdateOutboxWarranty}
                        disabled={updatingOutbox}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                        title="Update all unsent messages in WhatsApp outbox with current warranty terms"
                      >
                        {updatingOutbox ? '🔄 Updating...' : '🔄 آؤٹ باکس اپڈیٹ کریں'}
                      </button>
                    </div>
                  </div>

                  <textarea aria-label="السلام علیکم Name Shop Name سے خریداری کا شکریہ"
                    dir="auto"
                    value={form.wa_bill_template}
                    onChange={e => setForm({ ...form, wa_bill_template: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-xs sm:text-sm font-sans h-52 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 leading-relaxed"
                    placeholder="السلام علیکم [Name]! [Shop Name] سے خریداری کا شکریہ..."
                  />

                  {/* Tag Inserters */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 mr-1">
                      ٹیگز شامل کریں (Insert Tags):
                    </span>
                    {[
                      { tag: '[Name]', desc: 'Customer Name' },
                      { tag: '[Shop Name]', desc: 'Shop Name' },
                      { tag: '[Invoice ID]', desc: 'Bill number (e.g. INV-156)' },
                      { tag: '[Date]', desc: 'Date & Time' },
                      { tag: '[Items]', desc: 'Phones with IMEI, condition, PTA & price' },
                      { tag: '[Payment Summary]', desc: 'Total, discount, received & balance lines' },
                      { tag: '[Total]', desc: 'Payable Amount' },
                      { tag: '[Paid]', desc: 'Paid Amount' },
                      { tag: '[Balance]', desc: 'Customer Account Balance' },
                      { tag: '[Invoice Link]', desc: 'Online Invoice & PDF Link' },
                      { tag: '[Warranty Terms]', desc: 'Warranty Terms' },
                      { tag: '[Shop Address]', desc: 'Shop Address' },
                      { tag: '[Phone]', desc: 'Shop Phone' }
                    ].map(({ tag, desc }) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            wa_bill_template: (prev.wa_bill_template || '') + ' ' + tag
                          }))
                        }}
                        className="px-2 py-0.5 text-xs font-mono bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-emerald-400 text-gray-700 dark:text-gray-300 rounded cursor-pointer transition shadow-xs"
                        title={desc}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>

                  {/* ── Option to Modify Warranty Terms ── */}
                  <div className="p-4 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl space-y-2.5 mt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 dark:border-amber-800/50 pb-2">
                      <div>
                        <label className="block text-xs sm:text-sm font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                          <span>🛡️ موبائل وارنٹی شرائط تبدیل کریں (Modify Warranty Terms)</span>
                        </label>
                        <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                          یہاں سے آپ اپنی شاپ کی وارنٹی شرائط میں جو چاہیں ترمیم، تبدیلی یا نیا نکتہ شامل کر سکتے ہیں۔
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            if (await confirmDialog('کیا آپ وارنٹی شرائط کو ڈیفالٹ پر ری سیٹ کرنا چاہتے ہیں؟')) {
                              setForm(prev => ({ ...prev, warranty_terms: DEFAULT_WARRANTY_TERMS_URDU }))
                            }
                          }}
                          className="px-2 py-1 text-xs font-semibold rounded-lg bg-amber-200/70 hover:bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 transition cursor-pointer"
                          title="Reset to default 3 warranty points"
                        >
                          ✨ ڈیفالٹ شرائط
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyWarrantyToTemplate}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition flex items-center gap-1 cursor-pointer shadow-xs"
                          title="Sync these warranty terms directly into the bill template above"
                        >
                          📝 انوائس میسج میں لاگو کریں
                        </button>
                      </div>
                    </div>

                    <textarea aria-label="وارنٹی شرائط درج کریں (e.g. ۱ LCD کی وارنٹی نہیں ہوگی...)"
                      dir="auto"
                      rows={4}
                      value={form.warranty_terms}
                      onChange={e => setForm({ ...form, warranty_terms: e.target.value })}
                      className="w-full px-3 py-2.5 border border-amber-300 dark:border-amber-700/80 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-xs sm:text-sm font-sans bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 leading-relaxed"
                      placeholder="وارنٹی شرائط درج کریں (e.g. ۱۔ LCD کی وارنٹی نہیں ہوگی...)"
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-amber-800 dark:text-amber-300">
                      <span>💡 جو وارنٹی شرائط آپ یہاں لکھیں گے، وہ بل ٹیمپلیٹ، پی او ایس بلز اور آؤٹ باکس میں استعمال ہوں گی۔</span>
                      <span className="font-mono text-xs opacity-75 self-end sm:self-auto">{form.warranty_terms?.length || 0} characters</span>
                    </div>
                  </div>
                </div>

                {/* ── 2. PHONE TRADE-IN & EXCHANGE WHATSAPP BILL TEMPLATE ── */}
                <div className="space-y-3 bg-purple-50/60 dark:bg-purple-950/20 p-4 rounded-2xl border border-purple-200/80 dark:border-purple-800/60">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-200/60 dark:border-purple-800/40 pb-2.5">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                        <RefreshCw size={16} className="text-purple-600 dark:text-purple-400" />
                        <span>🔄 فون ایکسچینج واٹس ایپ ٹیمپلیٹ (Phone Exchange WhatsApp Template)</span>
                      </label>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        کسٹمر کو پرانا فون جمع کروانے اور خریدا گیا فون / سامان کی رسید و حتمی حساب بھیجنے کا ٹیمپلیٹ۔
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirmDialog('کیا آپ فون ایکسچینج کی تجویز کردہ ڈیفالٹ رسید لوڈ کرنا چاہتے ہیں؟')) {
                            setForm(prev => ({ ...prev, wa_exchange_template: DEFAULT_EXCHANGE_WHATSAPP_TEMPLATE }))
                          }
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-purple-100 hover:bg-purple-200/80 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 transition flex items-center gap-1 cursor-pointer"
                        title="Load recommended exchange template with trade-in devices and settlement"
                      >
                        ✨ تجویز کردہ ایکسچینج ٹیمپلیٹ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            wa_exchange_template: syncWarrantyIntoTemplate(prev.wa_exchange_template, prev.warranty_terms)
                          }))
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 transition flex items-center gap-1 cursor-pointer"
                        title="Insert or update warranty terms in exchange template"
                      >
                        🛡️ + وارنٹی شرائط شامل کریں
                      </button>
                    </div>
                  </div>

                  <textarea aria-label="Phone Exchange Bill Template"
                    dir="auto"
                    rows={8}
                    value={form.wa_exchange_template}
                    onChange={e => setForm({ ...form, wa_exchange_template: e.target.value })}
                    className="w-full px-4 py-3 border border-purple-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-xs sm:text-sm font-sans h-56 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 leading-relaxed"
                    placeholder="Phone Exchange Bill Template..."
                  />

                  {/* Tag Inserters */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 mr-1">
                      ٹیگز شامل کریں (Insert Tags):
                    </span>
                    {[
                      { tag: '[Name]', desc: 'Customer Name' },
                      { tag: '[Shop Name]', desc: 'Shop Name' },
                      { tag: '[Exchange ID]', desc: 'Exchange bill number (e.g. EXC-12)' },
                      { tag: '[Settlement Details]', desc: 'New phone, trade-in credit & who paid whom' },
                      { tag: '[Date]', desc: 'Date & Time' },
                      { tag: '[Outgoing Items]', desc: 'Purchased Phone(s) with IMEI & Price' },
                      { tag: '[Incoming Phones]', desc: 'Traded-in Phone(s) with IMEI & Credit' },
                      { tag: '[Sale Total]', desc: 'Total Price of Purchased Items' },
                      { tag: '[Trade-in Total]', desc: 'Total Value of Old Phones' },
                      { tag: '[Net Difference]', desc: 'Difference Payable/Receivable' },
                      { tag: '[Paid]', desc: 'Settlement Amount Paid' },
                      { tag: '[Balance]', desc: 'Amount still due on this exchange' },
                      { tag: '[Invoice Link]', desc: 'Online Invoice & PDF Link' },
                      { tag: '[Warranty Terms]', desc: 'Warranty Terms' },
                      { tag: '[Shop Address]', desc: 'Shop Address' },
                      { tag: '[Shop Phone]', desc: 'Shop Contact Phone' }
                    ].map(({ tag, desc }) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            wa_exchange_template: (prev.wa_exchange_template || '') + ' ' + tag
                          }))
                        }}
                        className="px-2 py-0.5 text-xs font-mono bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-purple-400 text-gray-700 dark:text-gray-300 rounded cursor-pointer transition shadow-xs"
                        title={desc}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between items-center text-xs text-purple-800 dark:text-purple-300 pt-1">
                    <span>💡 ایکسچینج ٹرانزیکشن پر کسٹمر کو یہ فارمیٹ واٹس ایپ پر اور آؤٹ باکس میں بھیجا جائے گا۔</span>
                    <span className="font-mono text-xs opacity-75">{form.wa_exchange_template?.length || 0} characters</span>
                  </div>
                </div>

                {/* Debt Reminder Template */}
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                    💬 Customer Debt Reminder Template (کھاتہ بقایا جات یاد دہانی)
                  </label>
                  <textarea aria-label=" Customer Debt Reminder Template (کھاتہ بقایا جات یاد دہانی)"
                    dir="auto"
                    rows={3}
                    value={form.wa_reminder_template}
                    onChange={e => setForm({ ...form, wa_reminder_template: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Hello [Name], your outstanding balance is Rs. [Amount]..."
                  />
                  <p className="text-xs text-gray-500">
                    Used when you send a one-tap WhatsApp reminder from the customer ledger.
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save WhatsApp Settings'}
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════ 3. BILL PRINTING SECTION ══════════════ */}
            {activeTab === 'printing' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-6 shadow-xs">
                <div className="border-b border-gray-100 dark:border-slate-700 pb-4">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Printer className="text-blue-600" size={18} />
                    <span>Bill & Receipt Printing</span>
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Configure receipt paper size, checkout auto-print behavior, and visual invoice styles.
                  </p>
                </div>

                {/* Print Preferences */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Receipt Paper Format Size
                    </label>
                    <select aria-label=" Receipt Paper Format Size "
                      value={form.print_size}
                      onChange={e => setForm({ ...form, print_size: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="thermal">Thermal 80mm (Standard POS Roll)</option>
                      <option value="thermal_58">Thermal 58mm (Small Bluetooth Printer)</option>
                      <option value="a4">A4 Full Page (Standard Office Laser/Inkjet)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Print Dispatch Flow
                    </label>
                    <select aria-label=" Print Dispatch Flow "
                      value={form.print_mode}
                      onChange={e => setForm({ ...form, print_mode: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="manual">Manual (Prompt Checkout Dialog)</option>
                      <option value="auto">Auto (Print Directly on Complete Sale)</option>
                    </select>
                  </div>
                </div>

                {/* Visual Bill Templates Selection */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Receipt Design Layout Style</h3>
                      <p className="text-xs text-gray-500">Choose how printed customer invoices look.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { id: '1', name: 'Simple', desc: 'Minimal & clean. Fast printing without logo space.', icon: '📄' },
                      { id: '2', name: 'Classic', desc: 'Standard receipt with shop logo, dashed lines & table.', icon: '🧾' },
                      { id: '3', name: 'Professional', desc: 'Full corporate invoice look with PAID stamp & signatures.', icon: '📋' },
                      { id: '4', name: 'Modern', desc: 'Spacious sans-serif style with subtle dividers & totals cards.', icon: '✨' },
                    ].map(t => (
                      <div
                        key={t.id}
                        className={`flex flex-col justify-between p-4 rounded-xl border-2 transition ${
                          printTemplate === t.id
                            ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/40 ring-1 ring-blue-500/20 shadow-xs'
                            : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 bg-white dark:bg-slate-800'
                        }`}
                      >
                        <div>
                          <div className="text-2xl mb-1.5">{t.icon}</div>
                          <div className="font-bold text-sm text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                            <span>{t.name}</span>
                            {printTemplate === t.id && (
                              <span className="text-xs font-black bg-blue-600 text-white px-1.5 py-0.2 rounded-full uppercase">Active</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 leading-snug mb-3">{t.desc}</p>
                        </div>
                        
                        <div className="flex gap-1.5 mt-auto pt-2 border-t border-gray-100 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => {
                              const sid = user?.shop_id
                              setPrintTemplate(t.id)
                              if (sid) {
                                localStorage.setItem(`print_template_${sid}`, t.id)
                                let saved = {}
                                try { saved = JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}') } catch (_) {}
                                saved.print_template = t.id
                                localStorage.setItem(`shop_settings_${sid}`, JSON.stringify(saved))
                                if (navigator.onLine) {
                                  supabase.rpc('update_shop_settings', { p_shop_id: Number(sid), p_print_template: t.id })
                              .then(({ error }) => { if (error) console.warn('Could not save print template on server:', error.message || error) })
                                }
                              }
                            }}
                            className={`flex-1 text-center py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                              printTemplate === t.id
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200'
                            }`}
                          >
                            {printTemplate === t.id ? 'Selected' : 'Select'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTemplateId(t.id)
                              setPreviewSize(form.print_size || 'thermal')
                            }}
                            className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 px-2 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 hover:border-blue-400 cursor-pointer shadow-xs"
                            title="Preview Template"
                          >
                            <Eye size={12} />
                            <span>Preview</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Print Preferences'}
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════ 4. BANK ACCOUNTS & CASH DRAWER SECTION ══════════════ */}
            {activeTab === 'banking' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-700 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                      <Landmark className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-bold text-gray-800 dark:text-white text-base">Business Bank Accounts & Balances</h2>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        Manage shop settlement accounts, bank balances, and automatic purchase deductions.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBankModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer self-start sm:self-auto"
                  >
                    <Plus className="w-4 h-4" /> Add Bank Account
                  </button>
                </div>

                {loadingBanks ? (
                  <div className="text-center py-8 text-gray-500 text-xs">Loading bank accounts...</div>
                ) : bankAccounts.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl p-6">
                    <Landmark className="w-10 h-10 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No bank accounts added yet</p>
                    <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                      Add your physical Cash Drawer or commercial bank accounts to track payments accurately.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowBankModal(true)}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      <Plus className="w-4 h-4" /> Add First Account
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {bankAccounts.map((acc) => {
                      const isCashInHand = isCashName(acc.account_name) || acc.bank_name?.toLowerCase().includes('drawer')
                      return (
                        <div
                          key={acc.id}
                          className={`p-4 rounded-xl border transition relative flex flex-col justify-between ${
                            acc.is_default
                              ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-400/30'
                              : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <span className="font-bold text-sm text-gray-900 dark:text-white block leading-tight">
                                  {acc.account_name}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                                  {acc.bank_name}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isCashInHand && (
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                                    💵 Cash
                                  </span>
                                )}
                                {acc.is_default && (
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                                    Default
                                  </span>
                                )}
                              </div>
                            </div>

                            {acc.account_number && (
                              <p className="text-xs font-mono text-gray-500 dark:text-slate-400 mb-3">
                                #{acc.account_number}
                              </p>
                            )}
                          </div>

                          <div className="pt-2 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
                            <span className="text-xs font-bold uppercase text-gray-500">Balance:</span>
                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                              Rs. {Number(acc.current_balance || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════ 5. THEME & POS LAYOUT SECTION ══════════════ */}
            {activeTab === 'appearance' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-6 shadow-xs">
                <div className="border-b border-gray-100 dark:border-slate-700 pb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Palette className="text-purple-600" size={18} />
                      <span>Theme & POS Screen Layout</span>
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      Switch mobile OS design aesthetics, dark mode, and register checkout layout.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-bold bg-gray-50 dark:bg-slate-900 hover:bg-gray-100 text-gray-700 dark:text-gray-200 flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <span>{isDark ? '🌙 Dark Mode' : '☀️ Light Mode'}</span>
                  </button>
                </div>

                {/* Mobile OS Theme System */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-blue-600" />
                    <h3 className="text-xs sm:text-sm font-black text-gray-800 dark:text-gray-100 uppercase tracking-wider">
                      Mobile OS Theme & System Aesthetics
                    </h3>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                    Switch design language between premier smartphone systems (Apple Clean, Apple Glass, Google Pixel, OnePlus OxygenOS, Samsung One UI).
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 pt-1">
                    {THEME_STYLES.map(theme => {
                      const isSelected = themeStyle === theme.id
                      return (
                        <div
                          key={theme.id}
                          onClick={() => setThemeStyle(theme.id)}
                          className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-black text-sm text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                                <span>{theme.icon}</span>
                                <span>{theme.name}</span>
                              </span>
                              {isSelected && <span className="text-xs text-blue-600 dark:text-blue-400 font-black">✓ Active</span>}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{theme.description}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-800">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{theme.category}</span>
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white shadow-xs"
                              style={{ backgroundColor: theme.accentColor }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* POS Layout Preference */}
                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 space-y-3">
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-gray-800 dark:text-gray-100 uppercase tracking-wider">
                      POS Screen Checkout Layout
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      Choose how product cart and tender controls appear on your billing register screen.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div
                      onClick={() => setForm(prev => ({ ...prev, pos_layout: 'two_stage' }))}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        (form.pos_layout || 'two_stage') === 'two_stage'
                          ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-black text-sm text-gray-800 dark:text-gray-100">⚡ Two-Stage Flow</span>
                          {(form.pos_layout || 'two_stage') === 'two_stage' && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-black">✓ Active</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                          Maximum cart item visibility (~15 items). "Charge (F4)" opens full tender sheet with note chips and digital wallets.
                        </p>
                      </div>
                    </div>

                    <div
                      onClick={() => setForm(prev => ({ ...prev, pos_layout: 'bottom_dock' }))}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        form.pos_layout === 'bottom_dock'
                          ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-black text-sm text-gray-800 dark:text-gray-100">🖥️ Global Bottom Dock</span>
                          {form.pos_layout === 'bottom_dock' && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-black">✓ Active</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                          Supermarket style: quick cash notes and tender controls span horizontally across screen bottom.
                        </p>
                      </div>
                    </div>

                    <div
                      onClick={() => setForm(prev => ({ ...prev, pos_layout: 'compact_dock' }))}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                        form.pos_layout === 'compact_dock'
                          ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                          : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-black text-sm text-gray-800 dark:text-gray-100">📱 Compact Sidebar</span>
                          {form.pos_layout === 'compact_dock' && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-black">✓ Active</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                          All-in-one sidebar: all quick cash chips and payment inputs stay inside right sidebar beneath cart.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-slate-700 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Appearance Preferences'}
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════ 6. DATA, BACKUPS & SYSTEM MAINTENANCE SECTION ══════════════ */}
            {activeTab === 'system' && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 sm:p-6 space-y-6 shadow-xs">
                <div className="border-b border-gray-100 dark:border-slate-700 pb-4">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Database className="text-indigo-600" size={18} />
                    <span>Data Management, Backups & Maintenance</span>
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Full database exports, Excel reports, offline sync recovery, cache flushing, and subscription.
                  </p>
                </div>

                {/* Offline Sync Attention Banner */}
                {syncDeadLetters.length > 0 && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                      <div>
                        <h3 className="font-bold text-amber-950 dark:text-amber-200 text-sm">Offline changes need attention</h3>
                        <p className="text-xs text-amber-900 dark:text-amber-300 mt-0.5">
                          {syncDeadLetters.length} change{syncDeadLetters.length === 1 ? '' : 's'} could not sync automatically. Export the details before retrying so you have a recovery copy.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(syncDeadLetters, null, 2)], { type: 'application/json' })
                          const url = URL.createObjectURL(blob)
                          const link = document.createElement('a')
                          link.href = url
                          link.download = `EdgeXPOS_SyncRecovery_${new Date().toISOString().slice(0, 10)}.json`
                          link.click()
                          URL.revokeObjectURL(url)
                        }}
                        className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-50 cursor-pointer"
                      >
                        Export recovery copy
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!await confirmDialog(`Retry ${syncDeadLetters.length} failed changes for this shop?`)) return
                          for (const entry of syncDeadLetters) {
                            await db.sync_queue.add({ table: entry.table, action: entry.action, data: entry.data, timestamp: new Date().toISOString(), retry_count: 0 })
                            await db.sync_dead_letter.delete(entry.id)
                          }
                          await syncOfflineData()
                          await loadSyncDeadLetters()
                        }}
                        className="rounded-lg bg-amber-700 hover:bg-amber-800 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                      >
                        Retry changes
                      </button>
                    </div>
                  </div>
                )}

                {/* Offline Actions Toolbar */}
                <div className="p-4 bg-gray-50 dark:bg-slate-900/60 rounded-xl border border-gray-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">Offline Cache & Storage</h3>
                    <p className="text-xs text-gray-500">Sync all store data to browser storage or clear cached records.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasFeature('offline_sync') && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!navigator.onLine) {
                            notify('You are offline. Connect to the internet first.')
                            return
                          }
                          setSaving(true)
                          try {
                            const shopEq = 'shop_id'
                            const [p, c, cu, su, sa, pu, ex, us] = await Promise.all([
                              supabase.from('products').select('*').eq(shopEq, user.shop_id),
                              supabase.from('categories').select('*').eq(shopEq, user.shop_id),
                              supabase.from('customers').select('*').eq(shopEq, user.shop_id),
                              supabase.from('suppliers').select('*').eq(shopEq, user.shop_id),
                              supabase.from('sales').select('*').eq(shopEq, user.shop_id),
                              supabase.from('purchases').select('*').eq(shopEq, user.shop_id),
                              supabase.from('expenses').select('*').eq(shopEq, user.shop_id),
                              supabase.from('users').select('*').eq(shopEq, user.shop_id)
                            ])

                            const safePut = async (table, reqData) => {
                              if (reqData && reqData.length > 0) {
                                await db[table].clear()
                                await db[table].bulkPut(JSON.parse(JSON.stringify(reqData)))
                              }
                            }

                            await safePut('products', p.data)
                            await safePut('categories', c.data)
                            await safePut('customers', cu.data)
                            await safePut('suppliers', su.data)
                            await safePut('sales', sa.data)
                            await safePut('purchases', pu.data)
                            await safePut('expenses', ex.data)
                            await safePut('users', us.data)

                            notify('All online data is now saved on this device.', 'success')
                          } catch (e) {
                            notify('Sync failed: ' + e.message)
                          } finally {
                            setSaving(false)
                          }
                        }}
                        disabled={saving}
                        className="px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        {saving ? '⏳ Downloading...' : '⬇️ Download Offline Data'}
                      </button>
                    )}

                    {hasFeature('offline_sync') && (
                      <button
                        type="button"
                        onClick={async () => {
                          await syncOfflineData()
                          notify('Sync process triggered! Check status in header.')
                          fetchShop()
                        }}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition cursor-pointer"
                      >
                        🔄 Sync Now
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirmDialog('Clear the data saved on this device?\nIt is downloaded again from the cloud. Changes waiting to sync are kept.', { confirmLabel: 'Clear saved data' })) {
                          await db.products.clear()
                          await db.categories.clear()
                          await db.customers.clear()
                          await db.suppliers.clear()
                          await db.sales.clear()
                          await db.sale_items.clear()
                          await db.purchases.clear()
                          await db.purchase_items.clear()
                          await db.expenses.clear()
                          await db.users.clear()
                          notify('Saved data cleared. Refresh the page.', 'success')
                        }
                      }}
                      className="px-3 py-1.5 border border-gray-200 hover:bg-gray-100 text-gray-700 dark:text-gray-200 dark:border-slate-700 rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      🧹 Clear Cache
                    </button>
                  </div>
                </div>

                {/* Backups & Excel Exports */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {hasFeature('data_export') ? (
                    <div className="p-4 bg-green-50/50 dark:bg-green-950/20 rounded-2xl border border-green-100 dark:border-green-900/40 flex flex-col justify-between gap-3">
                      <div>
                        <p className="font-bold text-green-800 dark:text-green-300 text-sm">Full System Backup</p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Save a complete JSON snapshot of all products, customers, suppliers and ledger accounts.</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const data = {
                                products: await db.products.toArray(),
                                categories: await db.categories.toArray(),
                                brands: await db.brands.toArray(),
                                customers: await db.customers.toArray(),
                                suppliers: await db.suppliers.toArray(),
                                sales: await db.sales.toArray(),
                                sale_items: await db.sale_items.toArray(),
                                purchases: await db.purchases.toArray(),
                                purchase_items: await db.purchase_items.toArray(),
                                expenses: await db.expenses.toArray(),
                                users: await db.users.toArray(),
                                exported_at: new Date().toISOString(),
                                shop_id: user.shop_id,
                                version: '3.0'
                              }
                              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `EdgeXPOS_FullBackup_${new Date().toISOString().slice(0, 10)}.json`
                              document.body.appendChild(a)
                              a.click()
                              document.body.removeChild(a)
                              URL.revokeObjectURL(url)
                              notify('Backup downloaded. Keep this file somewhere safe.', 'success')
                            } catch (err) {
                              notify('Backup failed: ' + err.message)
                            }
                          }}
                          className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-bold text-xs shadow-xs cursor-pointer"
                        >
                          📥 Download Full Backup (.json)
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const data = {
                                Products: await db.products.toArray(),
                                Customers: await db.customers.toArray(),
                                Suppliers: await db.suppliers.toArray(),
                                Sales: await db.sales.toArray(),
                                SaleItems: await db.sale_items.toArray(),
                                Purchases: await db.purchases.toArray(),
                                Expenses: await db.expenses.toArray()
                              }
                              const workbook = XLSX.utils.book_new()
                              for (const [sheetName, rows] of Object.entries(data)) {
                                if (rows.length > 0) {
                                  const worksheet = XLSX.utils.json_to_sheet(rows)
                                  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
                                } else {
                                  const worksheet = XLSX.utils.json_to_sheet([{ Message: 'No data exists' }])
                                  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
                                }
                              }
                              const fileName = `EdgeXPOS_ExcelReports_${new Date().toISOString().slice(0, 10)}.xlsx`
                              XLSX.writeFile(workbook, fileName)
                              notify('Excel reports generated and downloaded successfully! 📊')
                            } catch (err) {
                              notify('Excel Export failed: ' + err.message)
                            }
                          }}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-bold text-xs shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <FileSpreadsheet size={14} />
                          <span>Export to Excel (.xlsx)</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 flex flex-col justify-between gap-3 opacity-60">
                      <div>
                        <p className="font-bold text-gray-600 dark:text-gray-300 text-sm">Export All Data 🔒</p>
                        <p className="text-xs text-gray-500 mt-0.5">Upgrade your subscription plan to enable automatic backups and Excel report export.</p>
                      </div>
                    </div>
                  )}

                  {/* Restore from JSON backup */}
                  <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl border border-blue-100 dark:border-blue-900/40 flex flex-col justify-between gap-3">
                    <div>
                      <p className="font-bold text-blue-800 dark:text-blue-300 text-sm">Import / Restore Data</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Restore your database from an existing .json backup file.</p>
                    </div>
                    <div>
                      <input
                        type="file"
                        accept=".json"
                        id="import-backup-file"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files[0]
                          if (!file) return
                          if (!await confirmDialog('Restore this backup?\nThe data saved on this device now is replaced by the backup.', { confirmLabel: 'Restore backup', danger: true })) return
                          const reader = new FileReader()
                          reader.onload = async (event) => {
                            try {
                              const data = JSON.parse(event.target.result)
                              if (!data.products || !data.customers) {
                                throw new Error('Invalid backup file format.')
                              }
                              await db.transaction('rw',
                                db.products, db.categories, db.brands, db.customers, db.suppliers,
                                db.sales, db.sale_items, db.purchases, db.purchase_items,
                                db.expenses, db.users, async () => {
                                  await db.products.clear()
                                  await db.categories.clear()
                                  await db.brands.clear()
                                  await db.customers.clear()
                                  await db.suppliers.clear()
                                  await db.sales.clear()
                                  await db.sale_items.clear()
                                  await db.purchases.clear()
                                  await db.purchase_items.clear()
                                  await db.expenses.clear()
                                  await db.users.clear()
                                  if (data.products?.length) await db.products.bulkAdd(data.products)
                                  if (data.categories?.length) await db.categories.bulkAdd(data.categories)
                                  if (data.brands?.length) await db.brands.bulkAdd(data.brands)
                                  if (data.customers?.length) await db.customers.bulkAdd(data.customers)
                                  if (data.suppliers?.length) await db.suppliers.bulkAdd(data.suppliers)
                                  if (data.sales?.length) await db.sales.bulkAdd(data.sales)
                                  if (data.sale_items?.length) await db.sale_items.bulkAdd(data.sale_items)
                                  if (data.purchases?.length) await db.purchases.bulkAdd(data.purchases)
                                  if (data.purchase_items?.length) await db.purchase_items.bulkAdd(data.purchase_items)
                                  if (data.expenses?.length) await db.expenses.bulkAdd(data.expenses)
                                  if (data.users?.length) await db.users.bulkAdd(data.users)
                                })
                              alert('Backup restored. The page will now refresh.')
                              window.location.reload()
                            } catch (err) {
                              notify('Import failed: ' + err.message)
                            }
                          }
                          reader.readAsText(file)
                        }}
                      />
                      <label
                        htmlFor="import-backup-file"
                        className="flex items-center justify-center w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-bold text-xs cursor-pointer shadow-xs"
                      >
                        📤 Upload & Restore Backup
                      </label>
                    </div>
                  </div>
                </div>

                {/* Force Refresh & Clear App Cache */}
                <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-amber-900 dark:text-amber-200 text-sm">Force Refresh & Clear App Cache</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">If your browser is stuck on an older version or service worker precache error, click here to flush cache and reload.</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if ('caches' in window) {
                        try {
                          const keys = await caches.keys()
                          await Promise.all(keys.map(k => caches.delete(k)))
                        } catch (_) {}
                      }
                      if ('serviceWorker' in navigator) {
                        try {
                          const regs = await navigator.serviceWorker.getRegistrations()
                          await Promise.all(regs.map(r => r.unregister()))
                        } catch (_) {}
                      }
                      window.location.reload()
                    }}
                    className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-xl shadow-xs transition cursor-pointer"
                  >
                    🔄 Clear Cache & Reload
                  </button>
                </div>

                {/* Plan & Subscription */}
                {planInfo && (
                  <div className="rounded-2xl border border-blue-200 dark:border-blue-900/50 p-4 bg-blue-50/40 dark:bg-blue-950/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-blue-900 dark:text-blue-200 uppercase tracking-wider">
                        Active Subscription Tier
                      </span>
                      <span className="text-xs font-mono font-bold text-blue-700 dark:text-blue-300">
                        {planInfo.plan_name}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-xs text-gray-500 block uppercase">Product Limit:</span>
                        <span className="font-bold text-gray-800 dark:text-gray-200">{planInfo.product_limit} items</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 block uppercase">Users Limit:</span>
                        <span className="font-bold text-gray-800 dark:text-gray-200">{planInfo.user_limit} accounts</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 block uppercase">Next Renewal:</span>
                        <span className="font-bold text-gray-800 dark:text-gray-200 font-mono">
                          {planInfo.next_billing_date ? new Date(planInfo.next_billing_date).toLocaleDateString('en-PK') : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Danger Zone */}
                <div className="bg-red-50 dark:bg-red-950/30 rounded-2xl border-2 border-red-200 dark:border-red-900/40 p-5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded-lg flex items-center justify-center font-bold text-base shrink-0">
                      ⚠️
                    </div>
                    <div>
                      <h3 className="font-bold text-red-800 dark:text-red-200 text-sm">Danger Zone</h3>
                      <p className="text-xs text-red-600 dark:text-red-400">Irreversible actions — proceed with extreme caution</p>
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-red-100 dark:border-red-900/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-gray-800 dark:text-gray-100 text-xs sm:text-sm">🗑️ Clear All Shop Data</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        Permanently delete ALL products, sales, customers, suppliers and ledger entries for this shop.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPasswordModal(true)}
                      disabled={clearing}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition shadow-sm whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {clearing ? 'Clearing...' : '🔥 Clear All Data'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </form>
        </main>
      </div>

      {/* Password Confirmation Modal for Data Wipe */}
      {showPasswordModal && (
        <PasswordModal
          title="⚠️ Clear ALL Shop Data"
          message="This will permanently delete ALL data. Enter your password to confirm."
          onConfirm={async () => {
            setShowPasswordModal(false)
            const shopName = form.name || 'My Shop'
            const typed = prompt(`Type "${shopName}" to confirm permanent deletion of ALL data:`)
            if (typed !== shopName) {
              notify('Shop name does not match. Operation cancelled.')
              return
            }
            setClearing(true)
            try {
              if (navigator.onLine) {
                const { data: shopSales } = await supabase.from('sales').select('id').eq('shop_id', user.shop_id)
                const saleIds = (shopSales || []).map(s => s.id)
                if (saleIds.length) await supabase.from('sale_items').delete().in('sale_id', saleIds)

                const { data: shopPurchases } = await supabase.from('purchases').select('id').eq('shop_id', user.shop_id)
                const purchaseIds = (shopPurchases || []).map(p => p.id)
                if (purchaseIds.length) await supabase.from('purchase_items').delete().in('purchase_id', purchaseIds)

                const shopIdTables = ['products', 'categories', 'brands', 'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'customer_payments', 'supplier_payments', 'audit_logs']
                for (const t of shopIdTables) {
                  await supabase.from(t).delete().eq('shop_id', user.shop_id)
                }
              }
              const allTables = ['products', 'categories', 'brands', 'customers', 'suppliers', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'customer_payments', 'supplier_payments', 'audit_logs']
              for (const t of allTables) {
                if (db[t]) await db[t].clear()
              }
              await db.trash.clear()
              await db.sync_queue.clear()
              alert('✅ All shop data has been cleared successfully!')
              window.location.reload()
            } catch (err) {
              notify('Error clearing data: ' + err.message)
            } finally {
              setClearing(false)
            }
          }}
          onCancel={() => setShowPasswordModal(false)}
        />
      )}

      {/* Billing Template Quick View Modal */}
      {previewTemplateId && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-lg flex items-center gap-2">
                  <span>✨</span> Quick View Template Preview
                </h3>
                <p className="text-xs text-slate-500">See exactly how your customer receipt will print.</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTemplateId(null)}
                className="text-slate-500 hover:text-white transition text-xl p-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
              <div className="w-full md:w-80 bg-slate-50 border-r border-slate-100 p-6 flex flex-col justify-between overflow-y-auto">
                <div className="space-y-6">
                  <div>
                    <span className="text-xs uppercase font-black tracking-wider text-slate-500 block mb-2">Select Format Size</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewSize('thermal')}
                        className={`py-2.5 px-3 rounded-xl font-bold text-xs border-2 transition cursor-pointer ${
                          previewSize === 'thermal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        📟 Thermal (80mm)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewSize('a4')}
                        className={`py-2.5 px-3 rounded-xl font-bold text-xs border-2 transition cursor-pointer ${
                          previewSize === 'a4' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        📄 A4 Page
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200/60 p-4 shadow-xs">
                    <h4 className="font-extrabold text-slate-800 text-sm mb-2">Template Specs</h4>
                    <ul className="text-xs text-slate-500 space-y-2">
                      <li className="flex justify-between"><span className="text-slate-500">Option:</span> <span className="font-semibold text-slate-700">{previewTemplateId === '1' ? 'Simple' : previewTemplateId === '2' ? 'Classic' : previewTemplateId === '3' ? 'Professional' : 'Modern'}</span></li>
                      <li className="flex justify-between"><span className="text-slate-500">Paper Width:</span> <span className="font-semibold text-slate-700">{previewSize === 'thermal' ? '80mm (Thermal)' : '210mm (A4)'}</span></li>
                    </ul>
                  </div>

                  <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100/50 text-xs text-blue-700 leading-relaxed">
                    💡 <strong>Tip:</strong> The printed layout adjusts dynamically according to your printer paper size.
                  </div>
                </div>

                <div className="mt-8 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      const sid = user?.shop_id
                      setPrintTemplate(previewTemplateId)
                      if (sid) {
                        localStorage.setItem(`print_template_${sid}`, previewTemplateId)
                        let saved = {}
                        try { saved = JSON.parse(localStorage.getItem(`shop_settings_${sid}`) || '{}') } catch (_) {}
                        saved.print_template = previewTemplateId
                        localStorage.setItem(`shop_settings_${sid}`, JSON.stringify(saved))
                        if (navigator.onLine) {
                          supabase.rpc('update_shop_settings', { p_shop_id: Number(sid), p_print_template: previewTemplateId })
                  .then(({ error }) => { if (error) console.warn('Could not save print template on server:', error.message || error) })
                        }
                      }
                      setPreviewTemplateId(null)
                      notify('Template applied successfully! ✅')
                    }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>✓</span> Apply This Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTemplateId(null)}
                    className="w-full py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-slate-200 p-6 flex items-center justify-center overflow-y-auto">
                <div 
                  className="bg-white shadow-2xl transition-all duration-300 overflow-hidden border border-slate-300 rounded"
                  style={{
                    width: previewSize === 'thermal' ? '320px' : '650px',
                    height: previewSize === 'thermal' ? '500px' : '750px',
                    maxHeight: '100%'
                  }}
                >
                  <iframe
                    srcDoc={getPreviewHTML(previewTemplateId, previewSize)}
                    className="w-full h-full border-none bg-white"
                    title="Invoice Template Preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank Account Modal */}
      {showBankModal && (
        <BankAccountModal
          isOpen={showBankModal}
          onClose={() => setShowBankModal(false)}
          shopId={user?.shop_id}
          onSuccess={(newAcc) => {
            setBankAccounts(prev => [newAcc, ...prev])
          }}
        />
      )}
    </div>
  )
}

export default Settings