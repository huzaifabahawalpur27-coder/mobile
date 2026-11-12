// Vercel serverless entry for the privileged admin API (/api/*).
// vercel.json rewrites every /api/... request here; Express still sees the original
// path (e.g. /api/admin/query), so the routes in api-server.js match unchanged.
// Needs these Vercel environment variables (server-side only, never VITE_*):
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (or VITE_SUPABASE_URL),
//   ADMIN_SESSION_SECRET, and for email: RESEND_API_KEY, RESEND_FROM_EMAIL.
import app from '../api-server.js'

export default app
