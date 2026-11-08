import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import {
  Download,
  Printer,
  RefreshCw,
  ExternalLink
} from 'lucide-react'

// Action-time dynamic loading for PDF libraries
async function loadPdfLibraries() {
  const [jspdfMod, html2canvasMod, autotableMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
    import('jspdf-autotable')
  ])
  const jsPDF = jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default
  const html2canvas = html2canvasMod.default || html2canvasMod
  const autoTable = autotableMod.default || autotableMod.autoTable || autotableMod
  return { jsPDF, html2canvas, autoTable }
}

export default function PublicInvoice() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const invoiceRef = useRef(null)
  const warrantyRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    async function fetchInvoice() {
      if (!id) {
        setError('Invoice reference missing')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const cleanId = id.replace(/^(INV-|EXC-)/i, '').trim().toUpperCase()
        const candidateNumbers = [id, cleanId, `INV-${cleanId}`, `EXC-${cleanId}`]

        // 1. Direct Supabase REST lookup for sales by invoice_number
        // (Bypasses any potential RPC cache/subtotal column discrepancies)
        try {
          const { data: directSale } = await supabase
            .from('sales')
            .select('*, sale_items(*)')
            .in('invoice_number', candidateNumbers)
            .maybeSingle()

          if (directSale && isMounted) {
            let shopInfo = {}
            if (directSale.shop_id) {
              try {
                const { data: sData } = await supabase.from('shops').select('*').eq('id', directSale.shop_id).maybeSingle()
                if (sData) shopInfo = sData
              } catch (_) {}
            }

            let custInfo = {}
            if (directSale.customer_id) {
              try {
                const { data: cData } = await supabase.from('customers').select('*').eq('id', directSale.customer_id).maybeSingle()
                if (cData) custInfo = cData
              } catch (_) {}
            }

            const localShopSettings = (() => {
              try {
                return JSON.parse(localStorage.getItem(`shop_settings_${directSale.shop_id}`) || '{}')
              } catch (_) {
                return {}
              }
            })()

            const effectiveShopName = shopInfo.name || localShopSettings.name || localStorage.getItem(`shop_name_${directSale.shop_id}`) || 'EdgeX Mobile Store'
            const effectiveShopPhone = shopInfo.phone || localShopSettings.phone || ''
            const effectiveShopAddress = shopInfo.address || localShopSettings.address || ''
            const effectiveShopLogo = shopInfo.logo_url || localShopSettings.logo_url || localStorage.getItem(`shop_logo_${directSale.shop_id}`) || ''
            const effectiveWarranty = shopInfo.warranty_terms || localShopSettings.warranty_terms || ''

            const effectiveCustName = directSale.customer_name || custInfo.name || 'Valued Customer'
            const effectiveCustPhone = directSale.customer_phone || custInfo.phone || ''

            const actualInvoiceNo = directSale.id ? `INV-${directSale.id}` : (directSale.invoice_number || id)
            const formatted = {
              type: 'sale',
              id: directSale.id,
              actual_invoice_no: actualInvoiceNo,
              invoice_no: actualInvoiceNo,
              token: directSale.invoice_number || id,
              reference_id: directSale.invoice_number || id,
              created_at: directSale.created_at || new Date().toISOString(),
              subtotal: directSale.total_amount || directSale.net_amount || 0,
              discount: directSale.discount || 0,
              total: directSale.net_amount || directSale.total_amount || 0,
              net_amount: directSale.net_amount || directSale.total_amount || 0,
              total_amount: directSale.total_amount || directSale.net_amount || 0,
              paid_amount: directSale.paid_amount ?? directSale.amount_paid ?? directSale.net_amount,
              payment_type: directSale.payment_type || directSale.payment_method || 'cash',
              customer_name: effectiveCustName,
              customer_phone: effectiveCustPhone,
              status: directSale.status || 'completed',
              shop: {
                name: effectiveShopName,
                phone: effectiveShopPhone,
                address: effectiveShopAddress,
                logo_url: effectiveShopLogo,
                warranty_terms: effectiveWarranty
              },
              items: (directSale.sale_items || []).map(si => {
                let snap = {}
                if (typeof si.imei_snapshot === 'object' && si.imei_snapshot !== null) {
                  snap = si.imei_snapshot
                } else if (typeof si.imei_snapshot === 'string') {
                  try { snap = JSON.parse(si.imei_snapshot) } catch (_) {}
                }
                const imei1 = si.imei_1 || snap.imei_1 || si.imei || ''
                const imei2 = si.imei_2 || snap.imei_2 || ''
                const rawName = si.product_name || `${snap.brand || ''} ${snap.model || 'Phone'}`.trim()
                const hasImeiInName = Boolean(imei1 && rawName.includes(imei1))
                const fullName = !hasImeiInName && imei1 ? (imei2 ? `${rawName} [IMEI: ${imei1} / ${imei2}]` : `${rawName} [IMEI: ${imei1}]`) : rawName

                return {
                  id: si.id,
                  name: fullName,
                  brand: snap.brand || '',
                  model: snap.model || '',
                  storage: snap.storage || '',
                  color: snap.color || '',
                  condition: snap.condition || '',
                  pta_status: snap.pta_status || '',
                  imei_1: imei1,
                  imei_2: imei2,
                  quantity: si.quantity || 1,
                  unit_price: si.unit_price || si.price || 0,
                  total: si.total_price || si.line_total || si.subtotal || ((si.quantity || 1) * (si.unit_price || si.price || 0))
                }
              })
            }

            setInvoice(formatted)
            setLoading(false)
            return
          }
        } catch (saleLookupErr) {
          console.debug('Direct sale lookup error:', saleLookupErr)
        }

        // 2. Direct Supabase REST lookup for phone exchanges
        try {
          const { data: directExchange } = await supabase
            .from('exchanges')
            .select('*, exchange_items(*)')
            .in('exchange_number', candidateNumbers)
            .maybeSingle()

          if (directExchange && isMounted) {
            let shopInfo = {}
            if (directExchange.shop_id) {
              try {
                const { data: sData } = await supabase.from('shops').select('*').eq('id', directExchange.shop_id).maybeSingle()
                if (sData) shopInfo = sData
              } catch (_) {}
            }
            let custInfo = {}
            if (directExchange.customer_id) {
              try {
                const { data: cData } = await supabase.from('customers').select('*').eq('id', directExchange.customer_id).maybeSingle()
                if (cData) custInfo = cData
              } catch (_) {}
            }

            const localShopSettings = (() => {
              try {
                return JSON.parse(localStorage.getItem(`shop_settings_${directExchange.shop_id}`) || '{}')
              } catch (_) {
                return {}
              }
            })()

            const effectiveShopName = shopInfo.name || localShopSettings.name || localStorage.getItem(`shop_name_${directExchange.shop_id}`) || 'EdgeX Mobile Store'
            const effectiveShopPhone = shopInfo.phone || localShopSettings.phone || ''
            const effectiveShopAddress = shopInfo.address || localShopSettings.address || ''
            const effectiveShopLogo = shopInfo.logo_url || localShopSettings.logo_url || ''
            const effectiveWarranty = shopInfo.warranty_terms || localShopSettings.warranty_terms || ''

            const incoming = (directExchange.exchange_items || []).filter(i => i.item_direction === 'incoming_trade_in')
            const outgoing = (directExchange.exchange_items || []).filter(i => i.item_direction === 'outgoing_sale')

            const actualInvoiceNo = directExchange.id ? `EXC-${directExchange.id}` : (directExchange.exchange_number || id)
            const formatted = {
              type: 'exchange',
              id: directExchange.id,
              actual_invoice_no: actualInvoiceNo,
              invoice_no: actualInvoiceNo,
              token: directExchange.exchange_number || id,
              reference_id: directExchange.exchange_number || id,
              created_at: directExchange.created_at || new Date().toISOString(),
              sale_amount: directExchange.sale_amount || 0,
              trade_in_credit: directExchange.trade_in_credit || 0,
              settlement_amount: directExchange.settlement_amount || 0,
              settlement_direction: directExchange.settlement_direction,
              settlement_payment_method: directExchange.settlement_payment_method || 'Cash',
              settlement_paid_amount: directExchange.settlement_paid_amount || 0,
              paid_amount: directExchange.settlement_paid_amount || 0,
              customer_name: directExchange.customer_name || custInfo.name || 'Valued Customer',
              customer_phone: directExchange.customer_phone || custInfo.phone || '',
              status: directExchange.status || 'completed',
              shop: {
                name: effectiveShopName,
                phone: effectiveShopPhone,
                address: effectiveShopAddress,
                logo_url: effectiveShopLogo,
                warranty_terms: effectiveWarranty
              },
              incoming_items: incoming.map(i => ({
                product_name: i.product_name,
                imei_1: i.imei_1,
                storage: i.storage,
                color: i.color,
                condition: i.condition,
                pta_status: i.pta_status,
                assessed_value: i.assessed_value || i.subtotal || 0,
                battery_health: i.inspection_details?.battery_health
              })),
              outgoing_items: outgoing.map(i => ({
                product_name: i.product_name,
                imei_1: i.imei_1,
                storage: i.storage,
                color: i.color,
                condition: i.condition,
                pta_status: i.pta_status,
                subtotal: i.subtotal || i.assessed_value || 0
              }))
            }

            setInvoice(formatted)
            setLoading(false)
            return
          }
        } catch (exchangeLookupErr) {
          console.debug('Direct exchange lookup error:', exchangeLookupErr)
        }

        // 3. Try public RPC function (SECURITY DEFINER)
        try {
          const { data, error: rpcErr } = await supabase.rpc('get_public_invoice', {
            p_reference: id
          })

          if (!rpcErr && data) {
            const enriched = { ...data }
            const actualInvoiceNo = enriched.id
              ? (enriched.type === 'exchange' ? `EXC-${enriched.id}` : `INV-${enriched.id}`)
              : (enriched.invoice_no || id)
            enriched.actual_invoice_no = actualInvoiceNo
            enriched.invoice_no = actualInvoiceNo
            try {
              // Check local db.customers by customer_id if phone or name is missing
              if (db?.customers && enriched.customer_id && (!enriched.customer_phone || enriched.customer_name === 'Valued Customer')) {
                const cust = await db.customers.get(Number(enriched.customer_id))
                if (cust) {
                  if (cust.name && (enriched.customer_name === 'Valued Customer' || !enriched.customer_name)) {
                    enriched.customer_name = cust.name
                  }
                  if (cust.phone && !enriched.customer_phone) {
                    enriched.customer_phone = cust.phone
                  }
                }
              }

              // Also check whatsapp_queue if customer is still Valued Customer or phone missing
              if (db?.whatsapp_queue && (!enriched.customer_phone || enriched.customer_name === 'Valued Customer')) {
                const qItems = await db.whatsapp_queue.toArray()
                const match = qItems.find(q =>
                  (q.reference_id && q.reference_id.toUpperCase().includes(cleanId)) ||
                  (q.reference_data && (
                    (q.reference_data.invoice_token && q.reference_data.invoice_token.toUpperCase() === cleanId) ||
                    (q.reference_data.invoice_number && q.reference_data.invoice_number.toUpperCase().includes(cleanId)) ||
                    (q.reference_data.sale_id && String(q.reference_data.sale_id) === String(enriched.id))
                  ))
                )
                if (match) {
                  if (match.recipient_name && (enriched.customer_name === 'Valued Customer' || !enriched.customer_name)) {
                    enriched.customer_name = match.recipient_name
                  }
                  if (match.recipient_phone && !enriched.customer_phone) {
                    enriched.customer_phone = match.recipient_phone
                  }
                }
              }
            } catch (enrichErr) {
              console.debug('Customer enrichment error:', enrichErr)
            }

            if (isMounted) {
              setInvoice(enriched)
              setLoading(false)
            }
            return
          }
        } catch (_) {}

        // 4. Fallback: Check Dexie local sales cache (if viewed on same device / offline)
        if (db?.sales) {
          try {
            const allSales = await db.sales.toArray()
            const localSale = allSales.find(s =>
              (s.invoice_token && s.invoice_token.toUpperCase() === cleanId) ||
              (s.invoice_number && s.invoice_number.toUpperCase().includes(cleanId)) ||
              (s.idempotency_key && s.idempotency_key.toUpperCase() === cleanId)
            )

            if (localSale && isMounted) {
              const shopSettings = (() => {
                try {
                  return JSON.parse(localStorage.getItem(`shop_settings_${localSale.shop_id}`) || '{}')
                } catch (_) {
                  return {}
                }
              })()

              const formattedNo = localSale.invoice_number || (localSale.invoice_token ? `INV-${localSale.invoice_token}` : (id.startsWith('INV-') ? id : `INV-${cleanId}`))
              const actualInvoiceNo = localSale.id ? `INV-${localSale.id}` : formattedNo
              const formatted = {
                type: 'sale',
                id: localSale.id,
                actual_invoice_no: actualInvoiceNo,
                invoice_no: actualInvoiceNo,
                token: formattedNo,
                reference_id: formattedNo,
                created_at: localSale.created_at || new Date().toISOString(),
                subtotal: localSale.total_amount || localSale.subtotal || localSale.net_amount || localSale.total || 0,
                discount: localSale.discount || 0,
                total: localSale.net_amount || localSale.total_amount || localSale.total || 0,
                net_amount: localSale.net_amount || localSale.total_amount || localSale.total || 0,
                total_amount: localSale.total_amount || localSale.subtotal || localSale.net_amount || localSale.total || 0,
                paid_amount: localSale.paid_amount ?? localSale.amount_paid ?? localSale.net_amount ?? localSale.total,
                payment_type: localSale.payment_type || localSale.payment_method || 'cash',
                customer_name: localSale.customer_name || 'Valued Customer',
                customer_phone: localSale.customer_phone || '',
                status: localSale.status || 'completed',
                shop: {
                  name: shopSettings.name || localStorage.getItem(`shop_name_${localSale.shop_id}`) || 'EdgeX Mobile Store',
                  phone: shopSettings.phone || '',
                  address: shopSettings.address || '',
                  logo_url: shopSettings.logo_url || localStorage.getItem(`shop_logo_${localSale.shop_id}`) || '',
                  warranty_terms: shopSettings.warranty_terms || ''
                },
                items: (localSale.sale_items || []).map(i => {
                  const snap = typeof i.imei_snapshot === 'object' && i.imei_snapshot !== null ? i.imei_snapshot : {}
                  const rawSnapStr = typeof i.imei_snapshot === 'string' ? i.imei_snapshot : ''
                  const imei1 = i.imei_1 || snap.imei_1 || i.imei || rawSnapStr || ''
                  const imei2 = i.imei_2 || snap.imei_2 || ''
                  const rawName = i.name || i.product_name || 'Item'
                  const hasImei = Boolean(imei1 && rawName.includes(imei1))
                  const fullName = !hasImei && imei1 ? (imei2 ? `${rawName} [IMEI: ${imei1} / ${imei2}]` : `${rawName} [IMEI: ${imei1}]`) : rawName

                  return {
                    name: fullName,
                    brand: i.brand || snap.brand || '',
                    model: i.model || snap.model || '',
                    storage: i.storage || snap.storage || '',
                    color: i.color || snap.color || '',
                    condition: i.condition || snap.condition || '',
                    pta_status: i.pta_status || snap.pta_status || '',
                    imei_1: imei1,
                    imei_2: imei2,
                    quantity: i.quantity || i.qty || 1,
                    unit_price: i.unit_price || i.custom_price || i.sale_price || 0,
                    total: (i.quantity || 1) * (i.unit_price || i.custom_price || 0)
                  }
                })
              }

              setInvoice(formatted)
              setLoading(false)
              return
            }
          } catch (e) {
            console.debug('Dexie sales lookup error:', e)
          }
        }

        // 5. Fallback: Check Dexie whatsapp_queue reference_data
        if (db?.whatsapp_queue) {
          try {
            const qItems = await db.whatsapp_queue.toArray()
            const match = qItems.find(q =>
              q.reference_id === id ||
              q.reference_id === cleanId ||
              (q.reference_data && (
                String(q.reference_data.invoice_number) === id ||
                String(q.reference_data.exchange_number) === id ||
                String(q.reference_data.exchange_id) === cleanId
              ))
            )

            if (match && isMounted) {
              const text = match.message_text || ''
              setInvoice({
                type: match.message_type?.includes('exchange') ? 'exchange' : 'sale',
                invoice_no: id,
                created_at: match.created_at || new Date().toISOString(),
                customer_name: match.recipient_name || 'Customer',
                customer_phone: match.recipient_phone || '',
                total: match.reference_data?.total || match.reference_data?.sale_amount || 0,
                paid_amount: match.reference_data?.paid || match.reference_data?.settlement_amount || 0,
                fallback_text: text,
                shop: {
                  name: localStorage.getItem(`shop_name_${match.shop_id}`) || 'EdgeX Mobile Store',
                  phone: '',
                  warranty_terms: ''
                }
              })
              setLoading(false)
              return
            }
          } catch (e) {
            console.debug('Dexie queue lookup error:', e)
          }
        }

        if (isMounted) {
          setError('Invoice not found or expired. Please verify that the link is correct.')
          setLoading(false)
        }
      } catch (err) {
        if (isMounted) {
          setError(err?.message || 'Error loading verified invoice.')
          setLoading(false)
        }
      }
    }

    fetchInvoice()
    return () => { isMounted = false }
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mb-4" />
        <h2 className="text-base font-bold text-slate-800 dark:text-slate-200">Loading verified digital invoice...</h2>
        <p className="text-xs text-slate-500 mt-1">Please wait a moment while the official receipt is loaded</p>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center text-3xl mb-4">
          ⚠️
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Invoice Not Found</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm whitespace-pre-line leading-relaxed mb-6">
          {error || 'The requested invoice reference could not be located or has expired.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
        >
          <RefreshCw size={14} />
          <span>Retry</span>
        </button>
      </div>
    )
  }

  const isExchange = invoice.type === 'exchange'
  const shop = invoice.shop || {}
  const dateFormatted = invoice.created_at
    ? new Date(invoice.created_at).toLocaleString('en-PK', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : ''

  // 1. Calculate sum from item lines as bulletproof fallback
  const itemsSum = (invoice.items || []).reduce((sum, item) => {
    const itemTotal = Number(
      item.total != null
        ? item.total
        : ((Number(item.quantity || 1) * Number(item.unit_price || 0)) || 0)
    ) || 0
    return sum + itemTotal
  }, 0)

  // 2. Financial components
  const discount = Number(invoice.discount || 0)
  const tradeCredit = Number(invoice.trade_in_credit || 0)

  // 3. Gross Total (Total Amount before discount & trade credit)
  const grossTotal = isExchange
    ? Number(invoice.sale_amount || itemsSum || 0)
    : Number(
        invoice.total_amount ||
        invoice.subtotal ||
        (itemsSum > 0 ? itemsSum : 0) ||
        invoice.net_amount ||
        invoice.total ||
        0
      )

  // 4. Net Total (Payable amount after discount / trade credit)
  let netTotal = 0
  if (isExchange) {
    netTotal = Math.max(0, grossTotal - tradeCredit)
  } else {
    const candidateNet = Number(invoice.net_amount || invoice.total || 0)
    if (candidateNet > 0) {
      netTotal = candidateNet
    } else if (grossTotal > 0) {
      netTotal = Math.max(0, grossTotal - discount)
    } else if (itemsSum > 0) {
      netTotal = Math.max(0, itemsSum - discount)
    }
  }

  // 5. Amount Paid & Balance Due
  const paidTotal = Number(
    invoice.paid_amount ??
    invoice.amount_paid ??
    invoice.settlement_paid_amount ??
    netTotal
  )
  const balanceDue = Math.max(0, netTotal - paidTotal)

  // Extract warranty terms and clean redundant subheader lines
  const rawWarranty = shop.warranty_terms || `⚠️ *وارنٹی شرائط (Warranty Terms):*
۱۔ LCD، فیس لاک اور کیمرے کی کوئی وارنٹی نہیں ہوگی۔
۲۔ موبائل ڈیڈ ہونے کی صورت میں کوئی وارنٹی یا واپسی قبول نہیں کی جائے گی۔
۳۔ سیکنڈ ہینڈ موبائل کی کوئی وارنٹی نہیں ہوگی۔`

  const warrantyText = rawWarranty
    .replace(/^⚠️?\s*\*?وارنٹی[\s\S]*?(?:\*|:|\))\s*\n+/i, '')
    .trim()

  // Actual sequential invoice number (e.g. INV-156 instead of random URL token INV-JNXKG8DN)
  const displayInvoiceNo = invoice.actual_invoice_no ||
    (invoice.id ? (isExchange ? `EXC-${invoice.id}` : `INV-${invoice.id}`) : (invoice.invoice_no || id))

  // Hybrid High-Precision PDF Exporter:
  // Vectorizes all English store data, customer metadata, item details + IMEI, and financial totals;
  // Flattens the Urdu Nastaleeq warranty card into a high-DPI image to eliminate mojibake and font clipping.
  // Directly saves the .pdf file without opening the browser print dialogue.
  const handleDownloadPDF = async () => {
    if (!invoice || downloadingPdf) return
    setDownloadingPdf(true)

    const filename = `Invoice_${displayInvoiceNo}.pdf`

    try {
      const { jsPDF, html2canvas, autoTable } = await loadPdfLibraries()

      // Ensure fonts are loaded before flattening warranty canvas
      try {
        if (document.fonts?.ready) {
          await document.fonts.ready
        }
      } catch (_) {}

      // 1. FLATTEN URDU WARRANTY CARD INTO A COMPACT HIGH-DPI IMAGE
      let warrantyImgData = null
      let warrantyImgRatio = 0.22

      // Strategy A: html2canvas on warrantyRef (captures the exact compact styled card)
      if (warrantyRef.current) {
        try {
          const canvas = await html2canvas(warrantyRef.current, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#fffdf5',
            logging: false
          })
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            warrantyImgData = canvas.toDataURL('image/png')
            warrantyImgRatio = canvas.height / canvas.width
          }
        } catch (canvasErr) {
          console.debug('html2canvas on warrantyRef failed, using direct canvas fallback:', canvasErr)
        }
      }

      // Strategy B: Pure HTML5 Canvas 2D fallback for Urdu Nastaleeq (Small compact typography)
      if (!warrantyImgData) {
        try {
          const canvas = document.createElement('canvas')
          const width = 1100
          const lines = warrantyText.split('\n').filter(Boolean)
          const lineHeight = 28
          const height = 65 + (lines.length * lineHeight) + 35
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#fffdf5'
            ctx.fillRect(0, 0, width, height)
            ctx.strokeStyle = '#fcd34d'
            ctx.lineWidth = 3
            ctx.strokeRect(3, 3, width - 6, height - 6)

            ctx.fillStyle = '#451a03'
            ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif'
            ctx.fillText('Official Warranty Terms  (دکان کی وارنٹی شرائط)', 24, 32)

            ctx.fillStyle = '#92400e'
            ctx.font = 'bold 13px monospace'
            ctx.fillText('WARRANTY', width - 110, 32)

            ctx.strokeStyle = '#fde68a'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(24, 46)
            ctx.lineTo(width - 24, 46)
            ctx.stroke()

            ctx.fillStyle = '#1e293b'
            ctx.font = '16px "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", serif'
            ctx.textAlign = 'right'
            ctx.direction = 'rtl'

            let textY = 78
            for (const line of lines) {
              ctx.fillText(line.trim(), width - 26, textY)
              textY += lineHeight
            }

            ctx.beginPath()
            ctx.moveTo(24, textY + 6)
            ctx.lineTo(width - 24, textY + 6)
            ctx.stroke()

            textY += 28
            ctx.fillStyle = '#78350f'
            ctx.font = '15px "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", serif'
            ctx.fillText('آپ کے اعتماد اور تعاون کا بہت بہت شکریہ! 🤝', width - 26, textY)

            ctx.textAlign = 'left'
            ctx.direction = 'ltr'
            ctx.fillStyle = '#451a03'
            ctx.font = 'bold 15px sans-serif'
            ctx.fillText(shop.name || 'EdgeX Mobile Store', 26, textY)

            warrantyImgData = canvas.toDataURL('image/png')
            warrantyImgRatio = height / width
          }
        } catch (canvasErr2) {
          console.debug('Pure canvas fallback error:', canvasErr2)
        }
      }

      // 2. VECTORIZED PDF CREATION (Standard A4 Portrait matching online bill layout)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = 210
      const pageHeight = 297
      const margin = 14
      const contentWidth = pageWidth - (margin * 2) // 182mm

      // Header: Store Name
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(18)
      pdf.setTextColor(15, 23, 42)
      pdf.text(shop.name || 'EdgeX Mobile Store', margin, 20)

      // Address & Phone
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(71, 85, 105)
      let subY = 25
      if (shop.address) {
        pdf.text(shop.address, margin, subY)
        subY += 4
      }
      if (shop.phone) {
        pdf.text(`Phone: ${shop.phone}`, margin, subY)
        subY += 4
      }

      // Top Right: Badge & Invoice Details
      const badgeText = isExchange ? '✓ PHONE EXCHANGE INVOICE' : '✓ SALES INVOICE'
      pdf.setFillColor(236, 253, 245)
      pdf.setDrawColor(167, 243, 208)
      pdf.roundedRect(pageWidth - margin - 54, 13, 54, 7.5, 2, 2, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.setTextColor(6, 95, 70)
      pdf.text(badgeText, pageWidth - margin - 27, 18, { align: 'center' })

      // Invoice Number: ACTUAL INVOICE NUMBER (e.g. #INV-156)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(13)
      pdf.setTextColor(15, 23, 42)
      pdf.text(`#${displayInvoiceNo}`, pageWidth - margin, 26, { align: 'right' })

      // Date
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(100, 116, 139)
      pdf.text(dateFormatted, pageWidth - margin, 31, { align: 'right' })

      // Header Divider Line
      const headerBottom = Math.max(subY + 2, 35)
      pdf.setDrawColor(226, 232, 240)
      pdf.setLineWidth(0.3)
      pdf.line(margin, headerBottom, pageWidth - margin, headerBottom)

      // Customer & Transaction Meta Box
      const metaBoxY = headerBottom + 4
      const metaBoxHeight = 15
      pdf.setFillColor(248, 250, 252)
      pdf.setDrawColor(226, 232, 240)
      pdf.roundedRect(margin, metaBoxY, contentWidth, metaBoxHeight, 2, 2, 'FD')

      const colWidth = contentWidth / 4

      // Col 1: Customer Name
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(100, 116, 139)
      pdf.text('CUSTOMER NAME', margin + 4, metaBoxY + 5)
      pdf.setFontSize(8.5)
      pdf.setTextColor(15, 23, 42)
      pdf.text(String(invoice.customer_name || 'Valued Customer').substring(0, 24), margin + 4, metaBoxY + 10.5)

      // Col 2: Mobile Number
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(100, 116, 139)
      pdf.text('MOBILE NUMBER', margin + colWidth + 4, metaBoxY + 5)
      pdf.setFontSize(8.5)
      pdf.setTextColor(30, 41, 59)
      pdf.text(invoice.customer_phone ? `+${invoice.customer_phone}` : 'Walk-in', margin + colWidth + 4, metaBoxY + 10.5)

      // Col 3: Payment Method
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(100, 116, 139)
      pdf.text('PAYMENT METHOD', margin + (colWidth * 2) + 4, metaBoxY + 5)
      pdf.setFontSize(8.5)
      pdf.setTextColor(30, 41, 59)
      pdf.text(String(invoice.payment_type || invoice.settlement_payment_method || 'Cash').toUpperCase(), margin + (colWidth * 2) + 4, metaBoxY + 10.5)

      // Col 4: Payment Status
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(100, 116, 139)
      pdf.text('PAYMENT STATUS', margin + (colWidth * 3) + 4, metaBoxY + 5)
      pdf.setFontSize(8.5)
      if (balanceDue > 0) {
        pdf.setTextColor(217, 119, 6)
        pdf.text(`Balance: Rs. ${balanceDue.toLocaleString()}`, margin + (colWidth * 3) + 4, metaBoxY + 10.5)
      } else {
        pdf.setTextColor(4, 120, 87)
        pdf.text('Paid ✓', margin + (colWidth * 3) + 4, metaBoxY + 10.5)
      }

      // 3. Items Table (autoTable)
      const tableRows = []
      if (!isExchange) {
        ;(invoice.items || []).forEach((item, idx) => {
          const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
          const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
          const imei2 = item.imei_2 || snap.imei_2 || ''
          const rawName = item.name || `${item.brand || snap.brand || ''} ${item.model || snap.model || 'Phone'}`.trim()
          const imeiStr = imei1 ? (imei2 ? `\n[IMEI: ${imei1} / ${imei2}]` : `\n[IMEI: ${imei1}]`) : ''
          const specs = [item.storage || snap.storage, item.color || snap.color, item.condition || snap.condition, item.pta_status || snap.pta_status].filter(Boolean).join(' • ')
          const specsStr = specs ? ` • ${specs}` : ''
          const fullName = rawName.includes(imei1) ? rawName : `${rawName}${imeiStr}${specsStr}`

          const qty = Number(item.quantity || 1)
          const price = Number(item.unit_price || 0)
          const total = Number(item.total || (qty * price))

          tableRows.push([
            String(idx + 1),
            fullName,
            String(qty),
            `Rs. ${price.toLocaleString()}`,
            `Rs. ${total.toLocaleString()}`
          ])
        })
      } else {
        ;(invoice.outgoing_items || []).forEach((item, idx) => {
          const imeiStr = item.imei_1 ? `\n[IMEI: ${item.imei_1}]` : ''
          const specs = [item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')
          tableRows.push([
            String(idx + 1),
            `Purchased: ${item.product_name}${imeiStr} • ${specs}`,
            '1',
            `Rs. ${Number(item.subtotal || item.price || 0).toLocaleString()}`,
            `Rs. ${Number(item.subtotal || item.price || 0).toLocaleString()}`
          ])
        })
        ;(invoice.incoming_items || []).forEach((item) => {
          const imeiStr = item.imei_1 ? `\n[IMEI: ${item.imei_1}]` : ''
          const specs = [item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')
          tableRows.push([
            'Trade-in',
            `Exchanged: ${item.product_name}${imeiStr} • ${specs}`,
            '1',
            `- Rs. ${Number(item.assessed_value || item.subtotal || 0).toLocaleString()}`,
            `- Rs. ${Number(item.assessed_value || item.subtotal || 0).toLocaleString()}`
          ])
        })
      }

      autoTable(pdf, {
        startY: metaBoxY + metaBoxHeight + 5,
        head: [['#', 'ITEMS & PURCHASED DEVICES', 'QTY', 'UNIT PRICE', 'TOTAL AMOUNT']],
        body: tableRows,
        styles: {
          fontSize: 8.5,
          cellPadding: 3,
          textColor: [15, 23, 42],
          lineColor: [226, 232, 240],
          lineWidth: 0.1
        },
        headStyles: {
          fillColor: [248, 250, 252],
          textColor: [71, 85, 105],
          fontStyle: 'bold',
          fontSize: 8,
          lineColor: [226, 232, 240],
          lineWidth: 0.2
        },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center', textColor: [148, 163, 184] },
          1: { cellWidth: 100 },
          2: { cellWidth: 14, halign: 'center' },
          3: { cellWidth: 28, halign: 'right' },
          4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
        },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        margin: { left: margin, right: margin }
      })

      let currentY = pdf.lastAutoTable.finalY + 4

      // 4. Financial Totals Card (Right-aligned, matching online layout)
      const totalsBoxWidth = 75
      const totalsBoxX = pageWidth - margin - totalsBoxWidth
      const totalsRows = []
      totalsRows.push({ label: 'Total Amount:', val: `Rs. ${grossTotal.toLocaleString()}`, color: [71, 85, 105], bold: false })
      if (discount > 0) {
        totalsRows.push({ label: 'Discount:', val: `- Rs. ${discount.toLocaleString()}`, color: [4, 120, 87], bold: false })
      }
      if (isExchange && tradeCredit > 0) {
        totalsRows.push({ label: 'Trade-in Credit:', val: `- Rs. ${tradeCredit.toLocaleString()}`, color: [107, 33, 168], bold: false })
      }
      totalsRows.push({ label: 'Net Total:', val: `Rs. ${netTotal.toLocaleString()}`, color: [4, 120, 87], bold: true, isNet: true })
      totalsRows.push({ label: 'Amount Paid:', val: `Rs. ${paidTotal.toLocaleString()}`, color: [15, 23, 42], bold: false })
      if (balanceDue > 0) {
        totalsRows.push({ label: 'Remaining Balance:', val: `Rs. ${balanceDue.toLocaleString()}`, color: [220, 38, 38], bold: true })
      }

      const totalsBoxHeight = (totalsRows.length * 5.2) + 4
      pdf.setFillColor(248, 250, 252)
      pdf.setDrawColor(226, 232, 240)
      pdf.roundedRect(totalsBoxX, currentY, totalsBoxWidth, totalsBoxHeight, 2, 2, 'FD')

      let rowY = currentY + 4.5
      totalsRows.forEach((r) => {
        if (r.isNet) {
          pdf.setDrawColor(226, 232, 240)
          pdf.line(totalsBoxX + 3, rowY - 1.5, totalsBoxX + totalsBoxWidth - 3, rowY - 1.5)
        }
        pdf.setFont('helvetica', r.bold ? 'bold' : 'normal')
        pdf.setFontSize(r.isNet ? 9.5 : 8)
        pdf.setTextColor(...r.color)
        pdf.text(r.label, totalsBoxX + 4, rowY)
        pdf.text(r.val, totalsBoxX + totalsBoxWidth - 4, rowY, { align: 'right' })
        rowY += 5.2
      })

      currentY += totalsBoxHeight + 5

      // 5. Flattened Compact Urdu Warranty Section (Placed at bottom area keeping room for other content)
      const warrantyHeight = Math.min(32, Math.max(20, contentWidth * warrantyImgRatio))
      const footerReservedSpace = 16
      let warrantyY = Math.max(currentY + 6, pageHeight - margin - footerReservedSpace - warrantyHeight)

      if (currentY + warrantyHeight > pageHeight - margin - footerReservedSpace) {
        pdf.addPage()
        currentY = margin
        warrantyY = pageHeight - margin - footerReservedSpace - warrantyHeight
      }

      if (warrantyImgData) {
        pdf.addImage(warrantyImgData, 'PNG', margin, warrantyY, contentWidth, warrantyHeight)
      }

      // 6. Footer Disclaimer & Timestamp
      const footerY = pageHeight - margin - 3
      pdf.setDrawColor(226, 232, 240)
      pdf.line(margin, footerY - 5, pageWidth - margin, footerY - 5)

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(51, 65, 85)
      pdf.text('This is a verified computerized digital invoice and does not require a physical signature.', pageWidth / 2, footerY - 1.5, { align: 'center' })
      pdf.setFontSize(6.5)
      pdf.setTextColor(148, 163, 184)
      pdf.text(`Powered by EdgeX POS Suite • Verified Digital Invoice • ${dateFormatted}`, pageWidth / 2, footerY + 2, { align: 'center' })

      pdf.save(filename)
    } catch (err) {
      console.error('PDF download error:', err)
      // Emergency PDF generation - ALWAYS downloads a file; NEVER calls window.print()!
      try {
        const { jsPDF } = await loadPdfLibraries()
        const fallbackPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
        fallbackPdf.setFontSize(16)
        fallbackPdf.text(shop.name || 'EdgeX Mobile Store', 14, 20)
        fallbackPdf.setFontSize(12)
        fallbackPdf.text(`Invoice #${displayInvoiceNo}`, 14, 28)
        fallbackPdf.setFontSize(10)
        fallbackPdf.text(`Customer: ${invoice?.customer_name || 'Valued Customer'}`, 14, 38)
        fallbackPdf.text(`Mobile: ${invoice?.customer_phone ? '+' + invoice.customer_phone : 'Walk-in'}`, 14, 44)
        fallbackPdf.text(`Net Total: Rs. ${netTotal.toLocaleString()}`, 14, 52)
        fallbackPdf.text(`Amount Paid: Rs. ${paidTotal.toLocaleString()}`, 14, 58)
        fallbackPdf.save(filename)
      } catch (emergErr) {
        console.error('Emergency PDF fallback save failed:', emergErr)
      }
    } finally {
      setDownloadingPdf(false)
    }
  }

  // Print Handler
  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 py-6 px-3 sm:px-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Top Customer Actions Bar (Non-printed) */}
        <div className="print:hidden bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              style={{ backgroundColor: '#ecfdf5', color: '#059669' }}
              className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-base"
            >
              ✓
            </span>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Verified Digital Invoice</span>
                <span
                  style={{ backgroundColor: '#ecfdf5', color: '#065f46' }}
                  className="px-1.5 py-0.2 rounded text-[10px] font-black"
                >
                  VERIFIED
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Official EdgeX Certified Receipt</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              title="Download high-resolution official PDF with Nastaleeq Urdu warranty"
            >
              <Download size={14} className={downloadingPdf ? 'animate-bounce' : ''} />
              <span>{downloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              title="Print bill"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* Printable & Canvas-Capturable Digital Invoice Card             */}
        {/* ============================================================== */}
        <div
          ref={invoiceRef}
          style={{ backgroundColor: '#ffffff', color: '#0f172a', borderColor: '#e2e8f0' }}
          className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-8 space-y-6 print:border-none print:shadow-none print:p-0 print:rounded-none"
        >
          {/* 1. Header & Store Branding */}
          <div
            style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1.25rem' }}
            className="flex flex-col sm:flex-row sm:items-start justify-between gap-4"
          >
            <div className="space-y-1">
              {shop.logo_url && (
                <img
                  src={shop.logo_url}
                  alt={shop.name || 'Store Logo'}
                  className="h-12 max-w-[160px] object-contain mb-2"
                  crossOrigin="anonymous"
                />
              )}
              <h1
                style={{ color: '#020617' }}
                className="text-xl sm:text-2xl font-black tracking-tight"
              >
                {shop.name || 'EdgeX Mobile Store'}
              </h1>
              {shop.address && (
                <p style={{ color: '#475569' }} className="text-xs flex items-center gap-1">
                  <span className="text-[11px]">📍</span>
                  <span>{shop.address}</span>
                </p>
              )}
              {shop.phone && (
                <p style={{ color: '#475569' }} className="text-xs flex items-center gap-1 font-mono">
                  <span className="text-[11px]">📞</span>
                  <span>{shop.phone}</span>
                </p>
              )}
            </div>

            <div className="sm:text-right space-y-1">
              <span
                style={{ backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black"
              >
                <span>✓</span>
                <span>{isExchange ? 'Phone Exchange Invoice' : 'Sales Invoice'}</span>
              </span>
              <div
                style={{ color: '#020617' }}
                className="text-base font-black font-mono tracking-wide pt-1"
              >
                #{displayInvoiceNo}
              </div>
              <div style={{ color: '#64748b' }} className="text-xs flex items-center sm:justify-end gap-1">
                <span className="text-[11px]">📅</span>
                <span>{dateFormatted}</span>
              </div>
            </div>
          </div>

          {/* 2. Customer & Transaction Meta Grid */}
          <div
            style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl text-xs"
          >
            <div>
              <span style={{ color: '#64748b' }} className="text-[10px] uppercase font-bold block tracking-wider">
                Customer Name
              </span>
              <span style={{ color: '#0f172a' }} className="font-bold truncate block mt-0.5">
                {invoice.customer_name || 'Valued Customer'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748b' }} className="text-[10px] uppercase font-bold block tracking-wider">
                Mobile Number
              </span>
              <span style={{ color: '#1e293b' }} className="font-mono font-semibold block mt-0.5">
                {invoice.customer_phone ? `+${invoice.customer_phone}` : 'Walk-in'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748b' }} className="text-[10px] uppercase font-bold block tracking-wider">
                Payment Method
              </span>
              <span style={{ color: '#1e293b' }} className="font-bold uppercase block mt-0.5">
                {invoice.payment_type || invoice.settlement_payment_method || 'Cash'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748b' }} className="text-[10px] uppercase font-bold block tracking-wider">
                Payment Status
              </span>
              <span
                style={{ color: balanceDue > 0 ? '#d97706' : '#047857' }}
                className="font-black block mt-0.5"
              >
                {balanceDue > 0 ? `Balance: Rs. ${balanceDue.toLocaleString()}` : 'Paid ✓'}
              </span>
            </div>
          </div>

          {/* 3. Products / Devices Table (For Standard Sales) */}
          {!isExchange && (
            <div className="space-y-2">
              <h2 style={{ color: '#64748b' }} className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="text-xs">📱</span>
                <span>Items & Purchased Devices</span>
              </h2>

              <div style={{ border: '1px solid #e2e8f0' }} className="rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }} className="font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Description / Item Details</th>
                      <th className="py-2.5 px-2 text-center">Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(invoice.items || []).map((item, idx) => {
                      const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null
                        ? item.imei_snapshot
                        : {}
                      const rawSnapStr = typeof item.imei_snapshot === 'string' ? item.imei_snapshot : ''

                      const imei1 = item.imei_1 || snap.imei_1 || item.imei || rawSnapStr || ''
                      const imei2 = item.imei_2 || snap.imei_2 || ''
                      const rawName = item.name || `${item.brand || snap.brand || ''} ${item.model || snap.model || 'Phone'}`.trim()

                      // Check if rawName already has the IMEI in it
                      const hasImeiInName = Boolean(
                        (imei1 && rawName.includes(imei1)) ||
                        /\[(?:IMEI:?\s*)?[0-9]{14,18}\]/i.test(rawName) ||
                        /\((?:IMEI:?\s*)?[0-9]{14,18}\)/i.test(rawName)
                      )

                      const imeiTag = !hasImeiInName && imei1
                        ? (imei2 ? `[IMEI: ${imei1} / ${imei2}]` : `[IMEI: ${imei1}]`)
                        : ''

                      const specs = [item.storage || snap.storage, item.color || snap.color].filter(Boolean).join(', ')
                      const conditionParts = [item.condition || snap.condition, item.pta_status || snap.pta_status].filter(Boolean).join(' • ')

                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }} className="hover:bg-slate-50">
                          <td style={{ color: '#94a3b8' }} className="py-3 px-3 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-3 px-3">
                            <div style={{ color: '#0f172a' }} className="font-bold text-xs sm:text-sm flex flex-wrap items-baseline gap-1.5">
                              <span>{rawName}</span>
                              {imeiTag && (
                                <span
                                  style={{ backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}
                                  className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded"
                                >
                                  {imeiTag}
                                </span>
                              )}
                            </div>
                            {specs && <div style={{ color: '#64748b' }} className="text-[11px] mt-0.5">{specs}</div>}
                            {conditionParts && <div style={{ color: '#047857' }} className="text-[10px] font-medium mt-0.5">{conditionParts}</div>}
                          </td>
                          <td style={{ color: '#334155' }} className="py-3 px-2 text-center font-bold">
                            {item.quantity || 1}
                          </td>
                          <td style={{ color: '#334155' }} className="py-3 px-3 text-right font-mono font-medium">
                            Rs. {Number(item.unit_price || 0).toLocaleString()}
                          </td>
                          <td style={{ color: '#0f172a' }} className="py-3 px-3 text-right font-mono font-bold">
                            Rs. {Number(item.total || ((item.quantity || 1) * (item.unit_price || 0))).toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3B. Exchange Sections (For Phone Exchanges) */}
          {isExchange && (
            <div className="space-y-4">
              {/* Outgoing Purchased Phone */}
              <div className="space-y-1.5">
                <span style={{ color: '#065f46' }} className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <span>📤</span>
                  <span>Purchased Replacement Devices:</span>
                </span>
                <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }} className="rounded-xl p-3 space-y-2 text-xs">
                  {(invoice.outgoing_items || []).map((item, idx) => {
                    const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
                    const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
                    const hasImeiInName = Boolean(imei1 && item.product_name && item.product_name.includes(imei1))
                    const imeiTag = !hasImeiInName && imei1 ? `[IMEI: ${imei1}]` : ''

                    return (
                      <div key={idx} style={{ borderBottom: '1px solid #a7f3d0' }} className="flex justify-between items-start pb-2 last:border-b-0 last:pb-0">
                        <div>
                          <div style={{ color: '#0f172a' }} className="font-bold flex flex-wrap items-baseline gap-1.5">
                            <span>{item.product_name}</span>
                            {imeiTag && (
                              <span style={{ backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }} className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
                                {imeiTag}
                              </span>
                            )}
                          </div>
                          <div style={{ color: '#64748b' }} className="text-[11px] mt-0.5">{[item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')}</div>
                        </div>
                        <div style={{ color: '#0f172a' }} className="font-mono font-bold text-right">
                          Rs. {Number(item.subtotal || item.price || 0).toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ color: '#1e293b' }} className="flex justify-between items-center pt-1 font-bold text-xs">
                    <span>Total Purchase Amount:</span>
                    <span className="font-mono">Rs. {Number(invoice.sale_amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Incoming Traded-in Phones */}
              <div className="space-y-1.5">
                <span style={{ color: '#6b21a8' }} className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <span>📥</span>
                  <span>Traded-in / Exchanged Phones:</span>
                </span>
                <div style={{ backgroundColor: '#faf5ff', border: '1px solid #e9d5ff' }} className="rounded-xl p-3 space-y-2 text-xs">
                  {(invoice.incoming_items || []).map((item, idx) => {
                    const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
                    const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
                    const hasImeiInName = Boolean(imei1 && item.product_name && item.product_name.includes(imei1))
                    const imeiTag = !hasImeiInName && imei1 ? `[IMEI: ${imei1}]` : ''

                    return (
                      <div key={idx} style={{ borderBottom: '1px solid #f3e8ff' }} className="flex justify-between items-start pb-2 last:border-b-0 last:pb-0">
                        <div>
                          <div style={{ color: '#0f172a' }} className="font-bold flex flex-wrap items-baseline gap-1.5">
                            <span>{item.product_name}</span>
                            {imeiTag && (
                              <span style={{ backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff' }} className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded">
                                {imeiTag}
                              </span>
                            )}
                          </div>
                          <div style={{ color: '#64748b' }} className="text-[11px] mt-0.5">{[item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')}</div>
                          {item.battery_health && <div style={{ color: '#047857' }} className="text-[10px] mt-0.5">Battery Health: {item.battery_health}%</div>}
                        </div>
                        <div style={{ color: '#581c87' }} className="font-mono font-bold text-right">
                          Rs. {Number(item.assessed_value || item.subtotal || 0).toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ color: '#1e293b' }} className="flex justify-between items-center pt-1 font-bold text-xs">
                    <span>Total Trade-in Credit:</span>
                    <span style={{ color: '#6b21a8' }} className="font-mono">- Rs. {Number(invoice.trade_in_credit || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Financial Summary Card */}
          <div className="flex justify-end pt-2">
            <div
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}
              className="w-full sm:w-72 rounded-xl p-3.5 space-y-2 text-xs"
            >
              <div style={{ color: '#475569' }} className="flex justify-between">
                <span>Total Amount:</span>
                <span style={{ color: '#0f172a' }} className="font-mono font-bold">
                  Rs. {grossTotal.toLocaleString()}
                </span>
              </div>
              {discount > 0 && (
                <div style={{ color: '#047857' }} className="flex justify-between">
                  <span>Discount:</span>
                  <span className="font-mono font-bold">- Rs. {discount.toLocaleString()}</span>
                </div>
              )}
              {isExchange && (
                <div style={{ color: '#6b21a8' }} className="flex justify-between">
                  <span>Trade-in Credit:</span>
                  <span className="font-mono font-bold">- Rs. {tradeCredit.toLocaleString()}</span>
                </div>
              )}
              <div
                style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem', color: '#0f172a' }}
                className="flex justify-between font-black text-sm"
              >
                <span>Net Total:</span>
                <span style={{ color: '#047857' }} className="font-mono">
                  Rs. {netTotal.toLocaleString()}
                </span>
              </div>
              <div style={{ color: '#334155' }} className="flex justify-between pt-0.5">
                <span>Amount Paid:</span>
                <span style={{ color: '#0f172a' }} className="font-mono font-bold">Rs. {paidTotal.toLocaleString()}</span>
              </div>
              {balanceDue > 0 && (
                <div
                  style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.375rem', color: '#dc2626' }}
                  className="flex justify-between font-bold"
                >
                  <span>Remaining Balance:</span>
                  <span className="font-mono">Rs. {balanceDue.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* ============================================================== */}
          {/* 5. AUTHENTIC NASTALEEQ URDU WARRANTY CERTIFICATE SECTION       */}
          {/* ============================================================== */}
          <div
            ref={warrantyRef}
            style={{
              backgroundColor: '#fffdf5',
              border: '1.5px solid #fcd34d',
              borderRadius: '0.75rem',
              padding: '0.65rem 0.85rem'
            }}
            className="space-y-1.5"
          >
            <div
              style={{ borderBottom: '1px solid #fde68a', paddingBottom: '0.35rem' }}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-1.5">
                <span
                  style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
                >
                  🛡️
                </span>
                <h3 style={{ color: '#451a03' }} className="text-[11px] sm:text-xs font-bold tracking-wide flex items-center gap-1">
                  <span>Official Warranty Terms</span>
                  <span style={{ color: '#78350f' }} className="font-nastaliq text-[10px] font-normal">(دکان کی وارنٹی شرائط)</span>
                </h3>
              </div>
              <span
                style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
                className="text-[8.5px] font-bold px-2 py-0.5 rounded-full border font-mono"
              >
                WARRANTY
              </span>
            </div>

            {/* Authentic Small Nastaleeq Typography */}
            <div
              dir="rtl"
              style={{ color: '#1e293b' }}
              className="font-nastaliq text-[8.5px] sm:text-[9.5px] leading-[1.4] sm:leading-[1.45] whitespace-pre-line text-right selection:bg-amber-200 py-0.5"
            >
              {warrantyText}
            </div>

            <div
              style={{ borderTop: '1px solid #fde68a', paddingTop: '0.35rem', color: '#78350f' }}
              className="flex flex-wrap items-center justify-between text-[8.5px] sm:text-[9.5px]"
            >
              <div className="font-nastaliq">
                آپ کے اعتماد اور تعاون کا بہت بہت شکریہ! 🤝
              </div>
              <div style={{ color: '#451a03' }} className="font-bold">
                {shop.name || 'EdgeX Mobile Store'}
              </div>
            </div>
          </div>

          {/* 6. Footer Disclaimer & Verification Stamp */}
          <div
            style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', color: '#64748b' }}
            className="text-center text-[11px] space-y-1"
          >
            <div style={{ color: '#334155' }} className="font-medium">
              This is a verified computerized digital invoice and does not require a physical signature.
            </div>
            <div style={{ color: '#94a3b8' }} className="text-[10px]">
              Powered by EdgeX POS Suite • Verified Digital Invoice • {dateFormatted}
            </div>
          </div>
        </div>

        {/* Bottom Contact Affordance */}
        {shop.phone && (
          <div className="print:hidden text-center pt-2 pb-6">
            <a
              href={`https://wa.me/${shop.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Assalam-o-Alaikum, I have a question regarding Invoice #${displayInvoiceNo}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 py-2 px-4 rounded-xl shadow-xs transition"
            >
              <span>💬 Contact Store on WhatsApp</span>
              <ExternalLink size={12} />
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
