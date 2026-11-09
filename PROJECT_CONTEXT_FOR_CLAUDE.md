# EdgeX Mobile POS — Full System & Invoice Architecture Context

> **Audience**: AI Assistant (Claude / Anthropic)  
> **Purpose**: Complete context, architectural map, database schemas, workflow explanations, recent bug fixes, and critical operational constraints for the EdgeX Mobile POS application.

---

## 1. Project Overview & Business Domain

**EdgeX POS** is a high-volume retail Point of Sale (POS), mobile phone inventory management, phone trade-in/exchange, and digital invoicing suite tailored for Pakistani mobile and smartphone retail stores.

### Key Business Realities Handled
1. **Serialized Phone Inventory**: Every smartphone has unique `IMEI_1` and optional `IMEI_2` (Dual SIM), storage capacity (e.g. `128GB`, `256GB`), color, physical condition (`New`, `Used / Pre-Owned`), and Pakistan Telecommunication Authority status (`Official PTA Approved`, `Non-PTA`, `CPID Approved`, `JV`).
2. **Phone Trade-Ins & Exchanges**: Customers exchange their old phone for a new one. The transaction simultaneously registers an incoming purchase (trade-in credit) and an outgoing sale with a net settlement.
3. **Bilingual Invoices (English + Urdu Nastaleeq)**: Store receipts require standard English tabular data alongside authentic Urdu Nastaleeq warranty terms (دکان کی وارنٹی شرائط) regarding LCDs, dead power-off risks, and exchange return windows.
4. **Digital Public Invoice URLs**: Every completed sale and exchange receives an unguessable web link (e.g., `/invoice/INV-JNXKG8DN`) shared with customers via WhatsApp or QR codes.
5. **Offline-First Capabilities**: Runs offline in browsers using Dexie.js (IndexedDB) with a 30-second interval sync service pushing to Supabase.

---

## 2. Technical Stack

- **Frontend Core**: React 18, Vite 5, Tailwind CSS 4, React Router 6, Lucide React icons.
- **Client Storage & Offline**: Dexie.js (`src/services/db.js`), LocalStorage (shop-scoped keys like `shop_settings_${shopId}`).
- **Backend & Cloud Database**: Supabase PostgreSQL with Row Level Security (RLS) policies and `SECURITY DEFINER` RPCs (`src/services/supabase.js`).
- **PDF & Canvas Engine**: jsPDF, `jspdf-autotable`, HTML5 Canvas 2D context (`loadPdfLibraries` dynamic import).
- **Git Remote Constraint**: 
  - Remote **`mobile`** (`https://github.com/huzaifabahawalpur27-coder/mobile.git`) is the PRIMARY upstream.
  - **CRITICAL**: Always push to `mobile main`. **NEVER** push to `origin`.

---

## 3. Core Database Schemas & Models

### A. `sales` Table
- `id` (INTEGER, Primary Key, Auto-increment sequential: e.g., `156`)
- `invoice_number` (VARCHAR): Unguessable public token (e.g., `INV-JNXKG8DN`).
- `customer_id` (INTEGER / NULL): Foreign key to `customers.id`.
- `customer_name` (TEXT): Customer display name (fallback: `'Valued Customer'`).
- `customer_phone` (TEXT): Customer mobile number (e.g., `03012616367`).
- `total_amount` (NUMERIC): Subtotal before discount.
- `discount` (NUMERIC): Discount applied in PKR.
- `net_amount` (NUMERIC): Final payable total (`total_amount - discount`).
- `paid_amount` / `amount_paid` (NUMERIC): Cash or digital amount collected.
- `payment_type` / `payment_method` (TEXT): `cash`, `online`, `split`, etc.
- `payment_details` (JSONB): Breakdown of split accounts/methods.
- `shop_id` (INTEGER): Multi-tenant isolation shop identifier.
- `created_at` (TIMESTAMPTZ): ISO timestamp.
- `status` (TEXT): `'completed'`, `'draft'`, `'cancelled'`.

### B. `sale_items` Table
- `id` (INTEGER, Primary Key)
- `sale_id` (INTEGER): Foreign key to `sales.id`.
- `phone_id` (INTEGER / NULL): Foreign key to `phones.id` (if serialized phone).
- `product_id` (INTEGER / NULL): Foreign key to accessories/products.
- `product_name` (TEXT): Device/product title (e.g. `Apple iPhone 18 Pro Max 256GB Cosmic Orange Titanium`).
- `quantity` (INTEGER): Normally `1` for serialized phones.
- `unit_price` / `price` (NUMERIC): Sale price per unit.
- `total_price` / `line_total` / `subtotal` (NUMERIC): `quantity * unit_price`.
- `cost_price` (NUMERIC): FIFO unit cost basis.
- `imei_snapshot` (TEXT or JSONB):
  ```json
  {
    "brand": "Apple",
    "model": "iPhone 18 Pro Max",
    "color": "Cosmic Orange Titanium",
    "storage": "256GB",
    "condition": "used",
    "pta_status": "approved",
    "imei_1": "78998789",
    "imei_2": null
  }
  ```

### C. `phones` Table
- `id` (INTEGER, Primary Key)
- `shop_id` (INTEGER)
- `brand` (TEXT), `model` (TEXT), `storage` (TEXT), `color` (TEXT)
- `imei_1` (TEXT, UNIQUE), `imei_2` (TEXT)
- `condition` (TEXT: `'new'`, `'used'`)
- `pta_status` (TEXT: `'approved'`, `'non_pta'`, `'cpid'`)
- `cost_price` (NUMERIC), `selling_price` (NUMERIC)
- `status` (TEXT: `'in_stock'`, `'sold'`, `'exchanged'`)

### D. `exchanges` & `exchange_items`
- `exchanges`: `id`, `exchange_number` (token), `sale_amount`, `trade_in_credit`, `settlement_amount`, `settlement_direction` (`customer_pays` vs `shop_pays`).
- `exchange_items`: `item_direction` (`incoming_trade_in` vs `outgoing_sale`), `product_name`, `imei_1`, `imei_2`, `condition`, `pta_status`, `assessed_value`, `subtotal`.

---

## 4. The Public Invoice Architecture (`src/pages/PublicInvoice.jsx`)

### Dual Invoice Number Design
- **URL Route**: `/invoice/:id` (e.g., `/invoice/INV-JNXKG8DN`).
  - The URL contains the secure random token to strictly prevent URL enumeration (IDOR attacks).
- **Displayed Document Number**: `#INV-156` (from sequential `sales.id` = `156`).
  - In shop receipts, ledger records, and customer verification, the bill MUST show the shop's real sequential invoice number `#INV-156`, while keeping the unguessable URL token in the address bar.
  - Calculated as:
    ```javascript
    const displayInvoiceNo = invoice.actual_invoice_no ||
      (invoice.id ? (isExchange ? `EXC-${invoice.id}` : `INV-${invoice.id}`) : (invoice.invoice_no || id))
    ```

### 4-Tier Data Fetching Fallback Pipeline
1. **Tier 1 (Direct Supabase REST Sale)**: Fetches `sales` and `sale_items(*)` matching `candidateNumbers = [id, cleanId, 'INV-' + cleanId]`. Direct query bypasses stale schema caches.
2. **Tier 2 (Direct Supabase REST Exchange)**: Fetches `exchanges` and `exchange_items(*)`.
3. **Tier 3 (Supabase RPC `get_public_invoice`)**: Public `SECURITY DEFINER` function that returns aggregated JSONB with shop branding and customer records.
4. **Tier 4 (Dexie IndexedDB)**: Offline local fallback for cashiers or customers on the store's devices.

### Visual Document Hierarchy
The page and PDF share an identical, cohesive template structure:
1. **Store Header**:
   - Store name (bold slate-900), shop address with 📍, phone with 📞.
   - Right: Emerald badge pill (`SALES INVOICE`), `#INV-156` (bold mono), and formatted date.
2. **Customer & Payment Grid (4 Columns)**:
   - `CUSTOMER NAME`: Babar
   - `MOBILE NUMBER`: `+03012616367` (or Walk-in)
   - `PAYMENT METHOD`: `CASH`
   - `PAYMENT STATUS`: `PAID` (bold emerald `#047857`) or `Balance: Rs. X`
3. **Items & Purchased Devices Table**:
   - `#` | `Description / Item Details` | `Qty` | `Unit Price` | `Total Amount`
   - **Line 1**: Device Name (bold, clean title).
   - **Line 2**: `📱 IMEI: 78998789` (isolated, distinct monospace font).
   - **Line 3**: `Specs: 256GB, Cosmic Orange Titanium`.
   - **Line 4**: `Status: Used / Pre-Owned • Official PTA Approved` (emerald status marker).
4. **Financial Summary Box (Right-Aligned)**:
   - `Total Amount`: Rs. 330,000
   - *(Optional Trade-in Credit / Discount)*
   - Horizontal separator line with dedicated vertical spacing.
   - `Net Total`: Rs. 330,000 (bold emerald `#047857`).
   - `Amount Paid`: Rs. 330,000.
   - *(Optional Remaining Balance)*
5. **Urdu Nastaleeq Warranty Certificate (Yellow Box)**:
   - Card styling: `#fffdf5` background, `#fcd34d` border, rounded corners.
   - Top Header: Shield icon 🛡️, `Official Warranty Terms (دکان کی وارنٹی شرائط)`, `WARRANTY` badge.
   - Urdu text lines in compact Nastaleeq typography.
   - Bottom Bar: `آپ کے اعتماد اور تعاون کا بہت بہت شکریہ! 🤝` and store name.
6. **Footer Disclaimer**:
   - Computerized digital invoice verification statement and system timestamp.

---

## 5. PDF Generation Mechanics (`handleDownloadPDF`)

### Why Hybrid Vectorization + Canvas Flattening is Used
- Standard jsPDF built-in fonts (`helvetica`, `times`) use **WinAnsi (Latin-1)** character encoding.
  - Raw Urdu Nastaleeq text passed into `pdf.text()` causes catastrophic mojibake character corruption (`ñ Ô LCD...`).
  - Unicode symbols like `✓` (checkmarks) map to `'` (apostrophes) and induce letter-spacing bugs (rendering `Paid ✓` as `P a i d '` and `✓ SALES INVOICE` as `' SALES INVOICE`).
- Full-page DOM cloning with `html2canvas` often failed due to:
  - Unsupported CSS color functions (`oklch()`).
  - Negative off-screen coordinate clipping (`left: -9999px` producing `canvas.width === 0`).
  - Browser print dialog hijacking on click.

### The Solution (Engineered & Verified)
1. **Vectorized English Elements**:
   - All store metadata, customer grid, item tables (`jspdf-autotable`), and totals cards are vectorized using pure native jsPDF methods.
   - Checkmark characters are sanitized to standard Latin strings (`PAID` and `SALES INVOICE`).
2. **Pure HTML5 Canvas 2D Urdu Flattener**:
   - An off-screen HTML5 `<canvas>` element renders the yellow warranty certificate using `"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq"` with exact pixel coordinates.
   - Height formula: `topHeaderHeight (44) + urduPaddingTop (26) + urduHeight + footerPadding (52)`.
   - Border stroke: `width - 6, height - 6`.
   - The canvas exports `toDataURL('image/png')` and is inserted into the PDF using `pdf.addImage()`.
   - Natural aspect ratio: `warrantyHeight = contentWidth * warrantyImgRatio`.
3. **No Digits on Line**:
   - In the financial totals card, the divider line is drawn above `Net Total:` at `lineY = rowY - 1.8`, followed by `rowY += 4.5`. This guarantees `~3.9mm` of vertical white space so numbers and text never cross the divider line.
4. **Natural Page Placement**:
   - The warranty certificate sits `8mm` below the totals box (`currentY += totalsBoxHeight + 8`). If content approaches the bottom margin, it cleanly advances to the next page via `pdf.addPage()`.

---

## 6. Recent Work & Commit History

| Commit | Summary |
|---|---|
| `72a3c4f` | Vectorized invoice layout and flattened Urdu Nastaleeq warranty card into high-DPI image. |
| `ad1342a` | Displayed actual sequential invoice number (`#INV-156`), matched online visual bill template, and positioned compact warranty certificate at bottom. |
| `35f55ac` | Resolved PDF warranty canvas text clipping, eliminated Latin-1 checkmark artifacts (`' SALES INVOICE`, `P a i d '`), and restructured item IMEI table layout. |
| `7f3f956` | Fixed divider line strike-through ("digits on line") in totals box and rendered distinct device, IMEI, specs, and phone status lines across web and PDF views. |

---

## 7. Critical Operational Guidelines for Future Work

1. **Remote Push Rule**:
   - Push ONLY to `mobile main`:
     ```bash
     git push mobile main
     ```
   - NEVER push to `origin`.
2. **Offline Data Persistence**:
   - Do not wipe or casually refactor `localStorage` keys (`shop_settings_${shopId}`, `shop_name_${shopId}`, `shop_logo_${shopId}`).
   - Do not break offline fallback in `src/pages/PublicInvoice.jsx` or the sync queue in `src/services/syncService.js`.
3. **Never Expose Privileged Credentials**:
   - `VITE_*` environment variables in Vite bundles are publicly readable in the client. Privileged operations must remain behind Supabase RLS and `SECURITY DEFINER` RPCs.
4. **Compilation Verification**:
   - Always run `npm run build` after modifications. Verify that PWA precache entries generate cleanly and the build exits with code `0`.
   - Run `npx eslint <path>` on modified files to verify zero lint errors.
5. **No `window.print()` Hijacking on Download**:
   - Clicking **Download PDF** must directly save the `.pdf` file via jsPDF `pdf.save(filename)`. It must NEVER trigger the browser's `window.print()` print dialog.
