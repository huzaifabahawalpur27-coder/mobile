import { useState, useRef, useEffect } from 'react'
import { useTheme, THEME_STYLES } from '../context/ThemeContext'

export default function ThemeSelector() {
  const { isDark, toggleTheme, themeStyle, setThemeStyle } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const activeThemeMeta = THEME_STYLES.find(t => t.id === themeStyle) || THEME_STYLES[0]

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        data-sound="toggle"
        className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-[10px] sm:text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
        title="Switch Mobile OS Theme & Appearance"
      >
        <span className="text-sm leading-none">{activeThemeMeta.icon}</span>
        <span className="hidden md:inline text-gray-700 dark:text-gray-200">{activeThemeMeta.name}</span>
        <span className="text-[10px] text-gray-400">
          {isDark ? '🌙' : '☀️'}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100 dark:border-gray-800">
            <div>
              <div className="text-xs font-black text-gray-900 dark:text-gray-100">Mobile OS Theme</div>
              <div className="text-[10px] text-gray-400">Tailored mobile shop aesthetics</div>
            </div>
            
            {/* Dark / Light Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              data-sound="toggle"
              className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 flex items-center gap-1 transition"
            >
              <span>{isDark ? '🌙 Dark' : '☀️ Light'}</span>
            </button>
          </div>

          {/* Theme Option Cards */}
          <div className="grid grid-cols-1 gap-1.5">
            {THEME_STYLES.map(theme => {
              const isSelected = theme.id === themeStyle
              return (
                <button
                  key={theme.id}
                  type="button"
                  data-sound="toggle"
                  onClick={() => {
                    setThemeStyle(theme.id)
                    setIsOpen(false)
                  }}
                  className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 shadow-xs'
                      : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 hover:bg-gray-50/70 dark:hover:bg-gray-800/70'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0 font-bold"
                      style={{
                        backgroundColor: `${theme.accentColor}18`,
                        color: theme.accentColor
                      }}
                    >
                      {theme.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                        <span>{theme.name}</span>
                        {isSelected && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded-full font-black bg-blue-600 text-white">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">{theme.category}</div>
                    </div>
                  </div>

                  {/* Accent Swatch Preview */}
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 border-2 border-white shadow-xs"
                    style={{ backgroundColor: theme.accentColor }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
