import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import {
  Smartphone,
  Download,
  Printer,
  CheckCircle2,
  Calendar,
  Phone,
  MapPin,
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
        // 1. Try public RPC function (SECURITY DEFINER)
        const { data, error: rpcErr } = await supabase.rpc('get_public_invoice', {
          p_reference: id
        })

        if (!rpcErr && data) {
          if (isMounted) {
            setInvoice(data)
            setLoading(false)
          }
          return
        }

        // 2. Fallback: Check Dexie local sales cache (if viewed on same device / local cache)
        if (db?.sales) {
          try {
            const cleanId = id.replace(/^(INV-|EXC-)/i, '').trim().toUpperCase()
            const allSales = await db.sales.toArray()
            // Strictly match by invoice_token or idempotency_key to prevent incremental ID enumeration
            const localSale = allSales.find(s =>
              (s.invoice_token && s.invoice_token.toUpperCase() === cleanId) ||
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

              const formattedNo = localSale.invoice_token ? `INV-${localSale.invoice_token}` : (id.startsWith('INV-') ? id : `INV-${cleanId}`)
              const formatted = {
                type: 'sale',
                id: localSale.id,
                invoice_no: formattedNo,
                invoice_token: localSale.invoice_token || cleanId,
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
                  return {
                    name: i.name || i.product_name || 'Item',
                    brand: i.brand || snap.brand || '',
                    model: i.model || snap.model || '',
                    storage: i.storage || snap.storage || '',
                    color: i.color || snap.color || '',
                    condition: i.condition || snap.condition || '',
                    pta_status: i.pta_status || snap.pta_status || '',
                    imei_1: i.imei_1 || snap.imei_1 || i.imei || rawSnapStr || '',
                    imei_2: i.imei_2 || snap.imei_2 || '',
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

        // 3. Fallback: Check Dexie whatsapp_queue reference_data
        if (db?.whatsapp_queue) {
          try {
            const cleanId = id.replace(/^(INV-|EXC-)/i, '')
            const qItems = await db.whatsapp_queue.toArray()
            const match = qItems.find(q =>
              q.reference_id === id ||
              q.reference_id === cleanId ||
              (q.reference_data && (String(q.reference_data.exchange_number) === id || String(q.reference_data.exchange_id) === cleanId))
            )

            if (match && isMounted) {
              const text = match.message_text || ''
              // Render basic receipt container from message text
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

  // PDF Download Handler (always downloads a PDF file; never opens print dialog)
  const handleDownloadPDF = async () => {
    if (!invoiceRef.current || downloadingPdf) return
    setDownloadingPdf(true)

    const filename = `Invoice_${invoice?.invoice_no || id || 'receipt'}.pdf`

    try {
      const { jsPDF, html2canvas, autoTable } = await loadPdfLibraries()
      const element = invoiceRef.current

      // Ensure fonts are loaded before capturing canvas
      if (document.fonts?.ready) {
        await document.fonts.ready
      }

      let usedCanvas = false

      // STRATEGY 1: High-DPI Visual Canvas (captures exact styling & Nastaleeq Urdu)
      try {
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor: '#ffffff',
          onclone: (clonedDoc) => {
            // Ensure no tainted cross-origin images crash toDataURL()
            const clonedImages = clonedDoc.querySelectorAll('img')
            clonedImages.forEach(img => {
              try {
                if (img.src && !img.src.startsWith('data:') && !img.src.startsWith(window.location.origin)) {
                  img.crossOrigin = 'anonymous'
                }
              } catch (_) {
                img.style.display = 'none'
              }
            })
          }
        })

        const imgData = canvas.toDataURL('image/png')
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        })

        const pageWidth = pdf.internal.pageSize.getWidth()
        const pageHeight = pdf.internal.pageSize.getHeight()
        const margin = 8
        const printableWidth = pageWidth - (margin * 2)
        const printableHeight = (canvas.height * printableWidth) / canvas.width

        if (printableHeight <= pageHeight - (margin * 2)) {
          pdf.addImage(imgData, 'PNG', margin, margin, printableWidth, printableHeight)
        } else if (printableHeight <= pageHeight + 25) {
          const maxAvailableHeight = pageHeight - (margin * 2)
          const scaledWidth = (canvas.width * maxAvailableHeight) / canvas.height
          const xOffset = (pageWidth - scaledWidth) / 2
          pdf.addImage(imgData, 'PNG', xOffset, margin, scaledWidth, maxAvailableHeight)
        } else {
          let heightLeft = printableHeight
          let position = margin
          pdf.addImage(imgData, 'PNG', margin, position, printableWidth, printableHeight)
          heightLeft -= (pageHeight - (margin * 2))

          while (heightLeft > 0) {
            position = position - pageHeight + margin
            pdf.addPage()
            pdf.addImage(imgData, 'PNG', margin, position, printableWidth, printableHeight)
            heightLeft -= (pageHeight - (margin * 2))
          }
        }

        pdf.save(filename)
        usedCanvas = true
      } catch (canvasErr) {
        console.warn('Canvas rendering encountered an issue, falling back to direct vector jsPDF:', canvasErr)
      }

      // STRATEGY 2: Direct Vector jsPDF Fallback (Guaranteed to download PDF without canvas restrictions)
      if (!usedCanvas) {
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

        // Header: Store Name
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.text(shop.name || 'EdgeX Mobile Store', 105, 18, { align: 'center' })

        let currentY = 25
        pdf.setFontSize(9)
        pdf.setFont('helvetica', 'normal')
        const contactInfo = [shop.phone, shop.address].filter(Boolean).join('  |  ')
        if (contactInfo) {
          pdf.text(contactInfo, 105, currentY, { align: 'center' })
          currentY += 6
        }

        pdf.setFontSize(11)
        pdf.setFont('helvetica', 'bold')
        pdf.text(isExchange ? 'PHONE EXCHANGE INVOICE' : 'SALES INVOICE', 105, currentY, { align: 'center' })
        currentY += 8

        // Metadata Grid
        pdf.setFontSize(9)
        pdf.setFont('helvetica', 'normal')
        pdf.text(`Invoice #: ${invoice.invoice_no || id}`, 14, currentY)
        pdf.text(`Date: ${dateFormatted}`, 196, currentY, { align: 'right' })
        currentY += 5
        pdf.text(`Customer: ${invoice.customer_name || 'Valued Customer'}${invoice.customer_phone ? ` (+${invoice.customer_phone})` : ''}`, 14, currentY)
        pdf.text(`Payment: ${String(invoice.payment_type || 'CASH').toUpperCase()}`, 196, currentY, { align: 'right' })
        currentY += 7

        // Items Table
        const items = invoice.items || []
        const tableRows = items.map((item, idx) => {
          const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
          const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
          const imei2 = item.imei_2 || snap.imei_2 || ''
          const rawName = item.name || `${item.brand || snap.brand || ''} ${item.model || snap.model || 'Phone'}`.trim()
          const imeiStr = imei1 ? (imei2 ? ` [IMEI: ${imei1} / ${imei2}]` : ` [IMEI: ${imei1}]`) : ''
          const fullName = rawName.includes(imei1) ? rawName : `${rawName}${imeiStr}`

          const qty = Number(item.quantity || item.qty || 1)
          const price = Number(item.unit_price || item.custom_price || item.price || 0)
          const total = Number(item.total || (qty * price))
          return [String(idx + 1), fullName, String(qty), `Rs. ${price.toLocaleString()}`, `Rs. ${total.toLocaleString()}`]
        })

        autoTable(pdf, {
          startY: currentY,
          head: [['#', 'Description & IMEI', 'Qty', 'Unit Price', 'Total Amount']],
          body: tableRows,
          styles: { fontSize: 9, cellPadding: 2.5 },
          headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 95 },
            2: { cellWidth: 18, halign: 'center' },
            3: { cellWidth: 32, halign: 'right' },
            4: { cellWidth: 35, halign: 'right' }
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 14, right: 14 }
        })

        currentY = (pdf.lastAutoTable?.finalY || currentY) + 6

        // Financial Totals
        pdf.setFontSize(9)
        pdf.text('Total Amount:', 140, currentY)
        pdf.text(`Rs. ${grossTotal.toLocaleString()}`, 196, currentY, { align: 'right' })
        currentY += 5

        if (discount > 0) {
          pdf.text('Discount:', 140, currentY)
          pdf.text(`- Rs. ${discount.toLocaleString()}`, 196, currentY, { align: 'right' })
          currentY += 5
        }

        if (isExchange && tradeCredit > 0) {
          pdf.text('Trade-in Credit:', 140, currentY)
          pdf.text(`- Rs. ${tradeCredit.toLocaleString()}`, 196, currentY, { align: 'right' })
          currentY += 5
        }

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(11)
        pdf.text('Net Total:', 140, currentY)
        pdf.text(`Rs. ${netTotal.toLocaleString()}`, 196, currentY, { align: 'right' })
        currentY += 6

        pdf.setFontSize(9)
        pdf.setFont('helvetica', 'normal')
        pdf.text('Amount Paid:', 140, currentY)
        pdf.text(`Rs. ${paidTotal.toLocaleString()}`, 196, currentY, { align: 'right' })
        currentY += 5

        if (balanceDue > 0) {
          pdf.setFont('helvetica', 'bold')
          pdf.text('Remaining Balance:', 140, currentY)
          pdf.text(`Rs. ${balanceDue.toLocaleString()}`, 196, currentY, { align: 'right' })
          currentY += 6
        }

        // Strategy 2 Warranty Terms Box (Guarantee warranty is never missing even in vector fallback)
        currentY += 6
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.setTextColor(180, 83, 9)
        pdf.text('OFFICIAL STORE WARRANTY TERMS / WARANTI SHARAIT:', 14, currentY)
        currentY += 4
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        pdf.setTextColor(51, 65, 85)
        const warrantyFallback = warrantyText || '1. LCD, Face ID, and Camera carry no warranty.\n2. Dead mobile phones are non-refundable.\n3. Used/Second-hand mobile phones carry no warranty.'
        const splitWarranty = pdf.splitTextToSize(warrantyFallback, 182)
        pdf.text(splitWarranty, 14, currentY)
        currentY += (splitWarranty.length * 4) + 6
        pdf.setTextColor(0, 0, 0)

        // Footer
        currentY += 8
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'italic')
        pdf.text('This is a verified computerized digital invoice and does not require a physical signature.', 105, currentY, { align: 'center' })
        pdf.text(`Powered by EdgeX POS Suite • Verified Digital Invoice • ${dateFormatted}`, 105, currentY + 4, { align: 'center' })

        pdf.save(filename)
      }
    } catch (err) {
      console.error('PDF download error:', err)
      // Emergency raw fallback: NEVER call window.print()!
      try {
        const { jsPDF } = await loadPdfLibraries()
        const emergencyPdf = new jsPDF()
        emergencyPdf.setFontSize(14)
        emergencyPdf.text(`Invoice #${invoice?.invoice_no || id}`, 14, 25)
        emergencyPdf.setFontSize(11)
        emergencyPdf.text(`Customer: ${invoice?.customer_name || 'Valued Customer'}`, 14, 35)
        emergencyPdf.text(`Net Total: Rs. ${netTotal.toLocaleString()}`, 14, 45)
        emergencyPdf.text(`Status: ${balanceDue > 0 ? `Balance Due: Rs. ${balanceDue.toLocaleString()}` : 'Paid'}`, 14, 55)
        emergencyPdf.save(filename)
      } catch (emergErr) {
        console.error('Emergency PDF save failed:', emergErr)
      }
    } finally {
      setDownloadingPdf(false)
    }
  }

  // Print Handler (explicitly triggers browser print dialog)
  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 py-6 px-3 sm:px-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Top Customer Actions Bar (Non-printed) */}
        <div className="print:hidden bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-base">
              ✓
            </span>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Verified Digital Invoice</span>
                <span className="px-1.5 py-0.2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 rounded text-[10px] font-black">
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
          className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-8 space-y-6 print:border-none print:shadow-none print:p-0 print:rounded-none"
        >
          {/* 1. Header & Store Branding */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="space-y-1">
              {shop.logo_url && (
                <img
                  src={shop.logo_url}
                  alt={shop.name || 'Store Logo'}
                  className="h-12 max-w-[160px] object-contain mb-2"
                />
              )}
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">
                {shop.name || 'EdgeX Mobile Store'}
              </h1>
              {shop.address && (
                <p className="text-xs text-slate-600 flex items-center gap-1">
                  <MapPin size={12} className="text-slate-400 shrink-0" />
                  <span>{shop.address}</span>
                </p>
              )}
              {shop.phone && (
                <p className="text-xs text-slate-600 flex items-center gap-1 font-mono">
                  <Phone size={12} className="text-slate-400 shrink-0" />
                  <span>{shop.phone}</span>
                </p>
              )}
            </div>

            <div className="sm:text-right space-y-1">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 size={12} />
                <span>{isExchange ? 'Phone Exchange Invoice' : 'Sales Invoice'}</span>
              </span>
              <div className="text-base font-black font-mono tracking-wide text-slate-950 pt-1">
                #{invoice.invoice_no || id}
              </div>
              <div className="text-xs text-slate-500 flex items-center sm:justify-end gap-1">
                <Calendar size={12} className="text-slate-400" />
                <span>{dateFormatted}</span>
              </div>
            </div>
          </div>

          {/* 2. Customer & Transaction Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Customer Name</span>
              <span className="font-bold text-slate-900 truncate block mt-0.5">
                {invoice.customer_name || 'Valued Customer'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Mobile Number</span>
              <span className="font-mono font-semibold text-slate-800 block mt-0.5">
                {invoice.customer_phone ? `+${invoice.customer_phone}` : 'Walk-in'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Payment Method</span>
              <span className="font-bold text-slate-800 uppercase block mt-0.5">
                {invoice.payment_type || invoice.settlement_payment_method || 'Cash'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Payment Status</span>
              <span className={`font-black block mt-0.5 ${balanceDue > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                {balanceDue > 0 ? `Balance: Rs. ${balanceDue.toLocaleString()}` : 'Paid ✓'}
              </span>
            </div>
          </div>

          {/* 3. Products / Devices Table (For Standard Sales) */}
          {!isExchange && (
            <div className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Smartphone size={13} className="text-emerald-600" />
                <span>Items & Purchased Devices</span>
              </h2>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
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
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900 text-xs sm:text-sm flex flex-wrap items-baseline gap-1.5">
                              <span>{rawName}</span>
                              {imeiTag && (
                                <span className="font-mono text-[11px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                  {imeiTag}
                                </span>
                              )}
                            </div>
                            {specs && <div className="text-[11px] text-slate-500 mt-0.5">{specs}</div>}
                            {conditionParts && <div className="text-[10px] text-emerald-700 font-medium mt-0.5">{conditionParts}</div>}
                          </td>
                          <td className="py-3 px-2 text-center font-bold text-slate-700">
                            {item.quantity || 1}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-medium text-slate-700">
                            Rs. {Number(item.unit_price || 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
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
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                  <span>📤</span>
                  <span>Purchased Replacement Devices:</span>
                </span>
                <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 space-y-2 text-xs">
                  {(invoice.outgoing_items || []).map((item, idx) => {
                    const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
                    const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
                    const hasImeiInName = Boolean(imei1 && item.product_name && item.product_name.includes(imei1))
                    const imeiTag = !hasImeiInName && imei1 ? `[IMEI: ${imei1}]` : ''

                    return (
                      <div key={idx} className="flex justify-between items-start border-b border-emerald-100 pb-2 last:border-b-0 last:pb-0">
                        <div>
                          <div className="font-bold text-slate-900 flex flex-wrap items-baseline gap-1.5">
                            <span>{item.product_name}</span>
                            {imeiTag && (
                              <span className="font-mono text-[11px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                {imeiTag}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{[item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')}</div>
                        </div>
                        <div className="font-mono font-bold text-slate-900 text-right">
                          Rs. {Number(item.subtotal || item.price || 0).toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex justify-between items-center pt-1 font-bold text-xs text-slate-800">
                    <span>Total Purchase Amount:</span>
                    <span className="font-mono">Rs. {Number(invoice.sale_amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Incoming Traded-in Phones */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-800 flex items-center gap-1">
                  <span>📥</span>
                  <span>Traded-in / Exchanged Phones:</span>
                </span>
                <div className="border border-purple-200 bg-purple-50 rounded-xl p-3 space-y-2 text-xs">
                  {(invoice.incoming_items || []).map((item, idx) => {
                    const snap = typeof item.imei_snapshot === 'object' && item.imei_snapshot !== null ? item.imei_snapshot : {}
                    const imei1 = item.imei_1 || snap.imei_1 || item.imei || ''
                    const hasImeiInName = Boolean(imei1 && item.product_name && item.product_name.includes(imei1))
                    const imeiTag = !hasImeiInName && imei1 ? `[IMEI: ${imei1}]` : ''

                    return (
                      <div key={idx} className="flex justify-between items-start border-b border-purple-100 pb-2 last:border-b-0 last:pb-0">
                        <div>
                          <div className="font-bold text-slate-900 flex flex-wrap items-baseline gap-1.5">
                            <span>{item.product_name}</span>
                            {imeiTag && (
                              <span className="font-mono text-[11px] font-bold text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                                {imeiTag}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{[item.storage, item.color, item.condition, item.pta_status].filter(Boolean).join(' • ')}</div>
                          {item.battery_health && <div className="text-[10px] text-emerald-700 mt-0.5">Battery Health: {item.battery_health}%</div>}
                        </div>
                        <div className="font-mono font-bold text-purple-900 text-right">
                          Rs. {Number(item.assessed_value || item.subtotal || 0).toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex justify-between items-center pt-1 font-bold text-xs text-slate-800">
                    <span>Total Trade-in Credit:</span>
                    <span className="font-mono text-purple-900">- Rs. {Number(invoice.trade_in_credit || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Financial Summary Card */}
          <div className="flex justify-end pt-2">
            <div className="w-full sm:w-72 bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Total Amount:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs. {grossTotal.toLocaleString()}
                </span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span className="font-mono font-bold">- Rs. {discount.toLocaleString()}</span>
                </div>
              )}
              {isExchange && (
                <div className="flex justify-between text-purple-700">
                  <span>Trade-in Credit:</span>
                  <span className="font-mono font-bold">- Rs. {tradeCredit.toLocaleString()}</span>
                </div>
              )}
              <div className="border-t border-slate-200 pt-2 flex justify-between text-slate-900 font-black text-sm">
                <span>Net Total:</span>
                <span className="font-mono text-emerald-700">
                  Rs. {netTotal.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-700 pt-0.5">
                <span>Amount Paid:</span>
                <span className="font-mono font-bold">Rs. {paidTotal.toLocaleString()}</span>
              </div>
              {balanceDue > 0 && (
                <div className="flex justify-between text-red-600 font-bold border-t border-slate-200 pt-1.5">
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
            style={{
              backgroundColor: '#fffdf5',
              border: '2px solid #fcd34d',
              borderRadius: '1rem',
              padding: '1.25rem'
            }}
            className="space-y-2.5"
          >
            <div
              style={{ borderBottom: '1px solid #fde68a', paddingBottom: '0.5rem' }}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span
                  style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-xs"
                >
                  🛡️
                </span>
                <h3 className="text-xs sm:text-sm font-bold text-amber-950 tracking-wide flex items-center gap-1.5">
                  <span>Official Warranty Terms</span>
                  <span className="font-nastaliq text-[11px] font-normal text-amber-900">(دکان کی وارنٹی شرائط)</span>
                </h3>
              </div>
              <span
                style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#92400e' }}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono"
              >
                WARRANTY
              </span>
            </div>

            {/* Authentic Small Nastaleeq Typography */}
            <div
              dir="rtl"
              className="font-nastaliq text-[10px] sm:text-[11px] text-slate-800 leading-[1.8] sm:leading-[1.85] whitespace-pre-line text-right selection:bg-amber-200 py-1"
            >
              {warrantyText}
            </div>

            <div
              style={{ borderTop: '1px solid #fde68a', paddingTop: '0.5rem' }}
              className="flex flex-wrap items-center justify-between text-[10px] sm:text-[11px] text-amber-900"
            >
              <div className="font-nastaliq">
                آپ کے اعتماد اور تعاون کا بہت بہت شکریہ! 🤝
              </div>
              <div className="font-bold text-amber-950">
                {shop.name || 'EdgeX Mobile Store'}
              </div>
            </div>
          </div>

          {/* 6. Footer Disclaimer & Verification Stamp */}
          <div className="pt-4 border-t border-slate-200 text-center text-slate-500 text-[11px] space-y-1">
            <div className="font-medium text-slate-700">
              This is a verified computerized digital invoice and does not require a physical signature.
            </div>
            <div className="text-[10px] text-slate-400">
              Powered by EdgeX POS Suite • Verified Digital Invoice • {dateFormatted}
            </div>
          </div>
        </div>

        {/* Bottom Contact Affordance */}
        {shop.phone && (
          <div className="print:hidden text-center pt-2 pb-6">
            <a
              href={`https://wa.me/${shop.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Assalam-o-Alaikum, I have a question regarding Invoice #${invoice.invoice_no}`)}`}
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
