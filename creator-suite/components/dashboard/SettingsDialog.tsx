"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export function SettingsDialog() {
  const [connected, setConnected] = React.useState<boolean>(false)
  const [checking, setChecking] = React.useState<boolean>(true)
  const [loadingPrefs, setLoadingPrefs] = React.useState<boolean>(true)
  const [savingPrefs, setSavingPrefs] = React.useState<boolean>(false)
  const [shopId, setShopId] = React.useState<string>("")
  const [taxonomyId, setTaxonomyId] = React.useState<string>("")
  // Billing fields
  const [billingName, setBillingName] = React.useState<string>("")
  const [billingAddress1, setBillingAddress1] = React.useState<string>("")
  const [billingAddress2, setBillingAddress2] = React.useState<string>("")
  const [billingCity, setBillingCity] = React.useState<string>("")
  const [billingState, setBillingState] = React.useState<string>("")
  const [billingZip, setBillingZip] = React.useState<string>("")
  const [billingCountry, setBillingCountry] = React.useState<string>("")
  const [billingTaxId, setBillingTaxId] = React.useState<string>("")
  const [billingEmail, setBillingEmail] = React.useState<string>("")

  React.useEffect(() => {
    checkStatus()
    loadPrefs()
    const onMsg = (ev: MessageEvent) => {
      if (ev?.data?.type === "etsyConnected") {
        try { localStorage.setItem("etsy_connected", "true") } catch {}
        setConnected(true)
        toast.success("Etsy connecté")
      }
    }
    window.addEventListener("message", onMsg)
    // Reload when dialog is opened via global event
    const onOpen = () => { checkStatus(); loadPrefs() }
    window.addEventListener("open-settings", onOpen as any)
    return () => {
      window.removeEventListener("message", onMsg)
      window.removeEventListener("open-settings", onOpen as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkStatus() {
    setChecking(true)
    try {
      const r = await fetch("/api/etsy/auth/status")
      if (r.ok) {
        const j = await r.json()
        setConnected(!!j?.connected)
        try { localStorage.setItem("etsy_connected", j?.connected ? "true" : "false") } catch {}
      }
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }

  async function loadPrefs() {
    setLoadingPrefs(true)
    try {
      const r = await fetch("/api/etsy/prefs")
      if (r.ok) {
        const j = await r.json()
        if (typeof j?.shop_id === "string") setShopId(j.shop_id)
        if (typeof j?.taxonomy_id === "string") setTaxonomyId(j.taxonomy_id)
        if (typeof j?.billing_name === "string") setBillingName(j.billing_name)
        if (typeof j?.billing_address1 === "string") setBillingAddress1(j.billing_address1)
        if (typeof j?.billing_address2 === "string") setBillingAddress2(j.billing_address2)
        if (typeof j?.billing_city === "string") setBillingCity(j.billing_city)
        if (typeof j?.billing_state === "string") setBillingState(j.billing_state)
        if (typeof j?.billing_zip === "string") setBillingZip(j.billing_zip)
        if (typeof j?.billing_country === "string") setBillingCountry(j.billing_country)
        if (typeof j?.billing_tax_id === "string") setBillingTaxId(j.billing_tax_id)
        if (typeof j?.billing_email === "string") setBillingEmail(j.billing_email)
      }
    } catch {
      // ignore
    } finally {
      setLoadingPrefs(false)
    }
  }

  async function savePrefs() {
    setSavingPrefs(true)
    try {
      const r = await fetch("/api/etsy/prefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taxonomy_id: taxonomyId,
          billing_name: billingName,
          billing_address1: billingAddress1,
          billing_address2: billingAddress2,
          billing_city: billingCity,
          billing_state: billingState,
          billing_zip: billingZip,
          billing_country: billingCountry,
          billing_tax_id: billingTaxId,
          billing_email: billingEmail,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.detail || "Échec de l'enregistrement")
      }
      toast.success("Préférences enregistrées")
    } catch (e: any) {
      toast.error(typeof e?.message === "string" ? e.message : "Erreur inconnue")
    } finally {
      setSavingPrefs(false)
    }
  }

  async function connectEtsy() {
    try {
      const r = await fetch("/api/etsy/auth/start")
      if (r.ok) {
        let url: string | undefined
        try {
          const j = await r.clone().json()
          url = j?.url
        } catch {}
        const target = url || "/api/etsy/auth/start"
        const w = window.open(target, "etsy-oauth", "width=800,height=700")
        if (!w) toast.info("Popup bloquée. Autorise les popups et réessaie.")
        return
      }
      // Not OK -> try direct open
      const w = window.open("/api/etsy/auth/start", "etsy-oauth", "width=800,height=700")
      if (!w) toast.info("Popup bloquée. Autorise les popups et réessaie.")
    } catch (e: any) {
      // Network/parse issues -> try direct open
      const w = window.open("/api/etsy/auth/start", "etsy-oauth", "width=800,height=700")
      if (!w) toast.info("Popup bloquée. Autorise les popups et réessaie.")
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-base font-medium">Connexion Etsy</div>
            <div className="text-xs text-muted-foreground">Connecte ta boutique pour créer des drafts automatiquement.</div>
          </div>
          {checking ? (
            <Skeleton className="h-6 w-28 rounded-full" />
          ) : (
            <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600" : ""}>
              {connected ? "Connecté" : "Non connecté"}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {checking ? (
            <>
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-40" />
            </>
          ) : (
            <>
              <Button onClick={connectEtsy} variant="secondary">
                {connected ? "Reconnecter Etsy" : "Connecter Etsy"}
              </Button>
              <Button onClick={checkStatus} disabled={checking}>
                {checking ? "Vérification…" : "Vérifier le statut"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Separator />
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-base font-medium">Préférences Etsy</div>
          <div className="text-xs text-muted-foreground">Configure tes préférences Etsy pour que l'auto-digitalisation fonctionne correctement.</div>
        </div>
        {loadingPrefs ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-32" />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Shop ID</Label>
                <div className="text-sm rounded-md border px-3 py-2 bg-muted/30 break-all select-text">
                  {shopId ? shopId : <span className="text-muted-foreground">—</span>}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="taxo">Taxonomy ID</Label>
                <Input id="taxo" value={taxonomyId} onChange={(e) => setTaxonomyId(e.target.value)} />
              </div>
            </div>
            <div className="pt-2">
              <div className="text-sm font-medium mb-1">Coordonnées de facturation</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="billing_name">Nom/Raison sociale</Label>
                  <Input id="billing_name" value={billingName} onChange={(e) => setBillingName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing_email">Email</Label>
                  <Input id="billing_email" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="billing_address1">Adresse ligne 1</Label>
                  <Input id="billing_address1" value={billingAddress1} onChange={(e) => setBillingAddress1(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="billing_address2">Adresse ligne 2 (optionnel)</Label>
                  <Input id="billing_address2" value={billingAddress2} onChange={(e) => setBillingAddress2(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing_city">Ville</Label>
                  <Input id="billing_city" value={billingCity} onChange={(e) => setBillingCity(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing_state">État/Province</Label>
                  <Input id="billing_state" value={billingState} onChange={(e) => setBillingState(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing_zip">Code postal</Label>
                  <Input id="billing_zip" value={billingZip} onChange={(e) => setBillingZip(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing_country">Pays</Label>
                  <Input id="billing_country" value={billingCountry} onChange={(e) => setBillingCountry(e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="billing_tax_id">N° TVA / SIREN (optionnel)</Label>
                  <Input id="billing_tax_id" value={billingTaxId} onChange={(e) => setBillingTaxId(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={loadPrefs} variant="secondary">
                Recharger
              </Button>
              <Button onClick={savePrefs} disabled={savingPrefs}>
                {savingPrefs ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
