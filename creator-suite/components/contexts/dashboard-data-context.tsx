"use client"

import React from "react"
import { toast } from "sonner"
import { etsyAuthStatus, etsyGetShop, etsyGetShopListings, extractListingsArray } from "@/lib/etsy"

export type DashboardDataCtx = {
  checking: boolean
  connected: boolean
  shop: any | null
  listings: any[]
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
  const [loading, setLoading] = React.useState(false)
  const [missingShopId, setMissingShopId] = React.useState(false)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const initInFlight = React.useRef<Promise<void> | null>(null)

  async function loadData() {
    setLoading(true)
    setMissingShopId(false)
    try {
      const [s, l] = await Promise.all([
        etsyGetShop(),
        etsyGetShopListings({ state: "active", limit: 24, offset: 0 }),
      ])
      setShop(s)
      setListings(extractListingsArray(l))
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
    () => ({ checking, connected, shop, listings, loading, missingShopId, hasLoaded, init, refresh }),
    [checking, connected, shop, listings, loading, missingShopId, hasLoaded]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDashboardData() {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("useDashboardData must be used within DashboardDataProvider")
  return ctx
}
