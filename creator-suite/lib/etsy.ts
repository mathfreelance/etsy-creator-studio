export type EtsyAuthStatus = { connected: boolean }

export async function etsyAuthStatus(): Promise<EtsyAuthStatus> {
  const r = await fetch('/api/etsy/auth/status', { cache: 'no-store' })
  if (!r.ok) throw new Error('Failed to fetch Etsy auth status')
  return r.json()
}

export type EtsyShop = Record<string, any>
export async function etsyGetShop(): Promise<EtsyShop> {
  const r = await fetch('/api/etsy/shop', { cache: 'no-store' })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j?.detail || 'Failed to fetch Etsy shop')
  }
  return r.json()
}

export type EtsyListingsResponse = {
  results?: any[]
  data?: any[] | { results?: any[] }
  listings?: any[]
  count?: number
  total?: number
}

export async function etsyGetShopListings(params?: { state?: string; limit?: number; offset?: number }): Promise<EtsyListingsResponse> {
  const sp = new URLSearchParams()
  if (params?.state) sp.set('state', params.state)
  if (typeof params?.limit === 'number') sp.set('limit', String(params.limit))
  if (typeof params?.offset === 'number') sp.set('offset', String(params.offset))
  const qs = sp.toString()
  const url = `/api/etsy/shop/listings${qs ? `?${qs}` : ''}`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j?.detail || 'Failed to fetch Etsy listings')
  }
  return r.json()
}

export function extractListingsArray(resp: EtsyListingsResponse | undefined | null): any[] {
  if (!resp) return []
  const anyResp: any = resp as any
  if (Array.isArray(anyResp.results)) return anyResp.results
  if (Array.isArray(anyResp.listings)) return anyResp.listings
  if (Array.isArray(anyResp.data)) return anyResp.data
  if (anyResp.data && Array.isArray(anyResp.data.results)) return anyResp.data.results
  return []
}
