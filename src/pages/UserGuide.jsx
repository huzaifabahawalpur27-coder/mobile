import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, PhoneCall, ShoppingCart, Truck,
  Boxes, Wallet, Users, MessageSquare, CheckCircle2,
  AlertCircle, ArrowRight, ShieldCheck, Search, HelpCircle,
  Clock, RotateCcw, Sparkles
} from 'lucide-react'

export default function UserGuide() {
  const [activeTab, setActiveTab] = useState('custody')
  const [searchQuery, setSearchQuery] = useState('')

  const tabs = [
    { id: 'custody', label: '📱 Phone Custody & Returns', labelUrdu: 'عارضی فون اور کسٹڈی واپسی' },
    { id: 'pos', label: '🧾 POS & WhatsApp Billing', labelUrdu: 'سیل اور واٹس ایپ بلنگ' },
    { id: 'purchases', label: '📦 Purchases & IMEI Stock', labelUrdu: 'خریداری اور نیا سٹاک' },
    { id: 'khata', label: '👥 Customer & Supplier Khata', labelUrdu: 'کھاتہ جات اور ادھار' },
    { id: 'cash_session', label: '💵 Cash Drawer & Shifts', labelUrdu: 'کیش دراز اور شفٹ' },
    { id: 'offline', label: '⚡ Offline Mode & Sync', labelUrdu: 'آف لائن اور سنکنگ' }
  ]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-blue-100">
            <BookOpen size={14} /> EdgeX POS User Manual & Knowledgebase
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Comprehensive Help & User Guides
          </h1>
          <p className="text-blue-100 text-sm sm:text-base max-w-2xl leading-relaxed">
            Step-by-step interactive instructions for shop owners, managers, and cashiers. Learn how to manage temporary phone custody, POS sales, IMEI stock, khata ledgers, and cash shifts.
          </p>
        </div>
        <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-200 custom-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition cursor-pointer flex flex-col items-start ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`text-[10px] font-normal ${activeTab === tab.id ? 'text-blue-100' : 'text-gray-400'}`}>
              {tab.labelUrdu}
            </span>
          </button>
        ))}
      </div>

      {/* Tab 1: Custody & Temp Phone Return */}
      {activeTab === 'custody' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Workflow Overview Card */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 sm:p-6 text-amber-900">
            <div className="flex items-start gap-3">
              <span className="text-2xl">📱</span>
              <div>
                <h2 className="text-lg font-black text-amber-950">
                  What is Phone Custody (عارضی فون / کسٹڈی کیا ہے؟)
                </h2>
                <p className="text-xs sm:text-sm text-amber-800 mt-1 leading-relaxed">
                  In a mobile shop, phones are frequently given out temporarily without an immediate sale—such as giving a device to another market dealer for a customer trial, holding a phone under customer deposit/token, temporary personal testing, or dispatching to a repair lab.
                  <br />
                  <strong>The EdgeX POS custody module locks the phone so it cannot be mistakenly sold to anyone else, while keeping exact track of who took it, when, and any deposit held.</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Step by Step Issuance Guide */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6">
            <h3 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-black">1</span>
              How to Handover / Issue a Phone into Custody (فون کسٹڈی پر دینے کا طریقہ)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-2">
                <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Step A</p>
                <h4 className="font-bold text-gray-800 text-sm">Open Stock Inventory</h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Click <strong>Stock Inventory</strong> in the sidebar, then switch to the <strong>📱 Mobile Phones (IMEI)</strong> tab.
                </p>
                <Link to="/inventory" className="inline-flex items-center gap-1 text-xs text-blue-600 font-bold hover:underline mt-1">
                  Go to Inventory →
                </Link>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-2">
                <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Step B</p>
                <h4 className="font-bold text-gray-800 text-sm">Click "Custody / Issue"</h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Locate the phone in your stock table. In the Actions column, click the <strong>Handover / Custody (👤)</strong> button.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-2">
                <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Step C</p>
                <h4 className="font-bold text-gray-800 text-sm">Fill Handover Details</h4>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Choose the reason (Dealer Checking, Customer Token, Repair, or Personal), enter Recipient Name, Phone, and Token deposit (if any). Click <strong>Assign Custody</strong>.
                </p>
              </div>
            </div>

            {/* Handover Types Breakdown */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
              <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider mb-2">Supported Custody Types:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-900 block">🏪 Dealer Trial</span>
                  <span className="text-gray-500 text-[11px]">Given to another shop/dealer to show a customer.</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-900 block">🔖 Customer Reservation</span>
                  <span className="text-gray-500 text-[11px]">Reserved with token deposit (بیعانہ).</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-900 block">📱 Personal / Staff Use</span>
                  <span className="text-gray-500 text-[11px]">Temporary use by owner or salesperson.</span>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-gray-200">
                  <span className="font-bold text-gray-900 block">🔧 Repair Transit</span>
                  <span className="text-gray-500 text-[11px]">Dispatched to technician or service lab.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Step by Step Return Guide */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6">
            <h3 className="text-base sm:text-lg font-black text-emerald-900 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-black">2</span>
              How to Return a Custody Phone Back to Stock (فون واپس انوینٹری میں ڈالنے کا طریقہ)
            </h3>

            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 text-emerald-950 text-xs sm:text-sm leading-relaxed">
              When the dealer brings the phone back, or the reservation expires, returning it takes just <strong>1 click</strong>:
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">1</div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Find the Phone in Phone Inventory</h4>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Go to <strong>Stock Inventory → 📱 Mobile Phones (IMEI)</strong>. You can use the filter button <strong>"Reserved / Custody"</strong> to immediately view all phones currently out of the shop.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">2</div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Click the Green "Return" Button</h4>
                  <p className="text-xs text-gray-600 mt-0.5">
                    On the phone row (which displays an amber <strong>"Issued"</strong> or <strong>"Reserved"</strong> badge), click the green button labeled <strong>"↩️ Wapas In-Stock Dalein"</strong> (or the return arrow icon).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">3</div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Confirm Return</h4>
                  <p className="text-xs text-gray-600 mt-0.5">
                    A confirmation dialog will appear: <em>"Kya aap [Brand Model] ko wapas In-Stock karna chahte hain?"</em>. Click <strong>OK</strong>.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">4</div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Instant Automatic Updates (خودکار اندراج)</h4>
                  <p className="text-xs text-gray-600 mt-0.5">
                    The system immediately:
                  </p>
                  <ul className="list-disc list-inside text-xs text-gray-600 mt-1 space-y-0.5 ml-2">
                    <li>Updates the phone status back to <span className="font-bold text-emerald-700">"in_stock"</span>.</li>
                    <li>Marks the custody log record as <span className="font-bold text-gray-700">"returned"</span> with timestamp and user id.</li>
                    <li>Records an audit log entry in <span className="font-bold text-gray-700">phone_history</span>.</li>
                    <li>Makes the phone instantly available in POS billing for barcode/IMEI scanning!</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: POS & WhatsApp */}
      {activeTab === 'pos' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6 animate-fadeIn">
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>🧾</span> POS Billing & WhatsApp Invoicing Workflow
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-xl p-4 space-y-2">
              <span className="text-xl">🔍</span>
              <h3 className="font-bold text-gray-900 text-sm">1. Scan Barcode / IMEI or Type Name</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Use your barcode scanner or type any phone IMEI 1, IMEI 2, or product name in the search box. Phones in stock immediately populate the cart with PTA status and warranty info.
              </p>
            </div>

            <div className="border border-gray-200 rounded-xl p-4 space-y-2">
              <span className="text-xl">👥</span>
              <h3 className="font-bold text-gray-900 text-sm">2. Select Customer & Payment Method</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Select an existing customer or quick-add a new one. Choose full cash, bank payment, partial payment, or full credit (Khata). If partial, the remaining balance automatically logs to the customer ledger.
              </p>
            </div>

            <div className="border border-gray-200 rounded-xl p-4 space-y-2">
              <span className="text-xl">🖨️</span>
              <h3 className="font-bold text-gray-900 text-sm">3. Complete Sale & Print Invoice</h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Click <strong>"Complete Purchase & Print"</strong>. The thermal receipt prints with your shop name, logo, IMEI details, return policy footer, and invoice number.
              </p>
            </div>

            <div className="border border-green-200 bg-green-50/50 rounded-xl p-4 space-y-2">
              <span className="text-xl">💬</span>
              <h3 className="font-bold text-green-950 text-sm">4. 1-Click WhatsApp Invoice (نیا فیچر)</h3>
              <p className="text-xs text-green-800 leading-relaxed">
                Click the green <strong>"WhatsApp Bill"</strong> button next to the print button. It instantly opens WhatsApp Web / App with an Asslam o Alaikum greeting, customer name, purchased items, total, previous balance, and your shop contact details!
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Purchases & Stock */}
      {activeTab === 'purchases' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6 animate-fadeIn">
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>📦</span> Phone Purchase & IMEI Inventory Inward
          </h2>
          <div className="space-y-4 text-xs sm:text-sm text-gray-700">
            <p>
              Navigate to <strong>Procurement → Purchases</strong>. Select a supplier and choose the <strong>"📱 Mobile Phones (IMEI)"</strong> panel.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <strong className="block text-gray-900 mb-1">1. IMEI 1 & 2</strong>
                <span>Scan or type IMEI 1 (mandatory) and IMEI 2 (optional). The system prevents duplicate IMEIs.</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <strong className="block text-gray-900 mb-1">2. PTA & Condition</strong>
                <span>Select Official Approved, CPID, Non-PTA, VIP, or Blocked, plus Brand New, Open Box, or Used.</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                <strong className="block text-gray-900 mb-1">3. Bank Deduction</strong>
                <span>If paid via bank account, choose the account to automatically deduct your balance in real-time.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Khata Ledgers */}
      {activeTab === 'khata' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6 animate-fadeIn">
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>👥</span> Customer & Supplier Khata (Ledgers)
          </h2>
          <div className="space-y-3 text-xs sm:text-sm text-gray-700">
            <p>
              EdgeX POS automatically records every credit sale in the <strong>Customer Ledger</strong> and every supplier purchase in the <strong>Supplier Ledger</strong>.
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-2">
              <li><strong>Record Payment:</strong> Open the customer ledger and click "Record Payment". Enter the amount, payment mode (Cash/Bank), and receipt note.</li>
              <li><strong>WhatsApp Balance Reminder:</strong> Click the WhatsApp icon on the ledger page to send a polite Urdu payment reminder with outstanding balance.</li>
              <li><strong>Ledger PDF Statement:</strong> Export a branded PDF or Excel statement for any date range with running debit/credit balance.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tab 5: Cash Drawer */}
      {activeTab === 'cash_session' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6 animate-fadeIn">
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>💵</span> Cash Drawer Sessions & Shift Management
          </h2>
          <div className="space-y-3 text-xs sm:text-sm text-gray-700">
            <p>
              Maintain accurate cash accountability between cashiers:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-1">Open Drawer Shift</h3>
                <p className="text-xs text-gray-600">
                  Enter starting opening cash in the drawer. The system tracks all cash sales, cash received from khata, and cash shop expenses.
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-1">Close Shift & Audit Variance</h3>
                <p className="text-xs text-gray-600">
                  Count physical drawer cash at the end of the shift. EdgeX POS compares physical cash with expected cash and calculates variance (+ / -).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Offline PWA */}
      {activeTab === 'offline' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6 animate-fadeIn">
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <span>⚡</span> Offline PWA & Seamless Background Sync
          </h2>
          <div className="space-y-3 text-xs sm:text-sm text-gray-700">
            <p>
              Even when there is no internet connection in the market:
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-2">
              <li>You can continue making POS sales and printing invoices without interruption.</li>
              <li>All sales, payments, and stock changes are saved in the browser's high-speed local database (Dexie/IndexedDB).</li>
              <li>As soon as the internet reconnects, the background sync engine seamlessly uploads queued entries to Supabase.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Quick Support Call Footer */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900 text-sm">Need Personalized Assistance? (براہ راست مدد)</h3>
          <p className="text-xs text-gray-500 mt-0.5">Our support team and developer are available via phone and WhatsApp.</p>
        </div>
        <div className="flex gap-2">
          <a
            href="https://wa.me/923012616367?text=Asslam%20o%20Alaikum,%20mujhe%20EdgeX%20POS%20mein%20rehnumai%20chahiye"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <span>💬</span> WhatsApp Support
          </a>
          <Link
            to="/support"
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <span>📩</span> Submit Ticket
          </Link>
        </div>
      </div>
    </div>
  )
}
