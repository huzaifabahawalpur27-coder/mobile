# EdgeX POS — Shop Owner & Store Manager Workflow Guide 📱💼

Welcome to **EdgeX POS (Multipurpose Mobile & Retail Point of Sale)**. This guide explains every daily workflow, shortcut, and advanced feature designed to help you run your mobile phone and retail business smoothly, track inventory with precision, collect outstanding payments, and boost customer retention through WhatsApp automation.

---

## 📑 Table of Contents
1. [System Access & Navigation](#1-system-access--navigation)
2. [Dashboard & Store Asset Wealth](#2-dashboard--store-asset-wealth)
3. [Point of Sale (POS) Billing & Fast Checkout](#3-point-of-sale-pos-billing--fast-checkout)
4. [WhatsApp Invoices & Phone Thank-You Messages](#4-whatsapp-invoices--phone-thank-you-messages)
5. [Products & Stock Inventory (Barcodes & IMEIs)](#5-products--stock-inventory-barcodes--imeis)
6. [Phone Purchases & Used Mobile Buy-Back System](#6-phone-purchases--used-mobile-buy-back-system)
7. [Customer Ledger & Udhaar (Khata) Management](#7-customer-ledger--udhaar-khata-management)
8. [WhatsApp Marketing & Promotional Broadcasts](#8-whatsapp-marketing--promotional-broadcasts)
9. [Suppliers & Inventory Procurement](#9-suppliers--inventory-procurement)
10. [Reports & Financial Profit/Loss Statement](#10-reports--financial-profitloss-statement)
11. [Expenses & Bank Accounts](#11-expenses--bank-accounts)
12. [Offline Mode & Automatic Cloud Sync](#12-offline-mode--automatic-cloud-sync)

---

## 1. System Access & Navigation

- **Web & Desktop Access**: Open the POS in any modern browser (Chrome, Edge, Safari) or install it as a standalone desktop/mobile app via the PWA prompt ("Install EdgeX POS").
- **Apple-Inspired Interface**: Clean, clutter-free design with high-contrast text and responsive layout.
- **Theme Modes**: Toggle between **Light**, **Apple Dark**, or **Classic** mode using the theme button in the top navigation bar.
- **Compact UI Mode**: For smaller laptop screens or POS counter terminals, click **Compact UI** to maximize visible screen space.
- **User Roles & Security**:
  - `Admin`: Full control over settings, costs, profits, staff accounts, and reports.
  - `Manager`: Access to POS, inventory, purchases, and ledgers.
  - `Cashier`: Streamlined access focused on POS billing, customer creation, and receipts.

---

## 2. Dashboard & Store Asset Wealth

The main dashboard provides an instant executive snapshot of your shop's health:

1. **Top Metric Cards**:
   - **Today's Sales**: Total revenue collected today and comparison with yesterday.
   - **Monthly Sales**: Cumulative turnover for the current month.
   - **Net Profit**: Gross sales minus product cost and shop expenses.
   - **Active Receivables / Dues**: Total unpaid customer credit (Udhaar).
2. **Stock Valuation & Asset Wealth Card**:
   - **Total Stock Wealth (At Cost)**: Calculates the exact liquid value of all items currently on your shelves and display counters.
   - **Phones Valuation**: Total purchase cost of mobile phones currently in stock.
   - **Accessories & General Goods**: Total purchase cost of standard retail items.
   - **Direct Navigation**: Click on device or accessories valuation to jump straight to filtered inventory views.
3. **Recent Invoices & Low Stock Radar**:
   - Real-time list of today's sales.
   - Instant warning banner for items reaching minimum reorder thresholds.

---

## 3. Point of Sale (POS) Billing & Fast Checkout

The POS screen is optimized for high-speed counter transactions with keyboard and barcode support.

### Step-by-Step Checkout Flow:
1. **Add Items to Cart**:
   - **Barcode / IMEI Scanner**: Scan any phone IMEI (15 digits) or product barcode directly into the search bar. The matching item will be added to the cart instantly.
   - **Product Search**: Type the device name (e.g., `iPhone 13 128GB` or `Samsung A54`) to filter products.
   - **Quick Category Filter**: Click category chips (e.g., *Smartphones*, *Chargers*, *Airpods*, *Cables*) to browse.
2. **Cart Customization**:
   - Adjust quantity (`+` / `-`).
   - Modify unit price or add line-item / overall invoice discount (Percentage `%` or Fixed `Rs`).
3. **Select or Create Customer**:
   - Leave as **Walk-in Customer** for quick anonymous sales.
   - Or click **Select Customer** to link an existing regular customer.
   - Type a new customer's name and mobile number on the fly to save them instantly to your ledger.
4. **Choose Payment Tender**:
   - **Cash**: Enter received amount; the system calculates exact change.
   - **Bank / Card**: Route payment to a specific bank account or POS terminal.
   - **Credit / Udhaar**: Specify a partial down payment; the remaining balance is automatically posted to the customer's Khata account.
5. **Complete & Print**:
   - Click **Complete Sale**.
   - The invoice modal appears with **Thermal 80mm / 58mm Receipt** or **A4 / A5 Laser Invoice** print buttons.

---

## 4. WhatsApp Invoices & Phone Thank-You Messages

EdgeX POS eliminates paper costs and delights customers with automated WhatsApp messaging:

### 1. Invoice Bill Summary via WhatsApp
Immediately upon completing a sale, click the **💬 WhatsApp** button in the receipt modal:
- Automatically formats Pakistan numbers (converts `0300...` to international `92300...`).
- Pre-fills a message containing:
  ```text
  Hello [Customer Name], thank you for shopping at EdgeX POS Store! 
  Your bill summary for Invoice #1024 is Rs. 71,000.
  📱 Model: iPhone 13 Pro 128GB Graphite
  📅 Date: 13 Oct 2026
  Thank you for your business!
  ```
- Also shares a PDF receipt copy directly via Web Share API where supported.

### 2. Phone Purchase Thank-You & Warranty Note
When the transaction includes a mobile phone, a dedicated **🎉 Send Phone Thank-You Message (WhatsApp)** button appears:
- Includes customer greeting, invoice summary, device model, and sale date.
- Adds official warranty / 7-day checking warranty terms.
- Offers free data transfer, glass protection, and setup support to build lasting customer loyalty.

---

## 5. Products & Stock Inventory (Barcodes & IMEIs)

EdgeX POS handles mobile shop inventory through two distinct item classes:

### A. Serialized Mobile Phones (Unique IMEI Tracking)
- Every phone is tracked by its unique **IMEI-1** and optional **IMEI-2**.
- Records device **Brand**, **Model**, **Color**, **Storage** (e.g., 128GB, 256GB), **Condition** (*Brand New* vs. *Used/Pre-owned*), and **PTA Status** (*PTA Approved*, *Non-PTA*, *CPID*, *JV / Gevey*).
- Status auto-updates: When sold in POS, its status switches to `Sold`. If returned or bought back, it returns to `In Stock`.

### B. Standard Retail Products (Accessories & Spare Parts)
- Tracked by quantity (e.g., 50x 20W Fast Chargers, 30x Tempered Glass).
- Supports manufacturer barcodes or generated barcode labels.
- Set **Cost Price**, **Resale Price**, and **Low Stock Threshold**.

### Search & Filtering
- In both **Products** and **Stock Inventory**, the universal search bar lets you find devices by **IMEI number**, **model name**, or **barcode**.

---

## 6. Phone Purchases & Used Mobile Buy-Back System

When purchasing phones from distributors or buying back used devices from walk-in customers:

### The Used Mobile Buy-Back Workflow:
1. Navigate to **Purchases** (`/purchases`) and select the **📱 Purchase Mobile Phones** tab.
2. In the **IMEI-1** field, scan or type the 15-digit IMEI.
3. **Instant Auto-Fetch**:
   - If the phone was previously sold by your shop, the system immediately recognizes it!
   - **Buy-Back History Banner**: Displays a banner showing:
     - Original Buyer Name
     - Date previously sold
     - Previous invoice number
     - Original selling price
   - **Auto-Populated Specs**: Brand, model, color, storage, PTA status, and IMEI-2 are automatically filled in.
   - **Condition**: Automatically set to `Used`.
   - **1-Click "Set as Seller"**: Click the button in the banner to automatically assign the original customer as the supplier/seller of this buy-back!
4. Enter your negotiated buy-back cost and intended resale price, then click **Add Device to Batch**.
5. Save the purchase batch. The phone is back in your stock inventory ready to be sold again!

---

## 7. Customer Ledger & Udhaar (Khata) Management

Never lose track of customer credit or market balances:

1. **Customer Directory** (`/customers`):
   - View all registered customers, contact numbers, and total balance due.
2. **Detailed Customer Ledger** (`/customers/:id`):
   - Complete chronological history of all invoices and payments.
   - Shows debit, credit, and running balance.
   - **Receive Payment Button**: Record cash or bank recovery; automatically generates a payment receipt voucher.
   - **Export Ledger PDF**: Generate a branded statement to print or send to the customer.

---

## 8. WhatsApp Marketing & Promotional Broadcasts

Located under **WhatsApp Messages** (`/whatsapp`):

### 1. Broadcast & Promotional Campaigns
Send promotions to groups of customers without paying for third-party messaging services:
- **Smart Audience Filters**:
  - `All Customers`: Every customer with a valid phone number.
  - `📱 Phone Buyers`: Target customers who previously bought mobile phones (ideal for accessory upselling).
  - `💳 With Debt`: Filter only customers who currently owe money.
- **Quick Campaign Presets**:
  - 📦 *New Stock & Arrivals*: Announce new phone shipments.
  - 🎁 *Special Customer Discount*: Weekly loyalty offers.
  - 📱 *Phone Follow-up Check*: Customer care and warranty check-in.
  - 🤝 *Store Appreciation Note*: Thank-you message.
- **Dynamic Tag Personalization**: Click `+ [Name]`, `+ [Shop Name]`, `+ [Date]`, `+ [Balance]` to automatically customize each message.
- **Live iPhone Preview**: See exactly how the WhatsApp chat bubble will look on a customer's phone.
- **Sequential Dispatch Queue**: Click **Launch WhatsApp Queue** to step through selected recipients one by one with a single click.

### 2. Debt Reminders Tab
- Dedicated view of all debtors.
- Click **Send Reminder** next to any customer to open their chat with a pre-filled balance statement.

---

## 9. Suppliers & Inventory Procurement

1. **Supplier Directory** (`/suppliers`):
   - Maintain records of distributors and wholesalers.
2. **Supplier Ledger** (`/suppliers/:id`):
   - Track credit purchases and payments made to suppliers.
   - Record cheque, cash, or bank transfers.
3. **Stock Reorders via WhatsApp**:
   - In **Stock Inventory**, click **Reorder via WhatsApp** next to any low-stock item to generate a supplier order with product name and suggested quantity.

---

## 10. Reports & Financial Profit/Loss Statement

Located under **Reports** (`/reports`):

1. **Product Sales Analysis (Product-Focused)**:
   - Evaluates sales performance by **Product Name** and **Category** (e.g., Total Units Sold, Total Revenue, Total Cost, Total Gross Profit, Profit Margin %).
   - Easily identify top-performing models and slow-moving items.
2. **Visual Sales & Profit Trends**:
   - Monthly and daily bar charts comparing Gross Sales against Net Profit.
3. **Comprehensive Financial Statement (P&L)**:
   - **Gross Revenue**: Total billings before deductions.
   - **Cost of Goods Sold (COGS)**: Exact inventory cost of sold devices and items.
   - **Gross Margin**: Revenue minus COGS.
   - **Operating Expenses**: Rent, salaries, utilities, tea, etc.
   - **Net Profit**: Final bottom-line profit.
4. **Export Capabilities**:
   - Download any report as an **Excel spreadsheet (.xlsx)** or **PDF document**.

---

## 11. Expenses & Bank Accounts

1. **Shop Expenses** (`/expenses`):
   - Log daily operational costs (Utilities, Staff Salary, Shop Rent, Tea & Refreshments, Repair Tools).
   - Tag expenses to cash drawer or specific bank accounts.
2. **Bank Accounts & Cash Drawer** (`/accounts`):
   - Manage multiple accounts (e.g., Shop Cash Drawer, Meezan Bank, EasyPaisa, JazzCash, HBL).
   - Internal transfers between accounts (e.g., Cash Drawer to Bank Deposit).

---

## 12. Offline Mode & Automatic Cloud Sync

EdgeX POS is engineered with an **Offline-First Architecture**:

- **No Internet Required for Daily Billing**: If your shop's Wi-Fi or broadband disconnects, a green/amber indicator appears in the navigation bar. You can continue scanning barcodes, making sales, and printing receipts without interruption.
- **Local Dexie Database**: All sales, inventory changes, and customer updates are stored securely in browser storage.
- **Automatic Cloud Sync**: As soon as internet connectivity returns, the background sync runner automatically updates your cloud database without any manual action needed.

---

### 💡 Pro Tips for Counter Staff
- **Fast IMEI Entry**: In POS search or Phone Purchase, you can use a USB barcode scanner to read the IMEI barcode on the back of phone boxes.
- **Keyboard Shortcuts**: Press `Tab` and `Enter` to quickly navigate inputs during fast checkout.
- **Quick Customer Registration**: When adding a new customer at the checkout counter, only their Name and Mobile Number are required.

---
*EdgeX POS System Documentation — Prepared for Store Operations & Management.*
