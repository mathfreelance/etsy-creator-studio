"use client"

import React from "react"
import { toast } from "sonner"
import { etsyAuthStatus, etsyGetShop, etsyGetShopListings, extractListingsArray, etsyGetShopSales, EtsySalesResponse } from "@/lib/etsy"

export type DashboardDataCtx = {
  checking: boolean
  connected: boolean
  shop: any | null
  listings: any[]
  sales: EtsySalesResponse | null
  loading: boolean
  missingShopId: boolean
  hasLoaded: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = React.createContext<DashboardDataCtx | null>(null)

export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = React.useState(true)
  const [connected, setConnected] = React.useState(false)
  const [shop, setShop] = React.useState<any | null>(null)
  const [listings, setListings] = React.useState<any[]>([])
  const [sales, setSales] = React.useState<EtsySalesResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [missingShopId, setMissingShopId] = React.useState(false)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const initInFlight = React.useRef<Promise<void> | null>(null)

  async function loadData() {
    setLoading(true)
    setMissingShopId(false)
    try {
      // Fetch shop and all active listings (paginate until complete)
      const [s] = await Promise.all([
        etsyGetShop(),
      ])
      setShop(s)

      const all: any[] = []
      const limit = 100
      let offset = 0
      let total: number | undefined = undefined
      // Loop with sane upper bound in case API doesn't return count reliably
      for (let page = 0; page < 100; page++) {
        const resp = await etsyGetShopListings({ state: "active", limit, offset })
        const arr = extractListingsArray(resp)
        if (typeof (resp as any)?.count === "number") total = (resp as any).count
        if (typeof (resp as any)?.total === "number") total = (resp as any).total
        if (Array.isArray(arr) && arr.length) {
          all.push(...arr)
        }
        // Stop if fewer than requested returned, or we've met the known total
        if (!arr || arr.length < limit) break
        if (typeof total === "number" && all.length >= total) break
        offset += limit
      }

      // Fetch sales and merge per-listing stats
      let salesResp: EtsySalesResponse | null = null
      try {
        salesResp = await etsyGetShopSales({ limit: 100, max_pages: 10 })
      } catch {
        salesResp = null
      }
      setSales(salesResp)

      if (salesResp && salesResp.by_listing) {
        const by = salesResp.by_listing
        const merged = all.map((it: any) => {
          const id = it.listing_id || it.id || it.listingId
          const k = id != null ? String(id) : undefined
          const agg = (k && by[k]) ? by[k] : undefined
          return { ...it, sales_count: agg?.sales || 0, sales_revenue: agg?.revenue || 0 }
        })
        setListings(merged)
      } else {
        setListings(all)
      }
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : ""
      if (msg.toLowerCase().includes("missing shop_id")) {
        setMissingShopId(true)
      } else if (msg) {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  async function init() {
    if (hasLoaded) return
    if (initInFlight.current) return initInFlight.current
    initInFlight.current = (async () => {
      setChecking(true)
      try {
        const st = await etsyAuthStatus()
        const isConnected = !!st.connected
        setConnected(isConnected)
        if (isConnected) {
          await loadData()
        }
      } catch {
        // ignore
      } finally {
        setChecking(false)
        setHasLoaded(true)
        initInFlight.current = null
      }
    })()
    return initInFlight.current
  }

  async function refresh() {
    if (!connected) {
      // Re-check connection then load if connected
      setChecking(true)
      try {
        const st = await etsyAuthStatus()
        const isConnected = !!st.connected
        setConnected(isConnected)
        if (isConnected) await loadData()
      } catch {
        // ignore
      } finally {
        setChecking(false)
      }
      return
    }
    await loadData()
  }

  // Auto-initialize on first mount so consumers don't need to call init() manually
  React.useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: DashboardDataCtx = React.useMemo(
    () => ({ checking, connected, shop, listings, sales, loading, missingShopId, hasLoaded, init, refresh }),
    [checking, connected, shop, listings, sales, loading, missingShopId, hasLoaded]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDashboardData() {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("useDashboardData must be used within DashboardDataProvider")
  return ctx
}
