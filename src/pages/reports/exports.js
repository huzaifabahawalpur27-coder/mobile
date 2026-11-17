// Excel downloads and the A4 print for the Reports page. The Excel library is loaded
// only when a download is asked for.
import { printHTML, getShopBranding, brandedA4Header } from '../../utils/printUtils'
import { rs, pct, timeOf } from './format'

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const r0 = (n) => Math.round(Number(n) || 0)
const fileDate = () => new Date().toISOString().slice(0, 10)

const soldItemRows = (report) => report.soldLines.map(l => ({
  'Date': l.date ? new Date(l.date).toLocaleDateString('en-PK') : '',
  'Time': timeOf(l.date),
  'Invoice': l.invoice,
  'Customer': l.customer,
  'Item': l.name,
  'IMEI': l.imei,
  'Type': l.isPhone ? 'Phone' : 'Accessory',
  'Category': l.category,
  'Qty': l.qty,
  'Sale price (Rs.)': r0(l.unitPrice),
  'Discount (Rs.)': r0(l.discount),
  'Net sale (Rs.)': r0(l.revenue),
  'Purchase cost (Rs.)': r0(l.purchaseCost),
  'Extra cost (Rs.)': r0(l.extraCost),
  'Total cost (Rs.)': r0(l.cost),
  'Profit (Rs.)': r0(l.profit),
  'Margin': pct(l.profit, l.revenue)
}))

const productRows = (report) => [...report.productList]
  .sort((a, b) => b.revenue - a.revenue)
  .map(p => ({
    'Product': p.name,
    'Type': p.item_type === 'phone' ? 'Phone' : 'Accessory',
    'Category': p.category,
    'Bought': p.inwardQty || 0,
    'Sold': p.qty,
    'Sales (Rs.)': r0(p.revenue),
    'Purchase cost (Rs.)': r0(p.baseCost),
    'Extra cost (Rs.)': r0(p.directCost),
    'Total cost (Rs.)': r0(p.cost),
    'Profit (Rs.)': r0(p.profit),
    'Margin': p.qty > 0 ? pct(p.profit, p.revenue) : '',
    'In stock': p.stock
  }))

const dayRows = (report) => report.dailyBreakdown.map(d => ({
  'Date': d.dateKey,
  'Day': d.dayName,
  'Sales made': d.ordersCount,
  'Phones sold': d.phonesSold,
  'Accessories sold': d.bulkSold,
  'Sales before discounts (Rs.)': r0(d.grossSales),
  'Discounts (Rs.)': r0(d.discount),
  'Sales (Rs.)': r0(d.netSales),
  'Cost of goods (Rs.)': r0(d.cogs),
  'Profit (Rs.)': r0(d.grossProfit),
  'Margin': pct(d.grossProfit, d.netSales),
  'Expenses (Rs.)': r0(d.expenses),
  'Net profit (Rs.)': r0(d.netProfit),
  'Cash sales (Rs.)': r0(d.cashSales),
  'Bank / wallet sales (Rs.)': r0(d.onlineSales),
  'Credit sales (Rs.)': r0(d.creditSales),
  'Stock bought (Rs.)': r0(d.purchases)
}))

const summaryRows = (report, period) => {
  const s = report.stats
  return [
    { 'Item': 'Period', 'Amount': `${period.name} · ${period.dates}` },
    { 'Item': 'Sales before discounts (Rs.)', 'Amount': r0(s.grossSales) },
    { 'Item': 'Discounts (Rs.)', 'Amount': r0(s.totalDiscount) },
    { 'Item': 'Sales (Rs.)', 'Amount': r0(s.netSales) },
    { 'Item': 'Purchase cost of items sold (Rs.)', 'Amount': r0(s.purchaseCostOfSales) },
    { 'Item': 'Extra costs on items sold (Rs.)', 'Amount': r0(s.totalDirectCosts) },
    { 'Item': 'Stock cost corrections (Rs.)', 'Amount': r0(s.costAdjustments) },
    { 'Item': 'Profit on sales (Rs.)', 'Amount': r0(s.grossProfit) },
    { 'Item': 'Shop expenses (Rs.)', 'Amount': r0(s.expenses) },
    { 'Item': 'Net profit (Rs.)', 'Amount': r0(s.netProfit) },
    { 'Item': 'Number of sales', 'Amount': s.salesCount },
    { 'Item': 'Items sold', 'Amount': s.totalUnitsSold },
    { 'Item': 'Stock bought (Rs.)', 'Amount': r0(s.purchases) }
  ]
}

const SHEETS = {
  overview: [['Summary', summaryRows], ['Sold items', soldItemRows], ['Products', productRows], ['Days', dayRows]],
  items: [['Sold items', soldItemRows]],
  products: [['Products', productRows]],
  days: [['Days', dayRows]]
}
export const EXCEL_LABEL = { overview: 'Excel: full report', items: 'Excel: sold items', products: 'Excel: products', days: 'Excel: days' }

export async function downloadExcel(tab, report, period) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of SHEETS[tab] || SHEETS.overview) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows(report, period)), name)
  }
  const what = { overview: 'Report', items: 'Sold_items', products: 'Products', days: 'Days' }[tab] || 'Report'
  XLSX.writeFile(wb, `${what}_${period.name.replace(/\s+/g, '_')}_${fileDate()}.xlsx`)
}

// One A4 report for the whole period: totals, profit and loss, days, sold items, expenses
export function printReport(report, period, shopId) {
  const s = report.stats
  const header = brandedA4Header(getShopBranding(shopId), 'Sales and profit report', `${esc(period.name)} · ${esc(period.dates)}`)
  const td = (v, right = false, extra = '') => `<td style="${right ? 'text-align:right;white-space:nowrap;' : ''}${extra}">${v}</td>`
  const money = (n) => esc(rs(n))
  const profitCell = (n, bold = true) => td(money(n), true, `${bold ? 'font-weight:700;' : ''}color:${n < 0 ? '#b91c1c' : '#047857'};`)

  const pl = [
    ['Sales before discounts', s.grossSales],
    ['Discounts given', -s.totalDiscount],
    ['<b>Sales</b>', s.netSales, true],
    ['Purchase cost of items sold', -s.purchaseCostOfSales],
    ...(s.totalDirectCosts > 0 ? [['Extra costs on items sold', -s.totalDirectCosts]] : []),
    ...(s.costAdjustments ? [['Stock cost corrections', -s.costAdjustments]] : []),
    [`<b>Profit on sales</b> (${pct(s.grossProfit, s.netSales)})`, s.grossProfit, true],
    ['Shop expenses', -s.expenses],
    ['<b>Net profit</b>', s.netProfit, true]
  ].map(([label, v, strong]) => `<tr${strong ? ' class="strong"' : ''}>${td(label)}${td(money(v), true)}</tr>`).join('')

  const days = report.dailyBreakdown.filter(d => d.ordersCount || d.expenses || d.purchases)
  const daysTable = days.length > 1 ? `
    <h2>By day</h2>
    <table>
      <thead><tr><th>Day</th><th class="r">Sales made</th><th class="r">Sales</th><th class="r">Cost of goods</th><th class="r">Profit</th><th class="r">Expenses</th><th class="r">Net profit</th></tr></thead>
      <tbody>${days.map(d => `<tr>${td(esc(d.fullDate))}${td(d.ordersCount, true)}${td(money(d.netSales), true)}${td(money(d.cogs), true)}${profitCell(d.grossProfit, false)}${td(d.expenses ? money(d.expenses) : '—', true)}${profitCell(d.netProfit)}</tr>`).join('')}</tbody>
    </table>` : ''

  const sold = report.soldDays.map(d => `
    <tr class="day"><td colspan="8">${esc(d.label)} — ${d.qty} item${d.qty === 1 ? '' : 's'}, sales ${money(d.revenue)}, profit ${money(d.profit)}</td></tr>
    ${d.lines.map(l => `<tr>
      ${td(esc(timeOf(l.date)))}
      ${td(`<b>${esc(l.name)}</b>${l.imei ? `<br><span class="muted">IMEI ${esc(l.imei)}</span>` : ''}<br><span class="muted">${esc(l.customer)} · ${esc(l.invoice)}</span>`)}
      ${td(l.qty, true)}${td(money(l.unitPrice), true)}${td(l.discount > 0 ? money(l.discount) : '—', true)}
      ${td(money(l.purchaseCost), true)}${td(l.extraCost > 0 ? money(l.extraCost) : '—', true)}${profitCell(l.profit)}
    </tr>`).join('')}`).join('')

  const expenses = report.expenseBreakdown.length ? `
    <h2>Shop expenses</h2>
    <table><tbody>${report.expenseBreakdown.map(e => `<tr>${td(esc(e.cat))}${td(money(e.val), true)}</tr>`).join('')}</tbody></table>` : ''

  printHTML(`
    <html><head><title>Sales and profit report</title>
    <style>
      @page{size:A4 portrait;margin:12mm}
      *{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#0f172a;margin:0;line-height:1.4}
      h2{font-size:13px;margin:18px 0 6px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
      .card{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;background:#f8fafc}
      .card .l{font-size:9.5px;color:#475569;font-weight:600}
      .card .v{font-size:15px;font-weight:800;margin-top:2px}
      table{width:100%;border-collapse:collapse}
      th{background:#0f172a;color:#fff;padding:5px 6px;font-size:9.5px;text-align:left;font-weight:600}
      th.r{text-align:right}
      td{padding:4px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}
      tr.strong td{background:#f1f5f9;font-weight:700}
      tr.day td{background:#e2e8f0;font-weight:700;padding:6px}
      .muted{color:#475569}
      .pl{max-width:420px}
      thead{display:table-header-group} tr{page-break-inside:avoid}
    </style></head><body>
    ${header}
    <div class="cards">
      <div class="card"><div class="l">Sales</div><div class="v">${money(s.netSales)}</div><div class="muted">${s.salesCount} sale${s.salesCount === 1 ? '' : 's'} · ${s.totalUnitsSold} items</div></div>
      <div class="card"><div class="l">Profit on sales</div><div class="v" style="color:#047857">${money(s.grossProfit)}</div><div class="muted">${pct(s.grossProfit, s.netSales)} of sales</div></div>
      <div class="card"><div class="l">Shop expenses</div><div class="v">${money(s.expenses)}</div></div>
      <div class="card"><div class="l">Net profit</div><div class="v" style="color:${s.netProfit < 0 ? '#b91c1c' : '#1d4ed8'}">${money(s.netProfit)}</div></div>
    </div>
    <h2>Profit and loss</h2>
    <table class="pl"><tbody>${pl}</tbody></table>
    ${daysTable}
    <h2>Items sold</h2>
    <table>
      <thead><tr><th>Time</th><th>Item</th><th class="r">Qty</th><th class="r">Sale price</th><th class="r">Discount</th><th class="r">Purchase cost</th><th class="r">Extra cost</th><th class="r">Profit</th></tr></thead>
      <tbody>${sold || '<tr><td colspan="8" style="text-align:center;padding:12px">No items sold in this period.</td></tr>'}</tbody>
    </table>
    ${expenses}
    </body></html>
  `)
}
