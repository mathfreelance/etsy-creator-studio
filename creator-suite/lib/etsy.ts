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

export type EtsySalesByListing = Record<string, { sales: number; revenue: number }>
export type EtsySalesResponse = {
  ok?: boolean
  total_sales?: number
  revenue?: number
  currency_code?: string
  by_listing?: EtsySalesByListing
  detail?: string
}

export async function etsyGetShopSales(params?: { limit?: number; max_pages?: number }): Promise<EtsySalesResponse> {
  const sp = new URLSearchParams()
  if (typeof params?.limit === 'number') sp.set('limit', String(params.limit))
  if (typeof params?.max_pages === 'number') sp.set('max_pages', String(params.max_pages))
  const qs = sp.toString()
  const url = `/api/etsy/shop/sales${qs ? `?${qs}` : ''}`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) {
    const j = await r.json().catch(() => ({} as any))
    // Return soft error structure so UI can continue gracefully
    return { ok: false, detail: (j as any)?.detail }
  }
  return r.json()
}

export type EtsyReceiptTransaction = {
  transaction_id?: number | string
  listing_id?: number | string
  title?: string
  sku?: string
  quantity: number
  price: number
  variation?: any
}

export type EtsyBuyer = {
  name?: string
  first_line?: string
  second_line?: string
  city?: string
  state?: string
  zip?: string
  country?: string
}

export type EtsyReceipt = {
  receipt_id: number | string
  order_date_ts?: number | null
  buyer: EtsyBuyer
  subtotal: number
  shipping: number
  discount: number
  total: number
  transactions: EtsyReceiptTransaction[]
}

export type EtsyReceiptsResponse = {
  ok?: boolean
  currency_code?: string
  count?: number
  receipts?: EtsyReceipt[]
  detail?: string
}

export async function etsyGetShopReceipts(params?: { limit?: number; max_pages?: number }): Promise<EtsyReceiptsResponse> {
  const sp = new URLSearchParams()
  if (typeof params?.limit === 'number') sp.set('limit', String(params.limit))
  if (typeof params?.max_pages === 'number') sp.set('max_pages', String(params.max_pages))
  const qs = sp.toString()
  const url = `/api/etsy/shop/receipts${qs ? `?${qs}` : ''}`
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) {
    const j = await r.json().catch(() => ({} as any))
    return { ok: false, detail: (j as any)?.detail }
  }
  return r.json()
}

// Preferences (including billing fields)
export type EtsyPrefs = {
  shop_id: string
  taxonomy_id: string
  billing_name?: string
  billing_address1?: string
  billing_address2?: string
  billing_city?: string
  billing_state?: string
  billing_zip?: string
  billing_country?: string
  billing_tax_id?: string
  billing_email?: string
}

export async function etsyGetPrefs(): Promise<EtsyPrefs> {
  const r = await fetch('/api/etsy/prefs', { cache: 'no-store' })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j as any)?.detail || 'Failed to fetch Etsy prefs')
  }
  return r.json()
}

export async function etsySetPrefs(p: Partial<EtsyPrefs>): Promise<EtsyPrefs> {
  const r = await fetch('/api/etsy/prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(p ?? {}),
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error((j as any)?.detail || 'Failed to save Etsy prefs')
  }
  return r.json()
}
