/**
 * printUtils.js — Mobile-safe print helper
 *
 * Uses a hidden <iframe> injected into the current page instead of
 * window.open('', '_blank'). This bypasses mobile browser popup-blockers
 * (iOS Safari, Android Chrome) which block blank popups triggered by JS.
 *
 * Usage:  import { printHTML } from '../utils/printUtils'
 *         printHTML(myHtmlString)
 */

export function printHTML(html) {
  // Re-use an existing frame if present, otherwise create one
  let frame = document.getElementById('__pos_print_frame')
  if (!frame) {
    frame = document.createElement('iframe')
    frame.id = '__pos_print_frame'
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;left:-9999px;top:-9999px;opacity:0;pointer-events:none;'
    document.body.appendChild(frame)
  }

  const doc = frame.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  // Wait for images to load before printing
  const win = frame.contentWindow
  const doprint = () => {
    try { win.focus(); win.print() } catch (_) {}
  }

  const imgs = doc.images
  if (!imgs || imgs.length === 0) {
    setTimeout(doprint, 400)
    return
  }

  let loaded = 0
  const onLoad = () => { if (++loaded >= imgs.length) setTimeout(doprint, 300) }
  for (let i = 0; i < imgs.length; i++) {
    if (imgs[i].complete) onLoad()
    else { imgs[i].onload = onLoad; imgs[i].onerror = onLoad }
  }
}

/**
 * getShopBranding(shopId)
 * Reads shop branding from localStorage (populated at login / Settings save).
 * Returns { name, phone, address, logo_url } — all strings, never null/undefined.
 */
export function getShopBranding(shopId) {
  const sid = shopId ? String(shopId) : null
  let settings = {}
  try { settings = JSON.parse((sid ? localStorage.getItem(`shop_settings_${sid}`) : null) || '{}') } catch (_) {}
  const name     = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || settings.name     || 'Our Shop'
  const logo_url = (sid ? localStorage.getItem(`shop_logo_${sid}`)  : null) || settings.logo_url || ''
  const phone    = settings.phone   || ''
  const address  = settings.address || ''
  return { name, phone, address, logo_url }
}

/**
 * brandedA4Header(branding, docTitle, subtitle)
 * Returns an HTML string for a clean A4 report header with shop branding.
 * Use inside any printHTML() template that needs a standardised top section.
 */
export function brandedA4Header(branding, docTitle, subtitle = '') {
  const { name, phone, address, logo_url } = branding
  const logoHtml = logo_url
    ? `<img src="${logo_url}" alt="logo" style="height:52px;object-fit:contain;margin-right:14px;" />`
    : ''
  const contactLine = [phone, address].filter(Boolean).join('  |  ')
  return `
    <div style="display:flex;align-items:center;border-bottom:2px solid #1e3a5f;padding-bottom:12px;margin-bottom:18px;">
      ${logoHtml}
      <div style="flex:1;">
        <div style="font-size:20px;font-weight:800;color:#1e3a5f;">${name}</div>
        ${contactLine ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${contactLine}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:700;color:#1e3a5f;">${docTitle}</div>
        ${subtitle ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${subtitle}</div>` : ''}
        <div style="font-size:10px;color:#94a3b8;margin-top:3px;">Date: ${new Date().toLocaleDateString('en-PK')}</div>
      </div>
    </div>`
}

/**
 * generatePhoneStockPrintHTML(phones, branding, options)
 * Produces clean, print-optimized A4 landscape HTML for Mobile Phone Stock Inventory.
 * Includes Model Name, Approved Status (PTA), IMEI 1/2, Storage, Purchase Price, Sale Price, Color/Condition, and Summary.
 */
export function generatePhoneStockPrintHTML(phones = [], branding = {}, options = {}) {
  const { name, phone, address, logo_url } = branding || {}
  const showCost = options.showCost !== false
  const showImei2 = options.showImei2 !== false
  const showSummary = options.showSummary !== false
  const docTitle = options.title || 'Mobile Phone Stock & Inventory Report'
  const filterDesc = options.filterDesc || ''

  const today = new Date().toLocaleDateString('en-PK', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
  const time = new Date().toLocaleTimeString('en-PK', {
    hour: '2-digit', minute: '2-digit'
  })

  // Summary Metrics
  const totalUnits = phones.length
  const inStockUnits = phones.filter(p => p.status === 'in_stock').length
  const ptaApproved = phones.filter(p => String(p.pta_status || '').toLowerCase().includes('approved')).length
  const nonPta = phones.filter(p => String(p.pta_status || '').toLowerCase().includes('non')).length
  const jvCount = phones.filter(p => {
    const s = String(p.pta_status || '').toLowerCase()
    return s === 'jv' || s.includes('jv')
  }).length
  const cpidCount = phones.filter(p => {
    const s = String(p.pta_status || '').toLowerCase()
    return s.includes('cpid') || s.includes('patch')
  }).length
  const cpidOrOther = totalUnits - ptaApproved - nonPta - jvCount

  const totalCost = phones.reduce((acc, p) => acc + (parseFloat(p.cost_price) || 0) + (parseFloat(p.additional_costs) || 0), 0)
  const totalSale = phones.reduce((acc, p) => acc + (parseFloat(p.sale_price) || parseFloat(p.selling_price) || 0), 0)
  const estMargin = totalSale - totalCost

  const logoHtml = logo_url
    ? `<img src="${logo_url}" alt="logo" style="height:48px;max-width:140px;object-fit:contain;margin-right:12px;" />`
    : ''
  const contactLine = [phone, address].filter(Boolean).join('  |  ')

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${docTitle} - ${today}</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 8mm 10mm 10mm 10mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #0f172a;
          margin: 0;
          padding: 8px;
          background: #ffffff;
          font-size: 11px;
          line-height: 1.35;
        }
        .header-wrap {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid #1e3a5f;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }
        .shop-info h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          color: #1e3a5f;
          letter-spacing: -0.3px;
        }
        .shop-info p {
          margin: 2px 0 0 0;
          font-size: 10.5px;
          color: #64748b;
        }
        .doc-info {
          text-align: right;
        }
        .doc-info h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
        }
        .doc-info p {
          margin: 2px 0 0 0;
          font-size: 10px;
          color: #64748b;
        }
        .summary-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 14px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 7px 12px;
          margin-bottom: 10px;
          align-items: center;
          justify-content: space-between;
        }
        .summary-stat {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }
        .stat-label {
          font-size: 9.5px;
          font-weight: 700;
          text-transform: uppercase;
          color: #64748b;
        }
        .stat-val {
          font-size: 11.5px;
          font-weight: 800;
          color: #0f172a;
        }
        .stat-val.green { color: #059669; }
        .stat-val.red { color: #e11d48; }
        .stat-val.blue { color: #2563eb; }
        .stat-val.purple { color: #7c3aed; }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 2px;
        }
        th {
          background: #1e3a5f;
          color: #ffffff;
          font-weight: 700;
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          padding: 6px 6px;
          text-align: left;
          border: 1px solid #1e3a5f;
        }
        th.center, td.center { text-align: center; }
        th.right, td.right { text-align: right; }
        td {
          padding: 5px 6px;
          border: 1px solid #e2e8f0;
          font-size: 10px;
          vertical-align: middle;
        }
        tr:nth-child(even) td {
          background-color: #f8fafc;
        }
        .badge {
          display: inline-block;
          padding: 1.5px 5px;
          border-radius: 4px;
          font-size: 8.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }
        .badge-pta-approved { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
        .badge-pta-non { background: #ffe4e6; color: #9f1239; border: 1px solid #fecdd3; }
        .badge-pta-jv { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
        .badge-pta-cpid { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .badge-pta-vip { background: #f3e8ff; color: #6b21a8; border: 1px solid #e9d5ff; }
        .badge-status-instock { background: #ecfdf5; color: #047857; font-weight: 800; }
        .badge-status-sold { background: #f1f5f9; color: #64748b; }
        .badge-status-reserved { background: #fffbeb; color: #b45309; }
        .imei-code {
          font-family: 'Courier New', Courier, monospace;
          font-size: 10px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: 0.4px;
        }
        .imei-sub {
          font-family: 'Courier New', Courier, monospace;
          font-size: 8.5px;
          color: #64748b;
        }
        .model-name {
          font-weight: 800;
          color: #0f172a;
          font-size: 10.5px;
        }
        .meta-text {
          font-size: 9px;
          color: #64748b;
        }
        .footer {
          margin-top: 12px;
          padding-top: 6px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          font-size: 8.5px;
          color: #94a3b8;
        }
      </style>
    </head>
    <body>
      <div class="header-wrap">
        <div style="display:flex;align-items:center;">
          ${logoHtml}
          <div class="shop-info">
            <h1>${name || 'EdgeX Mobile Store'}</h1>
            ${contactLine ? `<p>${contactLine}</p>` : ''}
          </div>
        </div>
        <div class="doc-info">
          <h2>${docTitle}</h2>
          ${filterDesc ? `<p><strong>Filter:</strong> ${filterDesc}</p>` : ''}
          <p><strong>Printed:</strong> ${today} &bull; ${time}</p>
        </div>
      </div>

      ${showSummary ? `
        <div class="summary-bar">
          <div class="summary-stat">
            <span class="stat-label">Total Devices:</span>
            <span class="stat-val">${totalUnits}</span>
          </div>
          <div class="summary-stat">
            <span class="stat-label">In-Stock:</span>
            <span class="stat-val blue">${inStockUnits}</span>
          </div>
          <div class="summary-stat">
            <span class="stat-label">PTA Approved:</span>
            <span class="stat-val green">${ptaApproved}</span>
          </div>
          <div class="summary-stat">
            <span class="stat-label">Non-PTA:</span>
            <span class="stat-val red">${nonPta}</span>
          </div>
          ${jvCount > 0 ? `
            <div class="summary-stat">
              <span class="stat-label">JV:</span>
              <span class="stat-val blue">${jvCount}</span>
            </div>
          ` : ''}
          ${cpidCount > 0 ? `
            <div class="summary-stat">
              <span class="stat-label">CPID / Patch:</span>
              <span class="stat-val" style="color:#b45309;">${cpidCount}</span>
            </div>
          ` : ''}
          ${cpidOrOther > 0 ? `
            <div class="summary-stat">
              <span class="stat-label">Other:</span>
              <span class="stat-val">${cpidOrOther}</span>
            </div>
          ` : ''}
          ${showCost ? `
            <div class="summary-stat">
              <span class="stat-label">Total Cost:</span>
              <span class="stat-val">Rs. ${Math.round(totalCost).toLocaleString()}</span>
            </div>
          ` : ''}
          <div class="summary-stat">
            <span class="stat-label">Total Sale Value:</span>
            <span class="stat-val purple">Rs. ${Math.round(totalSale).toLocaleString()}</span>
          </div>
          ${showCost ? `
            <div class="summary-stat">
              <span class="stat-label">Est. Margin:</span>
              <span class="stat-val green">Rs. ${Math.round(estMargin).toLocaleString()}</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <table>
        <thead>
          <tr>
            <th class="center" style="width:26px;">#</th>
            <th>Model Name & Brand</th>
            <th class="center" style="width:95px;">Approved Status</th>
            <th style="width:130px;">IMEI Number(s)</th>
            <th class="center" style="width:58px;">Storage</th>
            <th style="width:95px;">Color & Cond</th>
            ${showCost ? '<th class="right" style="width:85px;">Purchase Price</th>' : ''}
            <th class="right" style="width:85px;">Sale Price</th>
            <th class="center" style="width:68px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${phones.map((p, idx) => {
            const modelName = [p.brand, p.model].filter(Boolean).join(' ') || 'Mobile Device'
            
            // PTA badge
            const ptaRaw = String(p.pta_status || '').toLowerCase()
            let ptaBadgeClass = 'badge-pta-approved'
            let ptaText = 'PTA Approved'
            if (ptaRaw.includes('non')) {
              ptaBadgeClass = 'badge-pta-non'
              ptaText = 'Non-PTA'
            } else if (ptaRaw === 'jv' || ptaRaw.includes('jv')) {
              ptaBadgeClass = 'badge-pta-jv'
              ptaText = 'JV'
            } else if (ptaRaw.includes('cpid') || ptaRaw.includes('patch')) {
              ptaBadgeClass = 'badge-pta-cpid'
              ptaText = 'CPID / Patch'
            } else if (ptaRaw.includes('vip') || ptaRaw.includes('gevey')) {
              ptaBadgeClass = 'badge-pta-vip'
              ptaText = 'VIP / Gevey'
            } else if (ptaRaw.includes('block')) {
              ptaBadgeClass = 'badge-pta-non'
              ptaText = 'Blocked'
            }

            // Status badge
            const statusRaw = String(p.status || 'in_stock').toLowerCase()
            let statusBadgeClass = 'badge-status-instock'
            let statusText = 'In Stock'
            if (statusRaw === 'sold') {
              statusBadgeClass = 'badge-status-sold'
              statusText = 'Sold'
            } else if (statusRaw === 'reserved' || statusRaw === 'issued' || statusRaw === 'personal') {
              statusBadgeClass = 'badge-status-reserved'
              statusText = statusRaw.toUpperCase()
            }

            const cost = parseFloat(p.cost_price) || 0
            const sale = parseFloat(p.sale_price) || parseFloat(p.selling_price) || 0

            return `
              <tr>
                <td class="center font-bold" style="color:#64748b;">${idx + 1}</td>
                <td>
                  <div class="model-name">${modelName}</div>
                  ${p.battery_health ? `<div class="meta-text">Battery Health: ${p.battery_health}%</div>` : ''}
                </td>
                <td class="center">
                  <span class="badge ${ptaBadgeClass}">${ptaText}</span>
                </td>
                <td>
                  <div class="imei-code">${p.imei_1 || '-'}</div>
                  ${showImei2 && p.imei_2 ? `<div class="imei-sub">SIM 2: ${p.imei_2}</div>` : ''}
                </td>
                <td class="center" style="font-weight:700;">
                  ${p.storage || '-'}
                </td>
                <td>
                  <div>${p.color || '-'}</div>
                  <div class="meta-text">${p.condition ? p.condition.replace('_', ' ') : 'Used'}</div>
                </td>
                ${showCost ? `
                  <td class="right" style="font-weight:700;color:#1e293b;">
                    ${cost > 0 ? 'Rs. ' + cost.toLocaleString() : '-'}
                  </td>
                ` : ''}
                <td class="right" style="font-weight:800;color:#1e3a5f;">
                  ${sale > 0 ? 'Rs. ' + sale.toLocaleString() : '-'}
                </td>
                <td class="center">
                  <span class="badge ${statusBadgeClass}">${statusText}</span>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>

      <div class="footer">
        <span>Computer Generated Mobile Phone Stock Inventory Report</span>
        <span>${name || 'EdgeX Mobile Store'}</span>
        <span>Page 1</span>
      </div>
    </body>
    </html>
  `
}
