import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { recoverCorruptedToken, DEFAULT_WARRANTY_TERMS_URDU, buildPublicInvoiceUrl, cleanPakistanPhone, isRealCustomerName, normalizeInvoiceToken, fetchServerInvoiceToken } from '../services/whatsappQueueService'
import InvoiceDocument from '../components/InvoiceDocument'
import { buildInvoiceView } from '../utils/invoiceView'
import { generateInvoicePdf } from '../utils/invoicePdf'
import {
  Download,
  Printer,
  RefreshCw,
  ExternalLink
} from 'lucide-react'

// Action-time dynamic loading for PDF libraries
async function loadPdfLibraries() {
  const [jspdfMod, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas')
  ])
  const jsPDF = jspdfMod.jsPDF || jspdfMod.default?.jsPDF || jspdfMod.default
  const html2canvas = html2canvasMod.default || html2canvasMod
  return { jsPDF, html2canvas }
}

/**
 * Links shared before the Phase 0 fix could be corrupted by a regex that duplicated
 * tokens starting with a digit: INV-8K3P9X2M became INV-8K3P9X2MK3P9X2M (and grew on
 * each re-run). Recover the original 8-character token from that exact pattern.
 */
function recoverCorruptedInvoiceRef(ref) {
  const raw = String(ref || '').trim()
  const m = raw.match(/^(INV-|EXC-)?([A-Z0-9]+)$/i)
  if (!m) return raw
  const recovered = recoverCorruptedToken(m[2])
  return recovered && recovered !== m[2].toUpperCase() ? `${(m[1] || '').toUpperCase()}${recovered}` : raw
}

/**
 * On a shop device, fills a bill's missing customer name/phone from this device's
 * customer list or WhatsApp outbox (bills saved by some RPC versions lack them).
 * A customer's own phone has neither, so this is a no-op there; the server-side
 * backfill (sql/phase1b_bill_customer_backfill.sql) covers that case.
 */
async function fillCustomerFromDevice(record, cleanId, customerId = null) {
  if (!record) return record
  const needName = !isRealCustomerName(record.customer_name)
  const needPhone = !String(record.customer_phone || '').trim()
  if (!needName && !needPhone) return record
  const isExchange = record.type === 'exchange'
  try {
    const custId = customerId ?? record.customer_id
    if (db?.customers && custId) {
      const cust = await db.customers.get(Number(custId))
      if (cust) {
        if (!isRealCustomerName(record.customer_name) && isRealCustomerName(cust.name)) record.customer_name = cust.name
        if (!String(record.customer_phone || '').trim() && cust.phone) record.customer_phone = cust.phone
      }
    }
    if (db?.whatsapp_queue && (!isRealCustomerName(record.customer_name) || !String(record.customer_phone || '').trim())) {
      const qItems = await db.whatsapp_queue.toArray()
      const idKey = isExchange ? 'exchange_id' : 'sale_id'
      const match = qItems.find(q => {
        const ref = q.reference_data || {}
        if (record.id && ref[idKey] && String(ref[idKey]) === String(record.id)) return true
        const tok = String(ref.invoice_token || '').toUpperCase()
        return Boolean(cleanId && (tok === cleanId || String(q.reference_id || '').toUpperCase().endsWith(cleanId)))
      })
      if (match) {
        if (!isRealCustomerName(record.customer_name) && isRealCustomerName(match.recipient_name)) record.customer_name = match.recipient_name
        if (!String(record.customer_phone || '').trim() && match.recipient_phone) record.customer_phone = match.recipient_phone
      }
    }
  } catch (err) {
    console.debug('Customer lookup on this device failed:', err)
  }
  return record
}

// Shop staff have a session (tenant-scoped RLS lets their direct queries work);
// customers opening a shared link do not, so they go straight to the public RPC.
function hasStaffSession() {
  try {
    return Boolean(JSON.parse(localStorage.getItem('user') || '{}')?.shop_id)
  } catch (_) {
    return false
  }
}

export default function PublicInvoice() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
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
        const lookupId = recoverCorruptedInvoiceRef(id)
        const cleanId = lookupId.replace(/^(INV-|EXC-)/i, '').trim().toUpperCase()
        const candidateNumbers = [lookupId, cleanId, `INV-${cleanId}`, `EXC-${cleanId}`]
        const staff = hasStaffSession()

        // 1. Direct Supabase REST lookup for sales by invoice_number (staff only:
        // without a session, RLS returns nothing and this is a wasted round trip)
        if (staff) try {
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

            const effectiveCustName = [directSale.customer_name, custInfo.name].find(isRealCustomerName) || 'Valued Customer'
            const effectiveCustPhone = directSale.customer_phone || custInfo.phone || ''

            const actualInvoiceNo = directSale.id ? `INV-${directSale.id}` : (directSale.invoice_number || id)
            const formatted = {
              type: 'sale',
              id: directSale.id,
              actual_invoice_no: actualInvoiceNo,
              invoice_no: actualInvoiceNo,
              token: directSale.invoice_number || id,
              // Token the server stored: the QR / verify link must use this, not the page URL
              // Older sales keep their public code only in invoice_number (the server matches both)
              server_token: normalizeInvoiceToken(directSale.invoice_token) || normalizeInvoiceToken(directSale.invoice_number),
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

            await fillCustomerFromDevice(formatted, cleanId, directSale.customer_id)
            setInvoice(formatted)
            setLoading(false)
            return
          }
        } catch (saleLookupErr) {
          console.debug('Direct sale lookup error:', saleLookupErr)
        }

        // 2. Direct Supabase REST lookup for phone exchanges (staff only, see above)
        if (staff) try {
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
              server_token: normalizeInvoiceToken(directExchange.invoice_token),
              reference_id: directExchange.exchange_number || id,
              created_at: directExchange.created_at || new Date().toISOString(),
              sale_amount: directExchange.sale_amount || 0,
              trade_in_credit: directExchange.trade_in_credit || 0,
              settlement_amount: directExchange.settlement_amount || 0,
              settlement_direction: directExchange.settlement_direction,
              settlement_payment_method: directExchange.settlement_payment_method || 'Cash',
              settlement_paid_amount: directExchange.settlement_paid_amount || 0,
              paid_amount: directExchange.settlement_paid_amount || 0,
              customer_name: [directExchange.customer_name, custInfo.name].find(isRealCustomerName) || 'Valued Customer',
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

            await fillCustomerFromDevice(formatted, cleanId, directExchange.customer_id)
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
            p_reference: lookupId
          })

          if (!rpcErr && data) {
            const enriched = { ...data }
            const actualInvoiceNo = enriched.id
              ? (enriched.type === 'exchange' ? `EXC-${enriched.id}` : `INV-${enriched.id}`)
              : (enriched.invoice_no || id)
            enriched.actual_invoice_no = actualInvoiceNo
            // The RPC just resolved lookupId publicly, so it is a working link even when the row's
            // invoice_token is empty (older sales matched by invoice_number)
            enriched.server_token = normalizeInvoiceToken(data.invoice_token) || normalizeInvoiceToken(lookupId)
            enriched.invoice_no = actualInvoiceNo
            await fillCustomerFromDevice(enriched, cleanId)

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

              await fillCustomerFromDevice(formatted, cleanId, localSale.customer_id)
              // Found on this device only: use the server's token for the QR, if the sale has synced
              formatted.server_token = /^\d+$/.test(String(localSale.id || '')) ? await fetchServerInvoiceToken('sales', localSale.id) : null
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

  // shop.warranty_terms is the shop's saved terms (Settings → WhatsApp & Warranty, stored
  // on shops.warranty_terms). The built-in default is only for shops that never saved any.
  const rawWarranty = shop.warranty_terms || DEFAULT_WARRANTY_TERMS_URDU
  const warrantyText = rawWarranty
    .replace(/^⚠️?\s*\*?وارنٹی[\s\S]*?(?:\*|:|\))\s*\n+/i, '')
    .trim()

  // The shop's own bill number (INV-156); the URL keeps the private token.
  const displayInvoiceNo = invoice.actual_invoice_no ||
    (invoice.id ? (isExchange ? `EXC-${invoice.id}` : `INV-${invoice.id}`) : (invoice.invoice_no || id))
  // QR / verify link: always the token the server holds for this bill. The page URL may be
  // a reference only this shop device can resolve (its saved sales or outbox, an older
  // client-only token), which a customer's phone would show as "Invoice not found".
  const serverToken = normalizeInvoiceToken(invoice.server_token)
  const verifyUrl = serverToken ? buildPublicInvoiceUrl(`${isExchange ? 'EXC' : 'INV'}-${serverToken}`) : ''
  const view = buildInvoiceView(invoice, { billNo: displayInvoiceNo, verifyUrl, warrantyText })

  // Saves the PDF directly (never opens the print dialog).
  const handleDownloadPDF = async () => {
    if (downloadingPdf) return
    setDownloadingPdf(true)
    const filename = `Invoice_${displayInvoiceNo}.pdf`
    try {
      const { jsPDF, html2canvas } = await loadPdfLibraries()
      await generateInvoicePdf({ jsPDF, html2canvas, view, warrantyEl: warrantyRef.current, filename })
    } catch (err) {
      console.error('PDF download error:', err)
      // Minimal fallback so the customer still gets a file
      try {
        const { jsPDF } = await loadPdfLibraries()
        const fallbackPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
        fallbackPdf.setFontSize(16)
        fallbackPdf.text(String(view.shop.name).replace(/[^\x20-\x7E]/g, '') || 'Bill', 14, 20)
        fallbackPdf.setFontSize(12)
        fallbackPdf.text(`Bill ${displayInvoiceNo}`, 14, 28)
        fallbackPdf.setFontSize(10)
        fallbackPdf.text(`${view.status.title}`.replace(/[^\x20-\x7E]/g, ''), 14, 38)
        if (verifyUrl) fallbackPdf.text(`Verify: ${verifyUrl}`, 14, 46)
        fallbackPdf.save(filename)
      } catch (emergErr) {
        console.error('Emergency PDF fallback save failed:', emergErr)
      }
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 py-6 px-3 sm:px-6 font-sans">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* Customer actions (not printed) */}
        <div className="print:hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white">Verified digital bill</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Issued by {view.shop.name} · {displayInvoiceNo}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="min-h-[40px] py-2 px-4 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white rounded-xl text-sm font-bold transition flex items-center gap-2 shadow-sm disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <Download size={16} className={downloadingPdf ? 'animate-bounce' : ''} />
              <span>{downloadingPdf ? 'Preparing PDF…' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="min-h-[40px] py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-bold transition flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
            >
              <Printer size={16} />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>

        <InvoiceDocument ref={warrantyRef} view={view} />

        {/* Contact the shop (not printed) */}
        {shop.phone && (
          <div className="print:hidden text-center pt-2 pb-6">
            <a
              href={`https://wa.me/${cleanPakistanPhone(shop.phone)}?text=${encodeURIComponent(`Assalam-o-Alaikum, I have a question about bill ${displayInvoiceNo}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 py-2.5 px-4 rounded-xl shadow-sm transition hover:border-emerald-600"
            >
              <span>Message {view.shop.name} on WhatsApp</span>
              <ExternalLink size={14} />
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
