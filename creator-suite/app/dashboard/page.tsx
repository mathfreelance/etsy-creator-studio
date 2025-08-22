"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { IconAlertCircle, IconExternalLink, IconPlugConnected, IconRefresh, IconShoppingBag } from "@tabler/icons-react"
import { HeaderTitle } from "@/components/contexts/header-title-context"
import { useDashboardData } from "@/components/contexts/dashboard-data-context"
import Link from "next/link"

export default function Page() {
  const { checking, connected, shop, listings, loading, missingShopId, refresh } = useDashboardData()

  React.useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev?.data?.type === "etsyConnected") {
        void refresh()
        toast.success("Etsy connecté")
      }
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function connectEtsy() {
    // Mirrors SettingsDialog logic to open OAuth in a popup
    fetch("/api/etsy/auth/start")
      .then((r) => (r.ok ? r.clone().json().catch(() => ({})) : {}))
      .then((j) => {
        const target = (j as any)?.url || "/api/etsy/auth/start"
        const w = window.open(target, "etsy-oauth", "width=800,height=700")
        if (!w) toast.info("Popup bloquée. Autorise les popups et réessaie.")
      })
      .catch(() => {
        const w = window.open("/api/etsy/auth/start", "etsy-oauth", "width=800,height=700")
        if (!w) toast.info("Popup bloquée. Autorise les popups et réessaie.")
      })
  }

  function openSettings() {
    window.dispatchEvent(new Event("open-settings"))
  }

  const shopName =
    (shop && (shop.shop_name || shop.name || shop.title)) ||
    (shop && shop.results && shop.results[0] && (shop.results[0].shop_name || shop.results[0].name)) ||
    "Ma boutique"
  const shopId = (shop && (shop.shop_id || shop.id)) ||
    (shop && shop.results && shop.results[0] && (shop.results[0].shop_id || shop.results[0].id))
  const currency = (shop && (shop.currency_code || shop.currency)) || "EUR"

  return (
    <>
      <HeaderTitle title="Dashboard" />
      <div className="flex flex-1 flex-col">
        <div className="container max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Etsy Shop</h2>
              <p className="text-sm text-muted-foreground">Vue d'ensemble de ta boutique Etsy et de tes annonces actives.</p>
            </div>

            {checking ? (
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-20" />
              </div>
            ) : !connected ? (
              <Card className="rounded-2xl border-dashed">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <IconAlertCircle className="size-5 text-amber-600" />
                    Non connecté à Etsy
                  </CardTitle>
                  <CardDescription>
                    Connecte ta boutique pour afficher tes données Etsy.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={connectEtsy}>
                    <IconPlugConnected className="size-4 mr-2" /> Connecter Etsy
                  </Button>
                  <Button onClick={openSettings} variant="secondary">
                    Ouvrir les paramètres
                  </Button>
                </CardContent>
              </Card>
            ) : (
              missingShopId ? (
                <Card className="rounded-2xl border-dashed">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <IconAlertCircle className="size-5 text-amber-600" />
                      Shop ID manquant
                    </CardTitle>
                    <CardDescription>
                      Nous n'avons pas encore détecté ton Shop ID. Clique sur « Connecter Etsy » pour l'auto-détecter après connexion,
                      ou ouvre les paramètres pour le renseigner manuellement.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Button onClick={connectEtsy}>
                      <IconPlugConnected className="size-4 mr-2" /> Connecter Etsy
                    </Button>
                    <Button onClick={openSettings} variant="secondary">
                      Ouvrir les paramètres
                    </Button>
                    <Button onClick={() => void refresh()} variant="outline">
                      <IconRefresh className="size-4 mr-2" /> Réessayer
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <IconShoppingBag className="size-5" />
                          {shopName}
                          <Badge variant="secondary" className="ml-2">{currency}</Badge>
                        </CardTitle>
                        <CardDescription>Shop ID: {shopId || "N/A"}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {loading ? (
                          <Skeleton className="h-5 w-40" />
                        ) : (
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Annonces actives:</span>
                              <span className="font-medium">{listings.length}</span>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => void refresh()}>
                              <IconRefresh className="size-4 mr-2" /> Rafraîchir
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle>Aide & Raccourcis</CardTitle>
                        <CardDescription>Accède rapidement aux actions Etsy.</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2">
                        <Button asChild variant="outline">
                          <Link href="/dashboard/creator-studio" className="flex items-center">
                            Aller au Creator Studio
                          </Link>
                        </Button>
                        <Button variant="secondary" onClick={openSettings}>Paramètres Etsy</Button>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold">Annonces actives</h3>
                      <div className="text-sm text-muted-foreground">{listings.length} éléments</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {loading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="rounded-xl border p-4">
                            <Skeleton className="h-24 w-full rounded-lg" />
                            <div className="mt-3 space-y-2">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-4 w-1/2" />
                            </div>
                          </div>
                        ))
                      ) : listings.length === 0 ? (
                        <div className="col-span-full text-sm text-muted-foreground">Aucune annonce active trouvée.</div>
                      ) : (
                        listings.map((it, idx) => {
                          const id = it.listing_id || it.id || it.listingId
                          const title = it.title || it.listing_title || `Listing #${id || idx + 1}`
                          const state = it.state || it.state_tsz || "active"
                          const price = (typeof it.price === 'string') ? it.price : (it.price?.amount && it.price?.currency_code ? `${(Number(it.price.amount) / 100).toFixed(2)} ${it.price.currency_code}` : undefined)
                          const link = id ? `https://www.etsy.com/listing/${id}` : undefined
                          return (
                            <div key={id || idx} className="rounded-xl border p-4">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium line-clamp-1">{title}</div>
                                  <Badge variant="secondary" className="shrink-0">{String(state)}</Badge>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {price ? price : id ? `#${id}` : ""}
                                </div>
                              </div>
                              {link && (
                                <div className="mt-3">
                                  <Button asChild size="sm" variant="outline">
                                    <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center">
                                      <IconExternalLink className="size-4 mr-2" /> Voir sur Etsy
                                    </a>
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </>
              )
            )}
        </div>
      </div>
    </>
  )
}
