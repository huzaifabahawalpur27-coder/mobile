import { useState, useEffect } from 'react'
import { supabaseAdmin } from '../services/supabase'
import { logAction } from '../services/auditService'
import { useAuth } from '../context/AuthContext'
import { hashPassword } from '../utils/authUtils'
import { buildWhatsAppUrl, formatPasswordResetMessage } from '../utils/whatsappTemplates'
import {
  X, KeyRound, Copy, Check, MessageSquare, RefreshCw,
  Eye, EyeOff, ShieldCheck, AlertTriangle
} from 'lucide-react'

export default function ResetShopPasswordModal({ shop, onClose, onSuccess }) {
  const { user: currentAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [successData, setSuccessData] = useState(null)
  const [copied, setCopied] = useState(false)

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let rand = ''
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    const num = Math.floor(1000 + Math.random() * 9000)
    return `EdgeX-${rand}${num}`
  }

  useEffect(() => {
    fetchShopUsers()
    setNewPassword(generateRandomPassword())
  }, [shop])

  const fetchShopUsers = async () => {
    if (!supabaseAdmin || !shop?.id) return
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabaseAdmin
        .from('users')
        .select('id, username, email, role, is_active')
        .eq('shop_id', shop.id)
        .order('role', { ascending: true }) // 'admin' first

      if (err) throw err
      setUsers(data || [])
      if (data && data.length > 0) {
        // Prefer admin role, otherwise first user
        const adminUser = data.find(u => u.role === 'admin') || data[0]
        setSelectedUserId(adminUser.id)
      }
    } catch (e) {
      setError('Failed to load shop users: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !newPassword.trim()) {
      setError('Please select a user and provide a new password.')
      return
    }

    if (newPassword.trim().length < 4) {
      setError('Password must be at least 4 characters.')
      return
    }

    setSaving(true)
    setError('')

    const selectedUser = users.find(u => u.id === selectedUserId)

    try {
      const pass = newPassword.trim()
      const hashed = await hashPassword(pass)

      // 1. Update public.users table
      const updates = {
        password: hashed,
        raw_password: pass
      }

      let { error: userError } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', selectedUserId)

      // Gracefully handle if raw_password column doesn't exist
      if (userError && userError.message?.includes('raw_password')) {
        delete updates.raw_password
        const retry = await supabaseAdmin.from('users').update(updates).eq('id', selectedUserId)
        userError = retry.error
      }

      if (userError) throw userError

      // 2. Also update Supabase Auth user if available
      try {
        if (supabaseAdmin.auth?.admin?.updateUserById) {
          await supabaseAdmin.auth.admin.updateUserById(selectedUserId, {
            password: pass
          })
        }
      } catch (authErr) {
        console.warn('Supabase Auth update error (non-fatal):', authErr)
      }

      // 3. Log audit action
      await logAction({
        actor_id: currentAdmin?.id,
        actor_email: currentAdmin?.email || currentAdmin?.username,
        action_type: 'RESET_SHOP_USER_PASSWORD',
        target_type: 'USER',
        target_id: selectedUserId,
        details: {
          shopId: shop.id,
          shopName: shop.name,
          username: selectedUser?.username || selectedUser?.email,
          role: selectedUser?.role
        }
      })

      setSuccessData({
        shopName: shop.name,
        username: selectedUser?.username || selectedUser?.email,
        email: selectedUser?.email,
        password: pass,
        phone: shop.phone
      })

      if (onSuccess) onSuccess()
    } catch (err) {
      console.error(err)
      setError('Failed to reset password: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCopyCredentials = () => {
    if (!successData) return
    const posUrl = import.meta.env.VITE_POS_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://pos.edgexsuite.com')
    const text = `EdgeX POS Credentials\nStore: ${successData.shopName}\nUsername: ${successData.username}\nPassword: ${successData.password}\nLogin: ${posUrl}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenWhatsApp = () => {
    if (!successData) return
    const posUrl = import.meta.env.VITE_POS_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://pos.edgexsuite.com')
    const msg = formatPasswordResetMessage({
      shopName: successData.shopName,
      username: successData.username,
      email: successData.email,
      newPassword: successData.password,
      loginUrl: posUrl
    })
    const url = buildWhatsAppUrl(successData.phone, msg)
    window.open(url, '_blank')
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-inner">
              <KeyRound size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Reset Shop Password</h3>
              <p className="text-xs text-slate-500 font-medium">{shop.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successData ? (
            /* Success State */
            <div className="space-y-4 animate-scaleUp">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-1">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center mb-1">
                  <ShieldCheck size={22} />
                </div>
                <h4 className="font-bold text-emerald-900 text-sm">Password Reset Successfully!</h4>
                <p className="text-xs text-emerald-700">Account credentials have been updated and are ready to share.</p>
              </div>

              {/* Credentials Box */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Shop:</span>
                  <span className="font-bold text-slate-800">{successData.shopName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Username:</span>
                  <span className="font-bold text-slate-800">{successData.username}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">New Password:</span>
                  <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    {successData.password}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCopyCredentials}
                  className="py-2.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenWhatsApp}
                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition"
                >
                  <MessageSquare size={14} />
                  <span>Send WhatsApp</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full mt-2 py-2 text-slate-500 hover:text-slate-800 text-xs font-semibold"
              >
                Done & Close
              </button>
            </div>
          ) : loading ? (
            <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="animate-spin text-blue-500" size={24} />
              <span>Loading shop accounts...</span>
            </div>
          ) : users.length === 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center text-xs text-amber-800">
              No user accounts found for this shop. Create a user via "Users" modal first.
            </div>
          ) : (
            /* Reset Form */
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Select User Account
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.role.toUpperCase()}) {u.email ? `- ${u.email}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                    New Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generateRandomPassword())}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <RefreshCw size={11} /> Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="Enter new password"
                    className="w-full px-3 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Password will be hashed for POS login and stored securely for SuperAdmin support.
                </p>
              </div>

              {shop.phone && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
                  <MessageSquare size={16} className="text-emerald-600 shrink-0" />
                  <span>After reset, you can send credentials directly to <b>{shop.phone}</b> via WhatsApp in 1 tap.</span>
                </div>
              )}

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-lg shadow-amber-500/25 transition flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {saving ? <RefreshCw className="animate-spin" size={14} /> : <KeyRound size={14} />}
                  <span>{saving ? 'Saving...' : 'Set Password'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
