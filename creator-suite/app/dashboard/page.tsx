"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { IconAlertCircle, IconExternalLink, IconPlugConnected, IconRefresh, IconShoppingBag, IconHeart, IconEye, IconTrendingUp } from "@tabler/icons-react"
import { HeaderTitle } from "@/components/contexts/header-title-context"
import { useDashboardData } from "@/components/contexts/dashboard-data-context"

export default function Page() {
  const { checking, connected, shop, listings, sales, loading, missingShopId, refresh } = useDashboardData()

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

  // Try to find a shop icon/logo URL across common fields
  const shopRoot = (shop?.results?.[0] ?? shop) as any
  const shopIconUrl: string | undefined =
    shopRoot?.icon_url_fullxfull ||
    shopRoot?.icon_url_90x90 ||
    shopRoot?.shop_icon_url ||
    shopRoot?.image_url ||
    undefined

  // Helpers to normalize price
  const parsePrice = (it: any): number | null => {
    if (!it) return null
    const p = it.price
    if (p == null) return null
    if (typeof p === "string") {
      const n = Number(String(p).replace(/,/g, "."))
      return Number.isFinite(n) ? n : null
    }
    const amount = Number(p?.amount)
    if (Number.isFinite(amount)) return amount / 100
    const n = Number(p?.price || p?.amount_with_tax)
    return Number.isFinite(n) ? n : null
  }

  // Derived stats from listings
  const prices = React.useMemo(() => listings.map(parsePrice).filter((n): n is number => n != null), [listings])
  const totalListings = listings.length
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  const minPrice = prices.length ? Math.min(...prices) : 0
  const maxPrice = prices.length ? Math.max(...prices) : 0
  const totals = React.useMemo(() => {
    let views = 0
    let favs = 0
    for (const it of listings as any[]) {
      views += Number((it as any)?.views || 0)
      favs += Number((it as any)?.num_favorers || 0)
    }
    return { views, favs }
  }, [listings])

  // Local search & sort for listings
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<
    | "recent"
    | "price_asc" | "price_desc"
    | "views_asc" | "views_desc"
    | "favs_asc" | "favs_desc"
    | "sales_asc" | "sales_desc"
  >("recent")
  const [minViews, setMinViews] = React.useState<number | "">("")
  const [minFavs, setMinFavs] = React.useState<number | "">("")
  const [minSales, setMinSales] = React.useState<number | "">("")
  const filteredListings = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let arr = [...listings]
    if (q) arr = arr.filter((it: any) => String(it.title || it.listing_title || "").toLowerCase().includes(q))
    if (minViews !== "") arr = arr.filter((it: any) => Number((it as any)?.views || 0) >= Number(minViews))
    if (minFavs !== "") arr = arr.filter((it: any) => Number((it as any)?.num_favorers || 0) >= Number(minFavs))
    if (minSales !== "") arr = arr.filter((it: any) => Number((it as any)?.sales_count || 0) >= Number(minSales))
    if (sort === "price_asc") arr.sort((a, b) => (parsePrice(a) ?? Infinity) - (parsePrice(b) ?? Infinity))
    if (sort === "price_desc") arr.sort((a, b) => (parsePrice(b) ?? -Infinity) - (parsePrice(a) ?? -Infinity))
    if (sort === "views_desc") arr.sort((a, b) => Number((b as any)?.views || 0) - Number((a as any)?.views || 0))
    if (sort === "views_asc") arr.sort((a, b) => Number((a as any)?.views || 0) - Number((b as any)?.views || 0))
    if (sort === "favs_desc") arr.sort((a, b) => Number((b as any)?.num_favorers || 0) - Number((a as any)?.num_favorers || 0))
    if (sort === "favs_asc") arr.sort((a, b) => Number((a as any)?.num_favorers || 0) - Number((b as any)?.num_favorers || 0))
    if (sort === "sales_desc") arr.sort((a, b) => Number((b as any)?.sales_count || 0) - Number((a as any)?.sales_count || 0))
    if (sort === "sales_asc") arr.sort((a, b) => Number((a as any)?.sales_count || 0) - Number((b as any)?.sales_count || 0))
    // recent: preserve API order
    return arr
  }, [listings, query, sort, minViews, minFavs, minSales])

  return (
    <>
      <HeaderTitle title="Dashboard" />
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
                  {/* Shop header */}
                  <Card className="rounded-2xl">
                    <CardHeader className="flex flex-row items-center gap-4">
                      <Avatar className="size-12">
                        {shopIconUrl ? (
                          <AvatarImage src={shopIconUrl} alt={shopName} />
                        ) : null}
                        <AvatarFallback>{String(shopName || "?").slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          <a
                            href={shopName ? `https://www.etsy.com/shop/${encodeURIComponent(String(shopName))}` : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center hover:underline"
                          >
                            <IconShoppingBag className="size-5" />
                            <span className="ml-1">{shopName}</span>
                          </a>
                          <Badge variant="secondary" className="ml-2">{currency}</Badge>
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 text-sm">Shop ID: {shopId || "N/A"}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void refresh()}>
                          <IconRefresh className="size-4 mr-2" /> Rafraîchir
                        </Button>
                        <Button size="sm" variant="secondary" onClick={openSettings}>Paramètres</Button>
                      </div>
                    </CardHeader>
                  </Card>

                  {/* KPIs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground">Annonces actives</CardTitle>
                        <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-16" /> : totalListings}</div>
                      </CardHeader>
                    </Card>
                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground">Prix moyen</CardTitle>
                        <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-20" /> : `${avgPrice.toFixed(2)} ${currency}`}</div>
                      </CardHeader>
                    </Card>
                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground">Prix min</CardTitle>
                        <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-16" /> : `${minPrice.toFixed(2)} ${currency}`}</div>
                      </CardHeader>
                    </Card>
                    <Card className="rounded-2xl">
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground">Prix max</CardTitle>
                        <div className="text-2xl font-bold">{loading ? <Skeleton className="h-7 w-16" /> : `${maxPrice.toFixed(2)} ${currency}`}</div>
                      </CardHeader>
                    </Card>
                  </div>

                  {(totals.views > 0 || totals.favs > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                      {totals.views > 0 && (
                        <Card className="rounded-2xl">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><IconEye className="size-4" /> Vues (total)</CardTitle>
                            <div className="text-2xl font-bold">{totals.views.toLocaleString()}</div>
                          </CardHeader>
                        </Card>
                      )}
                      {totals.favs > 0 && (
                        <Card className="rounded-2xl">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><IconHeart className="size-4" /> Favoris (total)</CardTitle>
                            <div className="text-2xl font-bold">{totals.favs.toLocaleString()}</div>
                          </CardHeader>
                        </Card>
                      )}
                    </div>
                  )}

                  {/* Sales stats */}
                  <Card className="rounded-2xl mt-6">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><IconTrendingUp className="size-5" /> Statistiques de vente</CardTitle>
                      <CardDescription>Données agrégées à partir des transactions Etsy.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="rounded-xl border p-4">
                              <Skeleton className="h-4 w-1/2" />
                              <Skeleton className="mt-2 h-7 w-24" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="rounded-xl border p-4">
                            <div className="text-sm text-muted-foreground">Ventes (total)</div>
                            <div className="mt-1 text-2xl font-bold">{Number(sales?.total_sales || 0).toLocaleString()}</div>
                          </div>
                          <div className="rounded-xl border p-4">
                            <div className="text-sm text-muted-foreground">Revenus</div>
                            <div className="mt-1 text-2xl font-bold">{Number(sales?.revenue || 0).toFixed(2)} {sales?.currency_code || currency}</div>
                          </div>
                          <div className="rounded-xl border p-4">
                            <div className="text-sm text-muted-foreground">Taux de conversion</div>
                            <div className="mt-1 text-2xl font-bold">{totals.views > 0 ? `${((Number(sales?.total_sales || 0) / totals.views) * 100).toFixed(2)}%` : "—"}</div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Listings section */}
                  <div className="mt-8 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-semibold">Annonces actives</h3>
                        <div className="text-sm text-muted-foreground">{listings.length} éléments</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Rechercher une annonce..."
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="w-64"
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="Min vues"
                          value={minViews}
                          onChange={(e) => setMinViews(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-28"
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="Min favoris"
                          value={minFavs}
                          onChange={(e) => setMinFavs(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-28"
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="Min ventes"
                          value={minSales}
                          onChange={(e) => setMinSales(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-28"
                        />
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                          <SelectTrigger className="h-9 w-[180px]">
                            <SelectValue placeholder="Trier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="recent">Plus récentes</SelectItem>
                            <SelectItem value="price_asc">Prix croissant</SelectItem>
                            <SelectItem value="price_desc">Prix décroissant</SelectItem>
                            <SelectItem value="views_desc">Vues décroissantes</SelectItem>
                            <SelectItem value="views_asc">Vues croissantes</SelectItem>
                            <SelectItem value="favs_desc">Favoris décroissants</SelectItem>
                            <SelectItem value="favs_asc">Favoris croissants</SelectItem>
                            <SelectItem value="sales_desc">Ventes décroissantes</SelectItem>
                            <SelectItem value="sales_asc">Ventes croissantes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Card className="rounded-2xl">
                      <CardContent className="p-0">
                        {loading ? (
                          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => (
                              <div key={i} className="rounded-xl border p-4">
                                <Skeleton className="h-4 w-3/4" />
                                <div className="mt-2 space-y-2">
                                  <Skeleton className="h-3 w-1/2" />
                                  <Skeleton className="h-3 w-1/3" />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : filteredListings.length === 0 ? (
                          <div className="p-6 text-sm text-muted-foreground">Aucune annonce trouvée.</div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Titre</TableHead>
                                <TableHead>Prix</TableHead>
                                <TableHead>État</TableHead>
                                <TableHead>Favoris</TableHead>
                                <TableHead>Vues</TableHead>
                                <TableHead>Ventes</TableHead>
                                <TableHead className="text-right">Lien</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredListings.map((it: any, idx: number) => {
                                const id = it.listing_id || it.id || it.listingId
                                const title = it.title || it.listing_title || `Listing #${id || idx + 1}`
                                const state = it.state || "active"
                                const numeric = parsePrice(it)
                                const priceStr =
                                  typeof it.price === "string"
                                    ? it.price
                                    : it.price?.amount && it.price?.currency_code
                                    ? `${(Number(it.price.amount) / 100).toFixed(2)} ${it.price.currency_code}`
                                    : numeric != null
                                    ? `${numeric.toFixed(2)} ${currency}`
                                    : "—"
                                const favs = Number((it as any)?.num_favorers || 0)
                                const views = Number((it as any)?.views || 0)
                                const salesCount = Number((it as any)?.sales_count || 0)
                                const salesRevenue = Number((it as any)?.sales_revenue || 0)
                                const link = id ? `https://www.etsy.com/listing/${id}` : undefined
                                return (
                                  <TableRow key={id || idx}>
                                    <TableCell className="max-w-[420px]">
                                      <div className="font-medium line-clamp-1">{title}</div>
                                      <div className="text-xs text-muted-foreground">#{id}</div>
                                    </TableCell>
                                    <TableCell className="font-mono">{priceStr}</TableCell>
                                    <TableCell><Badge variant="secondary">{String(state)}</Badge></TableCell>
                                    <TableCell>{favs ? favs.toLocaleString() : "—"}</TableCell>
                                    <TableCell>{views ? views.toLocaleString() : "—"}</TableCell>
                                    <TableCell>
                                      {salesCount ? (
                                        <div>
                                          <div>{salesCount.toLocaleString()}</div>
                                          {salesRevenue ? (
                                            <div className="text-xs text-muted-foreground">{salesRevenue.toFixed(2)} {currency}</div>
                                          ) : null}
                                        </div>
                                      ) : "—"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {link && (
                                        <Button asChild size="sm" variant="outline">
                                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center">
                                            <IconExternalLink className="size-4 mr-2" /> Voir
                                          </a>
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )
            )}
    </>
  )
}
