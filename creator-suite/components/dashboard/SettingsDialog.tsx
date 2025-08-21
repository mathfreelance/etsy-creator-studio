"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

export function SettingsDialog() {
  const [connected, setConnected] = React.useState<boolean>(false)
  const [checking, setChecking] = React.useState<boolean>(false)

  React.useEffect(() => {
    checkStatus()
    const onMsg = (ev: MessageEvent) => {
      if (ev?.data?.type === "etsyConnected") {
        try { localStorage.setItem("etsy_connected", "true") } catch {}
        setConnected(true)
        toast.success("Etsy connecté ✅")
      }
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
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
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-base font-medium">Connexion Etsy</div>
          <div className="text-xs text-muted-foreground">Connecte ta boutique pour créer des drafts automatiquement.</div>
        </div>
        <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600" : ""}>
          {connected ? "Connecté" : "Non connecté"}
        </Badge>
      </div>
      <Separator />
      <div className="flex gap-2">
        <Button onClick={connectEtsy} variant="secondary">
          {connected ? "Reconnecter Etsy" : "Connecter Etsy"}
        </Button>
        <Button onClick={checkStatus} disabled={checking}>
          {checking ? "Vérification…" : "Vérifier le statut"}
        </Button>
      </div>
    </div>
  )
}
