/**
 * iPhone Models, Official Release Colors, and Shorthand Matcher
 * Maps Apple releases from legacy to latest iPhone 16 Pro Max series.
 */

export const IPHONE_MODELS = [
  // iPhone 18 Series (2026)
  {
    name: 'iPhone 18 Pro Max',
    series: '18',
    generation: 18,
    isPro: true,
    shorthand: ['18', '18pm', '18 pro max', '18promax', 'eighteen'],
    defaultStorage: '256GB',
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Cosmic Orange Titanium', 'Dark Titanium', 'Natural Titanium', 'Frost White Titanium']
  },
  {
    name: 'iPhone 18 Pro',
    series: '18',
    generation: 18,
    isPro: true,
    shorthand: ['18', '18p', '18 pro', '18pro'],
    defaultStorage: '256GB',
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Cosmic Orange Titanium', 'Dark Titanium', 'Natural Titanium', 'Frost White Titanium']
  },
  {
    name: 'iPhone 18 Air',
    series: '18',
    generation: 18,
    isPro: false,
    shorthand: ['18', '18 air', '18 slim', '18air', '18slim'],
    defaultStorage: '256GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Sky Blue', 'Light Emerald', 'Silver', 'Space Black']
  },
  {
    name: 'iPhone 18',
    series: '18',
    generation: 18,
    isPro: false,
    shorthand: ['18', 'eighteen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Sky Blue', 'Light Emerald', 'Silver', 'Space Black', 'Lavender']
  },

  // iPhone 17 Series (2025)
  {
    name: 'iPhone 17 Pro Max',
    series: '17',
    generation: 17,
    isPro: true,
    shorthand: ['17', '17pm', '17 pro max', '17promax', 'seventeen'],
    defaultStorage: '256GB',
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Teal Titanium', 'Natural Titanium', 'Deep Blue Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 17 Pro',
    series: '17',
    generation: 17,
    isPro: true,
    shorthand: ['17', '17p', '17 pro', '17pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Teal Titanium', 'Natural Titanium', 'Deep Blue Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 17 Air',
    series: '17',
    generation: 17,
    isPro: false,
    shorthand: ['17', '17 air', '17 slim', '17air', '17slim'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Titanium Gray', 'Ice Blue', 'Pearl White', 'Space Black']
  },
  {
    name: 'iPhone 17',
    series: '17',
    generation: 17,
    isPro: false,
    shorthand: ['17', 'seventeen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Teal', 'Lavender', 'Sage Green', 'White', 'Black']
  },

  // iPhone 16 Series (2024)
  {
    name: 'iPhone 16 Pro Max',
    series: '16',
    generation: 16,
    isPro: true,
    shorthand: ['16', '16pm', '16 pro max', '16promax'],
    defaultStorage: '256GB',
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Desert Titanium', 'Natural Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 16 Pro',
    series: '16',
    generation: 16,
    isPro: true,
    shorthand: ['16', '16p', '16 pro', '16pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Desert Titanium', 'Natural Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 16 Plus',
    series: '16',
    generation: 16,
    isPro: false,
    shorthand: ['16', '16 plus', '16plus'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Ultramarine', 'Teal', 'Pink', 'White', 'Black']
  },
  {
    name: 'iPhone 16',
    series: '16',
    generation: 16,
    isPro: false,
    shorthand: ['16', 'sixteen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Ultramarine', 'Teal', 'Pink', 'White', 'Black']
  },

  // iPhone 15 Series (2023)
  {
    name: 'iPhone 15 Pro Max',
    series: '15',
    generation: 15,
    isPro: true,
    shorthand: ['15', '15pm', '15 pro max', '15promax'],
    defaultStorage: '256GB',
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 15 Pro',
    series: '15',
    generation: 15,
    isPro: true,
    shorthand: ['15', '15p', '15 pro', '15pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Natural Titanium', 'Blue Titanium', 'White Titanium', 'Black Titanium']
  },
  {
    name: 'iPhone 15 Plus',
    series: '15',
    generation: 15,
    isPro: false,
    shorthand: ['15', '15 plus', '15plus'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Pink', 'Yellow', 'Green', 'Blue', 'Black']
  },
  {
    name: 'iPhone 15',
    series: '15',
    generation: 15,
    isPro: false,
    shorthand: ['15', 'fifteen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Pink', 'Yellow', 'Green', 'Blue', 'Black']
  },

  // iPhone 14 Series (2022)
  {
    name: 'iPhone 14 Pro Max',
    series: '14',
    generation: 14,
    isPro: true,
    shorthand: ['14', '14pm', '14 pro max', '14promax'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Deep Purple', 'Space Black', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 14 Pro',
    series: '14',
    generation: 14,
    isPro: true,
    shorthand: ['14', '14p', '14 pro', '14pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Deep Purple', 'Space Black', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 14 Plus',
    series: '14',
    generation: 14,
    isPro: false,
    shorthand: ['14', '14 plus', '14plus'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Midnight', 'Starlight', 'Blue', 'Purple', 'Yellow', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 14',
    series: '14',
    generation: 14,
    isPro: false,
    shorthand: ['14', 'fourteen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Midnight', 'Starlight', 'Blue', 'Purple', 'Yellow', '(PRODUCT)RED']
  },

  // iPhone 13 Series (2021)
  {
    name: 'iPhone 13 Pro Max',
    series: '13',
    generation: 13,
    isPro: true,
    shorthand: ['13', '13pm', '13 pro max', '13promax'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Sierra Blue', 'Alpine Green', 'Graphite', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 13 Pro',
    series: '13',
    generation: 13,
    isPro: true,
    shorthand: ['13', '13p', '13 pro', '13pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Sierra Blue', 'Alpine Green', 'Graphite', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 13',
    series: '13',
    generation: 13,
    isPro: false,
    shorthand: ['13', 'thirteen'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Midnight', 'Starlight', 'Blue', 'Pink', 'Green', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 13 Mini',
    series: '13',
    generation: 13,
    isPro: false,
    shorthand: ['13', '13 mini', '13mini'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Midnight', 'Starlight', 'Blue', 'Pink', 'Green', '(PRODUCT)RED']
  },

  // iPhone 12 Series (2020)
  {
    name: 'iPhone 12 Pro Max',
    series: '12',
    generation: 12,
    isPro: true,
    shorthand: ['12', '12pm', '12 pro max', '12promax'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Pacific Blue', 'Graphite', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 12 Pro',
    series: '12',
    generation: 12,
    isPro: true,
    shorthand: ['12', '12p', '12 pro', '12pro'],
    defaultStorage: '128GB',
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Pacific Blue', 'Graphite', 'Gold', 'Silver']
  },
  {
    name: 'iPhone 12',
    series: '12',
    generation: 12,
    isPro: false,
    shorthand: ['12', 'twelve'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Black', 'White', 'Blue', 'Green', 'Purple', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 12 Mini',
    series: '12',
    generation: 12,
    isPro: false,
    shorthand: ['12', '12 mini', '12mini'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Black', 'White', 'Blue', 'Green', 'Purple', '(PRODUCT)RED']
  },

  // iPhone 11 Series (2019)
  {
    name: 'iPhone 11 Pro Max',
    series: '11',
    generation: 11,
    isPro: true,
    shorthand: ['11', '11pm', '11 pro max', '11promax'],
    defaultStorage: '64GB',
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Midnight Green', 'Space Gray', 'Silver', 'Gold']
  },
  {
    name: 'iPhone 11 Pro',
    series: '11',
    generation: 11,
    isPro: true,
    shorthand: ['11', '11p', '11 pro', '11pro'],
    defaultStorage: '64GB',
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Midnight Green', 'Space Gray', 'Silver', 'Gold']
  },
  {
    name: 'iPhone 11',
    series: '11',
    generation: 11,
    isPro: false,
    shorthand: ['11', 'eleven'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Black', 'White', 'Green', 'Yellow', 'Purple', '(PRODUCT)RED']
  },

  // iPhone X / XS / XR Series (2017-2018)
  {
    name: 'iPhone XS Max',
    series: 'X',
    generation: 10,
    isPro: true,
    shorthand: ['10', 'x', 'xs max', 'xsmax', '10s max'],
    defaultStorage: '64GB',
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Space Gray', 'Silver', 'Gold']
  },
  {
    name: 'iPhone XS',
    series: 'X',
    generation: 10,
    isPro: true,
    shorthand: ['10', 'x', 'xs', '10s'],
    defaultStorage: '64GB',
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Space Gray', 'Silver', 'Gold']
  },
  {
    name: 'iPhone XR',
    series: 'X',
    generation: 10,
    isPro: false,
    shorthand: ['10', 'x', 'xr', '10r'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Black', 'White', 'Blue', 'Yellow', 'Coral', '(PRODUCT)RED']
  },
  {
    name: 'iPhone X',
    series: 'X',
    generation: 10,
    isPro: true,
    shorthand: ['10', 'x', 'ten'],
    defaultStorage: '64GB',
    storages: ['64GB', '256GB'],
    colors: ['Space Gray', 'Silver']
  },

  // iPhone SE Series
  {
    name: 'iPhone SE (3rd gen, 2022)',
    series: 'SE',
    generation: 'SE3',
    isPro: false,
    shorthand: ['se', 'se3', 'se 2022', 'se 3'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Midnight', 'Starlight', '(PRODUCT)RED']
  },
  {
    name: 'iPhone SE (2nd gen, 2020)',
    series: 'SE',
    generation: 'SE2',
    isPro: false,
    shorthand: ['se', 'se2', 'se 2020', 'se 2'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Black', 'White', '(PRODUCT)RED']
  },

  // Legacy Series
  {
    name: 'iPhone 8 Plus',
    series: '8',
    generation: 8,
    isPro: false,
    shorthand: ['8', '8 plus', '8plus', '8p'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Space Gray', 'Silver', 'Gold', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 8',
    series: '8',
    generation: 8,
    isPro: false,
    shorthand: ['8', 'eight'],
    defaultStorage: '64GB',
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Space Gray', 'Silver', 'Gold', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 7 Plus',
    series: '7',
    generation: 7,
    isPro: false,
    shorthand: ['7', '7 plus', '7plus', '7p'],
    defaultStorage: '32GB',
    storages: ['32GB', '128GB', '256GB'],
    colors: ['Matte Black', 'Jet Black', 'Silver', 'Gold', 'Rose Gold', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 7',
    series: '7',
    generation: 7,
    isPro: false,
    shorthand: ['7', 'seven'],
    defaultStorage: '32GB',
    storages: ['32GB', '128GB', '256GB'],
    colors: ['Matte Black', 'Jet Black', 'Silver', 'Gold', 'Rose Gold', '(PRODUCT)RED']
  },
  {
    name: 'iPhone 6s Plus',
    series: '6',
    generation: 6,
    isPro: false,
    shorthand: ['6', '6s', '6s plus', '6sp'],
    defaultStorage: '32GB',
    storages: ['16GB', '32GB', '64GB', '128GB'],
    colors: ['Space Gray', 'Silver', 'Gold', 'Rose Gold']
  },
  {
    name: 'iPhone 6s',
    series: '6',
    generation: 6,
    isPro: false,
    shorthand: ['6', '6s'],
    defaultStorage: '32GB',
    storages: ['16GB', '32GB', '64GB', '128GB'],
    colors: ['Space Gray', 'Silver', 'Gold', 'Rose Gold']
  }
]

// All Iconic Apple iPhone Colors across generations
export const ALL_IPHONE_COLORS = [
  // Titanium Generation (15, 16, 17, 18 Pro)
  'Cosmic Orange Titanium',
  'Dark Titanium',
  'Frost White Titanium',
  'Teal Titanium',
  'Deep Blue Titanium',
  'Titanium Gray',
  'Desert Titanium',
  'Natural Titanium',
  'Black Titanium',
  'White Titanium',
  'Blue Titanium',

  // Modern Flagship Colors
  'Ice Blue',
  'Pearl White',
  'Sky Blue',
  'Light Emerald',
  'Sage Green',
  'Deep Purple',
  'Space Black',
  'Sierra Blue',
  'Alpine Green',
  'Pacific Blue',
  'Midnight Green',
  'Graphite',

  // Standard & Cheerful Finishes
  'Ultramarine',
  'Teal',
  'Midnight',
  'Starlight',
  'Pink',
  'Purple',
  'Blue',
  'Green',
  'Yellow',
  'Coral',
  '(PRODUCT)RED',

  // Classic Finishes
  'Black',
  'White',
  'Space Gray',
  'Silver',
  'Gold',
  'Rose Gold',
  'Jet Black',
  'Matte Black'
]

/**
 * Searches iPhone models using fuzzy input or shorthand numbers (e.g. "11", "10", "x", "14", "16pm")
 * @param {string} query 
 * @returns {Array} Array of matching iPhone models
 */
export function searchIphoneModels(query = '') {
  if (!query || typeof query !== 'string') return IPHONE_MODELS

  const clean = query.trim().toLowerCase()
  const cleanNoIphone = clean.replace(/^iphone\s*/i, '').trim()

  return IPHONE_MODELS.filter(item => {
    const modelLower = item.name.toLowerCase()
    // Exact or partial name match
    if (modelLower.includes(clean)) return true
    // Matched without "iphone" prefix
    if (cleanNoIphone && modelLower.includes(cleanNoIphone)) return true
    // Series match (e.g. user typed "11" or "14" or "10")
    if (item.series.toLowerCase() === clean || item.series.toLowerCase() === cleanNoIphone) return true
    // Shorthand array match
    return item.shorthand.some(sh => sh === clean || sh === cleanNoIphone || sh.includes(cleanNoIphone))
  })
}

/**
 * Returns available colors for a given iPhone model name, prioritizing official model colors
 * @param {string} modelName 
 * @returns {Array<string>}
 */
export function getIphoneColorsForModel(modelName = '') {
  if (!modelName) return ALL_IPHONE_COLORS

  const found = IPHONE_MODELS.find(m => m.name.toLowerCase() === modelName.trim().toLowerCase())
  if (found && found.colors && found.colors.length > 0) {
    // Return model-specific colors first, followed by remaining general colors
    const otherColors = ALL_IPHONE_COLORS.filter(c => !found.colors.includes(c))
    return [...found.colors, ...otherColors]
  }

  return ALL_IPHONE_COLORS
}
