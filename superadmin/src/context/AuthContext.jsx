import { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext()

const SESSION_KEY = 'superadmin_session'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('admin_session_token')))

  useEffect(() => {
    const token = localStorage.getItem('admin_session_token')
    if (!token) return
    fetch('/api/admin/session/validate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      .then(async response => response.ok ? response.json() : Promise.reject(new Error('Session expired')))
      .then(({ user: verified }) => { localStorage.setItem(SESSION_KEY, JSON.stringify(verified)); setUser(verified) })
      .catch(() => { localStorage.removeItem('admin_session_token'); localStorage.removeItem(SESSION_KEY); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to sign in')
    const sessionUser = result.user
    localStorage.setItem('admin_session_token', result.token)
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser))
    setUser(sessionUser)
    return sessionUser
  }

  const logout = () => {
    localStorage.removeItem('admin_session_token')
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  const impersonate = (shopId, shopData) => {
    const impersonatedUser = {
      id: `impersonated-${shopId}`,
      username: `Superadmin (${shopData.name})`,
      role: 'admin',
      shop_id: shopId,
      isImpersonating: true
    }
    localStorage.setItem('originalUser', JSON.stringify(user))
    localStorage.setItem('user', JSON.stringify(impersonatedUser))
    localStorage.setItem('shop_name', shopData.name)
    if (shopData.logo_url) {
      localStorage.setItem('shop_logo', shopData.logo_url)
    } else {
      localStorage.removeItem('shop_logo')
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, impersonate, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
