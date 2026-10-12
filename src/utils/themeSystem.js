/**
 * Mobile OS Theme System for EdgeX POS
 * Supports 4 premier mobile OEM aesthetics:
 * - Apple iOS (SF-inspired, translucent glass, iOS system blue/indigo)
 * - Samsung One UI (High-squircle cards, warm violet/indigo accents)
 * - OnePlus OxygenOS (Clean red & dark slate performance aesthetic)
 * - Google Material You (Dynamic tonal surfaces, pill chips, modern teal/amber)
 */

export const MOBILE_OS_THEMES = [
  {
    id: 'ios',
    name: 'Apple iOS',
    brand: 'Apple',
    icon: '',
    tagline: 'Clean minimal blur & typography',
    accentColor: '#007AFF',
    accentDark: '#0A84FF',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
    radius: '14px',
    pillRadius: '9999px',
    surfaceLight: '#F2F2F7',
    cardLight: '#FFFFFF',
    borderLight: 'rgba(60,60,67,0.14)',
    surfaceDark: '#000000',
    cardDark: '#1C1C1E',
    borderDark: 'rgba(84,84,88,0.36)'
  },
  {
    id: 'oneui',
    name: 'Samsung One UI',
    brand: 'Samsung',
    icon: '📱',
    tagline: 'Ergonomic rounded squircle controls',
    accentColor: '#0381FE',
    accentDark: '#389BFF',
    fontFamily: "'Samsung Sans', 'Plus Jakarta Sans', system-ui, sans-serif",
    radius: '20px',
    pillRadius: '24px',
    surfaceLight: '#F4F5FA',
    cardLight: '#FFFFFF',
    borderLight: '#E3E5EE',
    surfaceDark: '#0E1017',
    cardDark: '#191C24',
    borderDark: '#2C303E'
  },
  {
    id: 'oxygen',
    name: 'OnePlus OxygenOS',
    brand: 'OnePlus',
    icon: '⚡',
    tagline: 'High-contrast performance & red accents',
    accentColor: '#EB0029',
    accentDark: '#FF334B',
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    radius: '10px',
    pillRadius: '8px',
    surfaceLight: '#F8F9FA',
    cardLight: '#FFFFFF',
    borderLight: '#E9ECEF',
    surfaceDark: '#121212',
    cardDark: '#1E1E1E',
    borderDark: '#2E2E2E'
  },
  {
    id: 'material',
    name: 'Google Material You',
    brand: 'Google Pixel',
    icon: '🎨',
    tagline: 'Dynamic tonal surfaces & expressive pills',
    accentColor: '#006874',
    accentDark: '#4FD8EB',
    fontFamily: "'Roboto Flex', 'Plus Jakarta Sans', system-ui, sans-serif",
    radius: '24px',
    pillRadius: '9999px',
    surfaceLight: '#F3EDF7',
    cardLight: '#FFFFFF',
    borderLight: '#E7E0EC',
    surfaceDark: '#141218',
    cardDark: '#211F26',
    borderDark: '#49454F'
  }
]

export const getSavedTheme = () => {
  return localStorage.getItem('edgex_os_theme') || 'ios'
}

export const getSavedColorMode = () => {
  return localStorage.getItem('edgex_color_mode') || 'light'
}

export const applyTheme = (themeId = 'ios', colorMode = 'light') => {
  const theme = MOBILE_OS_THEMES.find(t => t.id === themeId) || MOBILE_OS_THEMES[0]
  const root = document.documentElement

  root.setAttribute('data-theme', theme.id)
  root.setAttribute('data-mode', colorMode)

  if (colorMode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  // Set CSS custom properties
  const isDark = colorMode === 'dark'
  const accent = isDark ? theme.accentDark : theme.accentColor
  const surface = isDark ? theme.surfaceDark : theme.surfaceLight
  const card = isDark ? theme.cardDark : theme.cardLight
  const border = isDark ? theme.borderDark : theme.borderLight

  root.style.setProperty('--theme-accent', accent)
  root.style.setProperty('--theme-surface', surface)
  root.style.setProperty('--theme-card', card)
  root.style.setProperty('--theme-border', border)
  root.style.setProperty('--theme-radius', theme.radius)
  root.style.setProperty('--theme-pill-radius', theme.pillRadius)
  root.style.setProperty('--theme-font', theme.fontFamily)

  localStorage.setItem('edgex_os_theme', theme.id)
  localStorage.setItem('edgex_color_mode', colorMode)

  // Dispatch custom event for reactive UI updates
  try {
    window.dispatchEvent(new CustomEvent('edgex_theme_changed', {
      detail: { themeId: theme.id, colorMode }
    }))
  } catch (e) {
    console.debug('Theme event dispatch suppressed:', e)
  }

  return theme
}

export const initTheme = () => {
  const savedTheme = getSavedTheme()
  const savedMode = getSavedColorMode()
  return applyTheme(savedTheme, savedMode)
}
