import { createContext, useContext, useState, useEffect } from 'react'
import {
  initGlobalSoundEffects,
  isSoundEnabled,
  toggleSound as soundToggleHelper,
  setSoundEnabled as soundSetHelper
} from '../utils/soundEffects'

export const THEME_STYLES = [
  {
    id: 'apple-solid',
    name: 'Apple Clean',
    category: 'iOS / macOS',
    icon: '',
    description: 'Crisp solid surfaces, hairline borders, iOS system blue, refined squircles',
    accentColor: '#0071e3',
    badge: 'Classic'
  },
  {
    id: 'apple-glass',
    name: 'Apple Glass',
    category: 'macOS Sonoma',
    icon: '🪟',
    description: 'Frosted acrylic glass, specular lighting, subtle refraction & floating depth',
    accentColor: '#007aff',
    badge: 'Glass'
  },
  {
    id: 'pixel',
    name: 'Google Pixel',
    category: 'Material You M3',
    icon: '🤖',
    description: 'Expressive pastel containers, organic pill buttons, playful Google aesthetics',
    accentColor: '#3b82f6',
    badge: 'Material'
  },
  {
    id: 'oneplus',
    name: 'OnePlus',
    category: 'OxygenOS',
    icon: '⚡',
    description: 'High-speed obsidian surfaces, signature Crimson Red (#eb0028), precision geometry',
    accentColor: '#eb0028',
    badge: 'Oxygen'
  },
  {
    id: 'samsung',
    name: 'Samsung One UI',
    category: 'Galaxy One UI 6',
    icon: '📱',
    description: 'Deep squircle comfort cards, ergonomic reach zones, signature Galaxy Blue',
    accentColor: '#0381fe',
    badge: 'One UI'
  }
]

const VALID_STYLES = THEME_STYLES.map(s => s.id)

const ThemeContext = createContext({
  theme: 'light',
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
  themeStyle: 'apple-solid',
  setThemeStyle: () => {},
  soundEnabled: true,
  toggleSound: () => {},
  setSoundEnabled: () => {}
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = localStorage.getItem('app_theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  const [themeStyle, setThemeStyleState] = useState(() => {
    if (typeof window === 'undefined') return 'apple-solid'
    const saved = localStorage.getItem('app_style')
    if (VALID_STYLES.includes(saved)) return saved
    return 'apple-solid'
  })

  const [soundOn, setSoundOn] = useState(() => isSoundEnabled())

  useEffect(() => {
    initGlobalSoundEffects()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.setAttribute('data-theme', 'dark')
      root.setAttribute('data-mode', 'dark')
      localStorage.setItem('app_theme', 'dark')
    } else {
      root.classList.remove('dark')
      root.setAttribute('data-theme', 'light')
      root.setAttribute('data-mode', 'light')
      localStorage.setItem('app_theme', 'light')
    }
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-style', themeStyle)
    localStorage.setItem('app_style', themeStyle)
  }, [themeStyle])

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setTheme = (newTheme) => {
    if (newTheme === 'dark' || newTheme === 'light') {
      setThemeState(newTheme)
    }
  }

  const setThemeStyle = (styleId) => {
    if (VALID_STYLES.includes(styleId)) {
      setThemeStyleState(styleId)
    }
  }

  const toggleSound = () => {
    const updated = soundToggleHelper()
    setSoundOn(updated)
    return updated
  }

  const setSoundEnabled = (enabled) => {
    soundSetHelper(enabled)
    setSoundOn(enabled)
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
        themeStyle,
        setThemeStyle,
        soundEnabled: soundOn,
        toggleSound,
        setSoundEnabled
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
