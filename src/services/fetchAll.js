// Supabase returns at most 1000 rows per request: read every page, in a fixed order, so a
// busy shop's rows are not silently cut short. makeQuery() must return a fresh query each
// call (filters applied, no order / range).
const PAGE = 1000

export async function fetchAll(makeQuery, { required = false, orderBy = 'id', ascending = true } = {}) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().order(orderBy, { ascending }).range(from, from + PAGE - 1)
    if (error) {
      if (required) throw error
      return { data: rows.length ? rows : null, error }
    }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}
