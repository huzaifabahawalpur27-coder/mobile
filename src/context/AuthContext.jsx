import { createContext, useState, useContext, useEffect } from 'react'
import { db } from '../services/db'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })

  const [originalUser, setOriginalUser] = useState(() => {
    const saved = localStorage.getItem('originalUser')
    return saved ? JSON.parse(saved) : null
  })

  // On every app load: if user is logged in but user_pw_hash is missing
  // (e.g. existing session before this feature was added), try to restore
  // the hash from IndexedDB so PasswordModal works without re-login.
  useEffect(() => {
    const restoreHash = async () => {
      if (!user?.id || user.role === 'superadmin') return
      if (localStorage.getItem('user_pw_hash')) return // already cached
      try {
        const localUser = await db.users.get(user.id)
        if (localUser?.password) {
          localStorage.setItem('user_pw_hash', localUser.password)
        }
      } catch (_) { /* IndexedDB might be empty — user must re-login once */ }
    }
    restoreHash()
  }, [user?.id, user?.role])

  const [authorizedShops, setAuthorizedShops] = useState(() => {
    const saved = localStorage.getItem('authorized_shops')
    return saved ? JSON.parse(saved) : []
  })

  const [branches, setBranches] = useState(() => {
    const saved = localStorage.getItem('branches')
    return saved ? JSON.parse(saved) : []
  })

  const login = (userData, userShops = [], userBranches = []) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
    if (userData.role === 'superadmin') {
      localStorage.setItem('superadmin_session', JSON.stringify(userData))
    }
    if (userShops && userShops.length > 0) {
      setAuthorizedShops(userShops)
      localStorage.setItem('authorized_shops', JSON.stringify(userShops))
    }
    if (userBranches && userBranches.length > 0) {
      setBranches(userBranches)
      localStorage.setItem('branches', JSON.stringify(userBranches))
    }
  }

  // Switch organization/shop or branch context dynamically with cache isolation
  const switchTenantContext = async (targetShopId, targetBranchId = null) => {
    const numShopId = parseInt(targetShopId)
    if (isNaN(numShopId)) return { success: false, error: 'Invalid shop ID' }

    try {
      const { supabase } = await import('../services/supabase')
      const { data, error } = await supabase.rpc('switch_tenant_context', {
        p_target_shop_id: numShopId,
        p_target_branch_id: targetBranchId ? parseInt(targetBranchId) : null
      })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Failed to switch context')

      // Secure tenant cache isolation: Flush all cached tables to prevent data leaks
      try {
        await Promise.all([
          db.products.clear(),
          db.categories.clear(),
          db.suppliers.clear(),
          db.customers.clear(),
          db.brands.clear(),
          db.sales.clear(),
          db.sale_items.clear(),
          db.purchases.clear(),
          db.purchase_items.clear(),
          db.expenses.clear(),
          db.customer_payments.clear(),
          db.supplier_payments.clear(),
          db.held_carts.clear(),
          db.phones?.clear ? db.phones.clear() : Promise.resolve()
        ])
      } catch (cacheErr) {
        console.warn('Tenant switch cache flush notice:', cacheErr)
      }

      // Update user state
      const updatedUser = {
        ...user,
        shop_id: numShopId,
        branch_id: data.branch_id,
        branch_name: data.branch_name,
        role: data.role || user.role
      }
      setUser(updatedUser)
      localStorage.setItem('user', JSON.stringify(updatedUser))

      // Refresh branches list for target shop
      try {
        const { data: bData } = await supabase.from('branches').select('*').eq('shop_id', numShopId)
        if (bData) {
          setBranches(bData)
          localStorage.setItem('branches', JSON.stringify(bData))
        }
      } catch (_) {}

      // Invalidate layout cache and trigger reload
      window.location.reload()
      return { success: true }
    } catch (err) {
      console.error('switchTenantContext error:', err)
      return { success: false, error: err.message || 'Context switch failed' }
    }
  }

  const impersonate = (shopId, shopData) => {
    setOriginalUser(user)
    localStorage.setItem('originalUser', JSON.stringify(user))

    const impersonatedUser = {
      id: `impersonated-${shopId}`,
      username: `Superadmin (${shopData.name})`,
      role: 'admin',
      shop_id: String(shopId),
      isImpersonating: true
    }

    setUser(impersonatedUser)
    localStorage.setItem('user', JSON.stringify(impersonatedUser))
    localStorage.setItem(`shop_name_${shopId}`, shopData.name)
    if (shopData.logo_url) {
      localStorage.setItem(`shop_logo_${shopId}`, shopData.logo_url)
    } else {
      localStorage.removeItem(`shop_logo_${shopId}`)
    }
  }

  const stopImpersonating = () => {
    if (originalUser) {
      const currentShopId = user?.shop_id
      const restored = { ...originalUser }
      delete restored.isImpersonating

      setUser(restored)
      localStorage.setItem('user', JSON.stringify(restored))
      setOriginalUser(null)
      localStorage.removeItem('originalUser')
      if (currentShopId) {
        localStorage.removeItem(`shop_name_${currentShopId}`)
        localStorage.removeItem(`shop_logo_${currentShopId}`)
      }
      return restored
    }
    return null
  }

  const logout = async () => {
    setUser(null)
    setOriginalUser(null)
    setAuthorizedShops([])
    setBranches([])
    localStorage.removeItem('user')
    localStorage.removeItem('originalUser')
    localStorage.removeItem('user_pw_hash')
    localStorage.removeItem('session_token')
    localStorage.removeItem('superadmin_session')
    localStorage.removeItem('authorized_shops')
    localStorage.removeItem('branches')
    try {
      await Promise.all([
        db.products.clear(),
        db.categories.clear(),
        db.suppliers.clear(),
        db.customers.clear(),
        db.brands.clear(),
        db.sales.clear(),
        db.sale_items.clear(),
        db.purchases.clear(),
        db.purchase_items.clear(),
        db.expenses.clear(),
        db.users.clear(),
        db.shops.clear(),
        db.customer_payments.clear(),
        db.supplier_payments.clear(),
        db.held_carts.clear(),
        db.phones?.clear ? db.phones.clear() : Promise.resolve()
      ])
    } catch (e) {
      console.warn('Dexie logout cleanup failed:', e)
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      originalUser,
      authorizedShops,
      branches,
      login,
      logout,
      impersonate,
      stopImpersonating,
      switchTenantContext
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
