import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function seed() {
  console.log('====================================================')
  console.log('🌱 Seeding EdgeX Mobile Shop Demo Data into Supabase')
  console.log('====================================================\n')

  const shopId = 1

  // 1. Ensure Categories
  const categories = [
    { name: 'Smart Phones', shop_id: shopId },
    { name: 'Feature Phones', shop_id: shopId },
    { name: 'Chargers & Adapters', shop_id: shopId },
    { name: 'Cables & Data Leads', shop_id: shopId },
    { name: 'Audio & Earphones', shop_id: shopId },
    { name: 'Cases & Protectors', shop_id: shopId },
    { name: 'Power Banks & Batteries', shop_id: shopId }
  ]
  const { data: catData, error: catErr } = await sb.from('categories').upsert(categories, { onConflict: 'id' }).select()
  console.log('✓ Categories seeded / verified:', catData?.length || 0, catErr || '')

  // 2. Ensure Brands
  const brands = [
    { name: 'Apple', shop_id: shopId },
    { name: 'Samsung', shop_id: shopId },
    { name: 'Xiaomi / Redmi', shop_id: shopId },
    { name: 'Infinix', shop_id: shopId },
    { name: 'Google Pixel', shop_id: shopId },
    { name: 'Anker', shop_id: shopId },
    { name: 'Baseus', shop_id: shopId }
  ]
  const { data: brandData, error: brandErr } = await sb.from('brands').upsert(brands, { onConflict: 'id' }).select()
  console.log('✓ Brands seeded / verified:', brandData?.length || 0, brandErr || '')

  // 3. Ensure Suppliers
  const suppliers = [
    { name: 'Hafeez Centre Mobile Distributers', phone: '0321-9876543', address: 'Hall Road, Lahore', shop_id: shopId, balance: 45000 },
    { name: 'Dubai Mobile Wholesale & Trade', phone: '0300-8472910', address: 'Saddar, Karachi', shop_id: shopId, balance: 120000 },
    { name: 'Royal Accessories Importers', phone: '0333-5129481', address: 'Commercial Market, Rawalpindi', shop_id: shopId, balance: 0 }
  ]
  const { data: supData, error: supErr } = await sb.from('suppliers').upsert(suppliers, { onConflict: 'id' }).select()
  console.log('✓ Suppliers seeded / verified:', supData?.length || 0, supErr || '')

  // 4. Ensure Customers
  const customers = [
    { name: 'Muhammad Bilal', phone: '0302-8471920', address: 'Gulberg III, Lahore', shop_id: shopId, balance: 5000 },
    { name: 'Usman Arshad', phone: '0313-9201948', address: 'Model Town, Gujranwala', shop_id: shopId, balance: 0 },
    { name: 'Hamza Tariq', phone: '0324-4482910', address: 'D-Ground, Faisalabad', shop_id: shopId, balance: 15000 },
    { name: 'Walk-In Customer', phone: '0300-0000000', address: 'Lahore', shop_id: shopId, balance: 0 }
  ]
  const { data: custData, error: custErr } = await sb.from('customers').upsert(customers, { onConflict: 'id' }).select()
  console.log('✓ Customers seeded / verified:', custData?.length || 0, custErr || '')

  // 5. Seed Mobile Phones (Phones table)
  const phones = [
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '354891110192834',
      imei_2: '354891110192835',
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      color: 'Natural Titanium',
      storage: '256GB',
      condition: 'brand_new',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 445000,
      sale_price: 485000,
      battery_health: 100
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '358921102938475',
      imei_2: '358921102938476',
      brand: 'Apple',
      model: 'iPhone 13',
      color: 'Midnight',
      storage: '128GB',
      condition: 'used',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 135000,
      sale_price: 152000,
      battery_health: 88
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '359182390192847',
      imei_2: '359182390192848',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra',
      color: 'Titanium Black',
      storage: '512GB',
      condition: 'brand_new',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 385000,
      sale_price: 415000,
      battery_health: 100
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '357192830192849',
      imei_2: '357192830192850',
      brand: 'Samsung',
      model: 'Galaxy A54 5G',
      color: 'Awesome Lime',
      storage: '128GB',
      condition: 'used',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 88000,
      sale_price: 98000,
      battery_health: 94
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '864910293847561',
      imei_2: '864910293847562',
      brand: 'Xiaomi',
      model: 'Redmi Note 13 Pro',
      color: 'Ocean Teal',
      storage: '256GB',
      condition: 'brand_new',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 62000,
      sale_price: 71000,
      battery_health: 100
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '862910394857201',
      imei_2: '862910394857202',
      brand: 'Infinix',
      model: 'Note 40 Pro',
      color: 'Vintage Green',
      storage: '256GB',
      condition: 'open_box',
      pta_status: 'approved',
      status: 'in_stock',
      cost_price: 54000,
      sale_price: 62000,
      battery_health: 100
    },
    {
      shop_id: shopId,
      branch_id: 1,
      imei_1: '356891029384712',
      imei_2: '356891029384713',
      brand: 'Google Pixel',
      model: 'Pixel 7 Pro',
      color: 'Obsidian',
      storage: '128GB',
      condition: 'used',
      pta_status: 'cpid',
      status: 'in_stock',
      cost_price: 92000,
      sale_price: 108000,
      battery_health: 89
    }
  ]

  for (const p of phones) {
    const { error: pErr } = await sb.from('phones').upsert(p, { onConflict: 'shop_id, imei_1' })
    if (pErr) console.warn('Phone seed note:', p.brand, p.model, pErr.message)
  }
  console.log(`✓ ${phones.length} Serialized Mobile Phones seeded / verified`)

  // 6. Seed Accessories Products
  const products = [
    {
      name: 'Apple 20W USB-C Power Adapter (Original)',
      brand: 'Apple',
      cost_price: 4500,
      sale_price: 6500,
      stock_quantity: 25,
      low_stock_threshold: 5,
      sku: 'CHG-APL-20W',
      barcode: '194252157015',
      shop_id: shopId
    },
    {
      name: 'Samsung 25W Super Fast Travel Charger (Type-C)',
      brand: 'Samsung',
      cost_price: 3200,
      sale_price: 4800,
      stock_quantity: 30,
      low_stock_threshold: 5,
      sku: 'CHG-SAM-25W',
      barcode: '880609012345',
      shop_id: shopId
    },
    {
      name: 'Anker PowerLine III USB-C to Lightning Cable 1.8m',
      brand: 'Anker',
      cost_price: 1800,
      sale_price: 2800,
      stock_quantity: 40,
      low_stock_threshold: 10,
      sku: 'CAB-ANK-LGT',
      barcode: '848061034567',
      shop_id: shopId
    },
    {
      name: 'Baseus 10000mAh Magnetic Wireless Power Bank 20W',
      brand: 'Baseus',
      cost_price: 5200,
      sale_price: 7500,
      stock_quantity: 12,
      low_stock_threshold: 3,
      sku: 'PB-BAS-10K',
      barcode: '695315620123',
      shop_id: shopId
    },
    {
      name: 'iPhone 15 Pro 9D Tempered Glass Screen Protector',
      brand: 'Apple',
      cost_price: 250,
      sale_price: 800,
      stock_quantity: 85,
      low_stock_threshold: 15,
      sku: 'SCR-IP15P-9D',
      barcode: '958201928471',
      shop_id: shopId
    },
    {
      name: 'Liquid Silicone MagSafe Case with Microfiber Lining',
      brand: 'Apple',
      cost_price: 450,
      sale_price: 1500,
      stock_quantity: 60,
      low_stock_threshold: 10,
      sku: 'CAS-MAG-SIL',
      barcode: '958201928472',
      shop_id: shopId
    },
    {
      name: 'AirPods Pro 2 Wireless ANC Earbuds (Master Copy)',
      brand: 'Apple',
      cost_price: 3200,
      sale_price: 5500,
      stock_quantity: 20,
      low_stock_threshold: 4,
      sku: 'AUD-APP2-ANC',
      barcode: '194253397123',
      shop_id: shopId
    }
  ]

  for (const prod of products) {
    const { error: prErr } = await sb.from('products').upsert(prod, { onConflict: 'id' })
    if (prErr) console.warn('Product seed note:', prod.name, prErr.message)
  }
  console.log(`✓ ${products.length} Accessory / Parts Products seeded / verified`)

  // 7. Seed Sample Expenses
  const expenses = [
    {
      amount: 15000,
      category: 'Electricity / Utilities',
      description: 'Shop Electricity Bill for current month',
      shop_id: shopId,
      branch_id: 1,
      date: new Date().toISOString().split('T')[0]
    },
    {
      amount: 4500,
      category: 'Tea / Refreshment',
      description: 'Customer tea, cold drinks and refreshment expenses',
      shop_id: shopId,
      branch_id: 1,
      date: new Date().toISOString().split('T')[0]
    }
  ]
  const { error: expErr } = await sb.from('expenses').insert(expenses)
  if (!expErr) console.log('✓ Sample expenses seeded')

  // 8. Seed Sample Sales & Sale Items
  const { count: salesCount } = await sb.from('sales').select('*', { count: 'exact', head: true })
  if (!salesCount || salesCount === 0) {
    const { data: custData } = await sb.from('customers').select('id').limit(2)
    const { data: prodData } = await sb.from('products').select('id, cost_price, sale_price').limit(3)
    const custId = custData?.[0]?.id || null

    if (prodData && prodData.length > 0) {
      const p1 = prodData[0]
      const p2 = prodData[1] || prodData[0]

      const saleRecord = {
        shop_id: shopId,
        branch_id: 1,
        customer_id: custId,
        total_amount: Number(p1.sale_price) * 2 + Number(p2.sale_price),
        discount: 500,
        net_amount: (Number(p1.sale_price) * 2 + Number(p2.sale_price)) - 500,
        paid_amount: (Number(p1.sale_price) * 2 + Number(p2.sale_price)) - 500,
        amount_paid: (Number(p1.sale_price) * 2 + Number(p2.sale_price)) - 500,
        payment_method: 'cash',
        payment_type: 'cash',
        created_at: new Date().toISOString()
      }

      const { data: createdSale, error: saleErr } = await sb.from('sales').insert([saleRecord]).select().single()
      if (!saleErr && createdSale) {
        await sb.from('sale_items').insert([
          {
            sale_id: createdSale.id,
            product_id: p1.id,
            quantity: 2,
            price: p1.sale_price,
            cost_price: p1.cost_price,
            total: Number(p1.sale_price) * 2
          },
          {
            sale_id: createdSale.id,
            product_id: p2.id,
            quantity: 1,
            price: p2.sale_price,
            cost_price: p2.cost_price,
            total: Number(p2.sale_price)
          }
        ])
        console.log('✓ Sample sale & sale items created')
      }
    }
  }

  // 9. Seed Sample Purchases & Purchase Items
  const { count: purchCount } = await sb.from('purchases').select('*', { count: 'exact', head: true })
  if (!purchCount || purchCount === 0) {
    const { data: suppData } = await sb.from('suppliers').select('id').limit(1)
    const { data: prodData } = await sb.from('products').select('id, cost_price').limit(2)
    const suppId = suppData?.[0]?.id || null

    if (prodData && prodData.length > 0) {
      const p1 = prodData[0]
      const purchRecord = {
        shop_id: shopId,
        branch_id: 1,
        supplier_id: suppId,
        total_amount: Number(p1.cost_price) * 10,
        paid_amount: Number(p1.cost_price) * 10,
        payment_type: 'cash',
        created_at: new Date().toISOString()
      }

      const { data: createdPurch, error: purchErr } = await sb.from('purchases').insert([purchRecord]).select().single()
      if (!purchErr && createdPurch) {
        await sb.from('purchase_items').insert([
          {
            purchase_id: createdPurch.id,
            product_id: p1.id,
            quantity: 10,
            cost_price: p1.cost_price,
            total: Number(p1.cost_price) * 10
          }
        ])
        console.log('✓ Sample purchase & purchase items created')
      }
    }
  }
}

seed().catch(err => {
  console.error('Fatal seed error:', err)
  process.exit(1)
})
