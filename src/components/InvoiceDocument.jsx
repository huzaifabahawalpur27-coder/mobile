import { forwardRef, useMemo } from 'react'
import { qrMatrix, qrSvgPath } from '../utils/qrMatrix'

/*
 * Customer bill (sale or phone exchange) as shown on the public invoice page.
 * A printed/PDF document: literal hex colours on white paper in every theme (also keeps
 * html2canvas, which cannot parse oklch theme colours, able to capture the warranty card).
 * Data comes from buildInvoiceView() so the PDF shows exactly the same numbers.
 */
const CSS = `
.ivx { --ink:#131b18; --muted:#5e6c67; --line:#e1e7e4; --tint:#f4f7f6; --accent:#0d6a5a;
  --ok:#0f7a4f; --ok-soft:#e4f4eb; --due:#925500; --due-soft:#fdf0d8;
  background:#ffffff; color:var(--ink); font-family:'Plus Jakarta Sans', system-ui, 'Segoe UI', sans-serif;
  font-size:13.5px; line-height:1.5; border-radius:14px; border:1px solid #e2e8f0;
  box-shadow:0 1px 2px rgba(0,0,0,.05); padding:24px; display:grid; gap:18px; }
.ivx * { box-sizing:border-box; }
.ivx-mono { font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.ivx-head { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; padding-bottom:16px; border-bottom:2px solid var(--ink); }
.ivx-brand { display:flex; gap:12px; align-items:center; min-width:0; }
.ivx-logo { width:48px; height:48px; border-radius:10px; flex:none; display:grid; place-items:center; overflow:hidden;
  background:var(--accent); color:#fff; font-weight:800; font-size:17px; }
.ivx-logo img { width:100%; height:100%; object-fit:contain; background:#fff; }
.ivx-shop { font-weight:800; font-size:20px; line-height:1.15; letter-spacing:-0.01em; overflow-wrap:anywhere; }
.ivx-meta { color:var(--muted); font-size:12.5px; overflow-wrap:anywhere; }
.ivx-doc { display:grid; gap:2px; justify-items:end; text-align:right; }
.ivx-kind { font-size:11px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; color:var(--accent); }
.ivx-no { font-weight:700; font-size:18px; }
.ivx-date { color:var(--muted); font-size:12.5px; }
.ivx-status { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; border-radius:9px; padding:10px 14px; font-weight:700; }
.ivx-status small { font-weight:500; font-size:12.5px; }
.ivx-status.ok { background:var(--ok-soft); color:var(--ok); }
.ivx-status.due { background:var(--due-soft); color:var(--due); }
.ivx-parties { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px 16px; margin:0; }
.ivx-parties dt { font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:700; }
.ivx-parties dd { margin:2px 0 0; font-weight:600; overflow-wrap:anywhere; }
.ivx-label { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; color:var(--muted); }
.ivx-devices { display:grid; gap:10px; }
.ivx-two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.ivx-col { display:grid; gap:8px; align-content:start; min-width:0; }
.ivx-card { border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:grid; gap:8px; min-width:0; }
.ivx-card-top { display:flex; justify-content:space-between; gap:12px; align-items:baseline; flex-wrap:wrap; }
.ivx-name { font-weight:700; font-size:15px; overflow-wrap:anywhere; }
.ivx-amount { font-weight:700; white-space:nowrap; }
.ivx-amount small { font-family:'Plus Jakarta Sans', system-ui, sans-serif; color:var(--muted); font-size:11.5px; font-weight:500; margin-right:5px; }
.ivx-chips { display:flex; gap:6px; flex-wrap:wrap; }
.ivx-chip { font-size:12px; border-radius:6px; padding:1px 8px; font-weight:600; }
.ivx-chip.plain { border:1px solid var(--line); color:var(--muted); font-weight:500; }
.ivx-chip.new { background:#e4f4eb; color:#0f6a45; }
.ivx-chip.used { background:#edf0f5; color:#3b4862; }
.ivx-chip.pta { background:#e2f0ec; color:#0b5c4e; }
.ivx-chip.nonpta { background:#fbe9e7; color:#8f2d1f; }
.ivx-imeis { display:grid; gap:3px; background:var(--tint); border-radius:8px; padding:8px 10px; }
.ivx-imei { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.ivx-imei span { font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:700; min-width:48px; }
.ivx-imei code { font-size:14px; letter-spacing:.02em; user-select:all; }
.ivx-foot { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,300px); gap:18px; align-items:start; }
.ivx-verify { display:flex; gap:12px; align-items:center; border:1px dashed #cfd8d4; border-radius:10px; padding:10px 12px; min-width:0; }
.ivx-verify svg { width:92px; height:92px; flex:none; display:block; }
.ivx-verify p { margin:0; font-size:12px; color:var(--muted); min-width:0; }
.ivx-verify b { color:var(--ink); font-size:13px; display:block; margin-bottom:2px; }
.ivx-verify code { font-size:11px; overflow-wrap:anywhere; color:var(--ink); }
.ivx-totals { width:100%; border-collapse:collapse; }
.ivx-totals td { padding:5px 0; vertical-align:baseline; }
.ivx-totals td:last-child { text-align:right; white-space:nowrap; }
.ivx-totals tr.muted td { color:var(--muted); }
.ivx-totals tr.net td { border-top:1px solid var(--ink); padding-top:9px; font-weight:800; font-size:15.5px; }
.ivx-totals tr.bal td { color:var(--due); font-weight:700; }
.ivx-settle { border-radius:10px; background:var(--tint); padding:12px 14px; display:grid; gap:6px; }
.ivx-eq { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:baseline; font-size:14px; }
.ivx-eq b { font-size:16px; }
.ivx-who { font-weight:700; }
.ivx-who.ok { color:var(--ok); }
.ivx-who.due { color:var(--due); }
.ivx-warranty { background:#fffaea; border:1px solid #e8cf86; border-radius:10px; padding:12px 16px 14px; color:#463710; display:grid; gap:4px; }
.ivx-warranty-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
.ivx-warranty-head b { font-size:12.5px; letter-spacing:.05em; }
.ivx-warranty-head span { font-size:11px; color:#6b5a2a; }
.ivx-warranty-body { font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Urdu Typesetting',Tahoma,serif; direction:rtl; text-align:right; font-size:14px; line-height:2.2; color:#2f250a; }
.ivx-declare { font-size:11.5px; color:var(--muted); border-top:1px solid var(--line); padding-top:10px; margin:0; }
.ivx-bottom { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; font-size:11.5px; color:var(--muted); border-top:1px solid var(--line); padding-top:12px; }
@media (max-width: 640px) {
  .ivx { padding:16px; gap:16px; }
  .ivx-doc { justify-items:start; text-align:left; }
  .ivx-parties { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .ivx-two, .ivx-foot { grid-template-columns:minmax(0,1fr); }
}
@media print {
  .ivx { border:none; box-shadow:none; padding:0; border-radius:0; }
  .ivx-card, .ivx-warranty, .ivx-verify, .ivx-settle { break-inside: avoid; }
}
`

function DeviceCard({ device }) {
  return (
    <article className="ivx-card">
      <div className="ivx-card-top">
        <div className="ivx-name">{device.name}</div>
        <div className="ivx-amount ivx-mono"><small>{device.amountLabel}</small>{device.amountText}</div>
      </div>
      {device.chips.length > 0 && (
        <div className="ivx-chips">
          {device.chips.map((chip, i) => <span key={i} className={`ivx-chip ${chip.tone}`}>{chip.text}</span>)}
        </div>
      )}
      {device.imeis.length > 0 && (
        <div className="ivx-imeis">
          {device.imeis.map(row => (
            <div className="ivx-imei" key={row.label}><span>{row.label}</span><code className="ivx-mono">{row.value}</code></div>
          ))}
        </div>
      )}
    </article>
  )
}

function VerifyBox({ url }) {
  const matrix = useMemo(() => qrMatrix(url), [url])
  const path = useMemo(() => qrSvgPath(matrix), [matrix])
  return (
    <div className="ivx-verify">
      {matrix && (
        <svg viewBox={`-2 -2 ${matrix.size + 4} ${matrix.size + 4}`} role="img" aria-label="QR code that opens this bill online" shapeRendering="crispEdges">
          <rect x="-2" y="-2" width={matrix.size + 4} height={matrix.size + 4} fill="#ffffff" />
          <path d={path} fill="#131b18" />
        </svg>
      )}
      <p>
        <b>Verify this bill</b>
        {matrix ? 'Scan the code or open' : 'Open'}<br />
        <code className="ivx-mono">{String(url || '').replace(/^https?:\/\//, '')}</code>
      </p>
    </div>
  )
}

const InvoiceDocument = forwardRef(function InvoiceDocument({ view }, warrantyRef) {
  const { shop } = view
  return (
    <div className="ivx">
      <style>{CSS}</style>

      <header className="ivx-head">
        <div className="ivx-brand">
          <div className="ivx-logo" aria-hidden={shop.logo ? undefined : 'true'}>
            {shop.logo ? <img src={shop.logo} alt={shop.name} crossOrigin="anonymous" /> : shop.initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="ivx-shop" style={{ margin: 0 }}>{shop.name}</h1>
            <div className="ivx-meta">{[shop.address, shop.phone].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="ivx-doc">
          <div className="ivx-kind">{view.docLabel}</div>
          <div className="ivx-no ivx-mono">{view.billNo}</div>
          <div className="ivx-date">{view.date}</div>
        </div>
      </header>

      <div className={`ivx-status ${view.status.tone}`} role="status">
        <span>{view.status.title}</span>
        <small>{view.status.detail}</small>
      </div>

      <dl className="ivx-parties">
        {view.parties.map(p => (
          <div key={p.label} style={{ minWidth: 0 }}><dt>{p.label}</dt><dd>{p.value}</dd></div>
        ))}
      </dl>

      {!view.isExchange ? (
        <section className="ivx-devices">
          <span className="ivx-label">{view.devicesLabel}</span>
          {view.devices.map((d, i) => <DeviceCard key={i} device={d} />)}
        </section>
      ) : (
        <section className="ivx-two">
          <div className="ivx-col">
            <span className="ivx-label">Given to customer</span>
            {view.given.map((d, i) => <DeviceCard key={i} device={d} />)}
          </div>
          <div className="ivx-col">
            <span className="ivx-label">Received from customer (trade-in)</span>
            {view.received.map((d, i) => <DeviceCard key={i} device={d} />)}
          </div>
        </section>
      )}

      <div className="ivx-foot">
        <VerifyBox url={view.verifyUrl} />
        {!view.isExchange ? (
          <table className="ivx-totals">
            <tbody>
              {view.totals.map(row => (
                <tr key={row.label} className={row.kind}><td>{row.label}</td><td className="ivx-mono">{row.value}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ivx-settle">
            <span className="ivx-label">Settlement</span>
            <div className="ivx-eq ivx-mono">
              <span>{view.settlement.sale}</span><span>-</span><span>{view.settlement.trade}</span><span>=</span><b>{view.settlement.result}</b>
            </div>
            <div className={`ivx-who ${view.settlement.whoTone}`}>{view.settlement.who}</div>
          </div>
        )}
      </div>

      {view.warrantyLines.length > 0 && (
        <section className="ivx-warranty" ref={warrantyRef}>
          <div className="ivx-warranty-head"><b>WARRANTY TERMS</b><span>{view.warrantyScope}</span></div>
          <div className="ivx-warranty-body" lang="ur">
            {view.warrantyLines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </section>
      )}

      {view.declaration && <p className="ivx-declare">{view.declaration}</p>}

      <footer className="ivx-bottom">
        <span>Computer-generated bill {view.billNo}. No signature needed.</span>
        <span>Thank you for your trust · {shop.name}</span>
      </footer>
    </div>
  )
})

export default InvoiceDocument
