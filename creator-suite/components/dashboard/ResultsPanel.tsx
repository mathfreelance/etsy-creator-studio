"use client"

import React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Download, Image as ImageIcon, Images, Film, FileText, Copy } from "lucide-react"
import type { ParsedPackage } from "@/lib/zip"
import { toast } from "sonner"

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export interface ResultsPanelProps {
  data: ParsedPackage
  onDownload?: () => void
  filename?: string
}

export function ResultsPanel({ data, onDownload, filename }: ResultsPanelProps) {
  const [etsyConnected, setEtsyConnected] = React.useState<boolean>(false)
  const [creating, setCreating] = React.useState<boolean>(false)
  const [price, setPrice] = React.useState<string>("5.00")
  const [quantity, setQuantity] = React.useState<string>("10")

  React.useEffect(() => {
    try {
      const v = localStorage.getItem("etsy_connected")
      setEtsyConnected(v === "true")
    } catch {}
    ;(async () => {
      try {
        const r = await fetch("/api/etsy/auth/status")
        if (r.ok) {
          const j = await r.json()
          setEtsyConnected(!!j?.connected)
          try { localStorage.setItem("etsy_connected", j?.connected ? "true" : "false") } catch {}
        }
      } catch {}
    })()
    const onMsg = (ev: MessageEvent) => {
      if (ev?.data?.type === "etsyConnected") {
        try { localStorage.setItem("etsy_connected", "true") } catch {}
        setEtsyConnected(true)
      }
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [])

  const copy = (text: string) => {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copié dans le presse-papiers"))
      .catch(() => toast.error("Impossible de copier"))
  }

  const downloadUrl = (url: string, filename?: string) => {
    try {
      const a = document.createElement('a')
      a.href = url
      if (filename) a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      toast.error("Téléchargement impossible")
    }
  }

  function openSettings() {
    try { window.dispatchEvent(new Event('open-settings')) } catch {}
  }

  async function connectEtsy() {
    openSettings()
  }

  async function createEtsyDraft() {
    if (!data.processedImageUrl) {
      toast.error("Aucune image traitée disponible")
      return
    }
    // Ensure we are connected before proceeding
    try {
      const r = await fetch("/api/etsy/auth/status")
      if (!r.ok) throw new Error()
      const j = await r.json()
      if (!j?.connected) {
        try { localStorage.setItem("etsy_connected", "false") } catch {}
        setEtsyConnected(false)
        toast.error("Authentification Etsy requise. Ouvre les paramètres pour te connecter.")
        openSettings()
        return
      }
    } catch {}
    setCreating(true)
    const promise = (async () => {
      const blob = await fetch(data.processedImageUrl!).then((r) => r.blob())
      if (blob.size > 20 * 1024 * 1024) {
        throw new Error("Le fichier digital dépasse 20 Mo")
      }
      const fd = new FormData()
      fd.append("processed", new File([blob], "processed.png", { type: "image/png" }))
      // Use the same image as listing image by default
      fd.append("image", new File([blob], "image.png", { type: "image/png" }))

      const texts = data.texts
      if (texts?.title) fd.append("title", texts.title)
      if (texts?.description) fd.append("description", texts.description)
      if (texts?.tags) fd.append("tags", texts.tags)
      if (texts?.alt_seo) fd.append("alt_seo", texts.alt_seo)

      fd.append("price", Number(price || 0).toFixed(2))
      fd.append("quantity", String(Math.max(1, Number(quantity || 1))))

      // Optional: explicit attributes override (server has defaults too)
      fd.append("orientation", "vertical")
      fd.append("pieces_included", "1")

      // Attach mockup images if available (as repeated `mockups` fields)
      if (data.mockups?.length) {
        for (let i = 0; i < data.mockups.length; i++) {
          const m = data.mockups[i]
          try {
            const mb = await fetch(m.url).then((r) => r.blob())
            if (mb && mb.size > 0) {
              const name = m.name || `mockup-${i + 1}.png`
              fd.append("mockups", new File([mb], name, { type: mb.type || "image/png" }))
            }
          } catch {}
        }
      }

      // Attach video preview if available
      if (data.videoUrl) {
        try {
          const vb = await fetch(data.videoUrl).then((r) => r.blob())
          if (vb && vb.size > 0) {
            fd.append("video", new File([vb], "preview.mp4", { type: vb.type || "video/mp4" }))
          }
        } catch {}
      }

      const resp = await fetch("/api/etsy/listings/draft", { method: "POST", body: fd })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        if (resp.status === 401) {
          try { localStorage.setItem("etsy_connected", "false") } catch {}
          setEtsyConnected(false)
          openSettings()
          throw new Error("Authentification Etsy requise. Ouvre les paramètres pour te connecter.")
        }
        throw new Error(json?.detail || "Création du draft Etsy a échoué")
      }
      const id = json?.listing_id || json?.listing?.listing_id
      const sku = json?.sku
      return { id, sku }
    })()

    toast.promise(promise, {
      loading: "Création du draft Etsy…",
      success: ({ id, sku }) => `Draft Etsy créé (ID ${id || "?"}${sku ? `, SKU ${sku}` : ""})`,
      error: (e) => (typeof e?.message === 'string' ? e.message : 'Erreur inconnue'),
    })

    try {
      await promise
    } finally {
      setCreating(false)
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex md:flex-row items-start md:items-center justify-between gap-2">
        <div>
          <CardTitle>Résultats</CardTitle>
          <CardDescription>Prévisualise et télécharge le package si besoin</CardDescription>
        </div>
        {onDownload && (
          <Button onClick={onDownload} size="sm">
            <Download className="size-4 mr-2" /> Télécharger ZIP{filename ? ` (${filename})` : ""}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {data.processedImageUrl && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="size-4" /> Image améliorée
            </div>
            <div className="relative group">
              <img src={data.processedImageUrl} alt="Processed" className="w-full rounded-lg border" />
              <div className="pointer-events-none absolute top-2 right-2 hidden group-hover:block">
                <Button
                  aria-label="Télécharger l'image améliorée"
                  className="pointer-events-auto h-8 w-8 p-0 rounded-full shadow"
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadUrl(data.processedImageUrl!, 'processed.png')}
                >
                  <Download className="size-4" />
                </Button>
              </div>
            </div>
            {typeof data.processedImageSize === 'number' && (
              <div className="text-xs text-muted-foreground">Taille: {formatBytes(data.processedImageSize)}</div>
            )}
          </section>
        )}

        {data.mockups?.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Images className="size-4" /> Mockups ({data.mockups.length})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {data.mockups.map((m, i) => (
                <div key={i} className="space-y-1">
                  <div className="relative group">
                    <img src={m.url} alt={m.name} className="w-full rounded-lg border" />
                    <div className="pointer-events-none absolute top-2 right-2 hidden group-hover:block">
                      <Button
                        aria-label="Télécharger ce mockup"
                        className="pointer-events-auto h-8 w-8 p-0 rounded-full shadow"
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadUrl(m.url, m.name || `mockup-${i + 1}.png`)}
                      >
                        <Download className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{m.name}</div>
                  {typeof m.size === 'number' && (
                    <div className="text-xs text-muted-foreground">Taille: {formatBytes(m.size)}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {data.videoUrl && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Film className="size-4" /> Vidéo
            </div>
            <div className="relative group">
              <video controls className="w-full rounded-lg border">
                <source src={data.videoUrl} type="video/mp4" />
              </video>
              <div className="pointer-events-none absolute top-2 right-2 hidden group-hover:block">
                <Button
                  aria-label="Télécharger la vidéo"
                  className="pointer-events-auto h-8 w-8 p-0 rounded-full shadow"
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadUrl(data.videoUrl!, 'preview.mp4')}
                >
                  <Download className="size-4" />
                </Button>
              </div>
            </div>
            {typeof data.videoSize === 'number' && (
              <div className="text-xs text-muted-foreground">Taille: {formatBytes(data.videoSize)}</div>
            )}
          </section>
        )}

        {data.texts && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" /> Textes
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium">Titre</div>
                  <span className="text-xs text-muted-foreground">{data.texts.title.length}/140</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => copy(data.texts!.title)}>
                  <Copy className="size-4 mr-1" /> Copier
                </Button>
              </div>
              <div className="text-sm">{data.texts.title}</div>
              <Separator />
              {data.texts.alt_seo && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">Alt SEO</div>
                      <span className="text-xs text-muted-foreground">{data.texts.alt_seo.length}/500</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => copy(data.texts!.alt_seo!)}>
                      <Copy className="size-4 mr-1" /> Copier
                    </Button>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{data.texts.alt_seo}</div>
                  <Separator />
                </>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium">Description</div>
                  <span className="text-xs text-muted-foreground">{data.texts.description.length}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => copy(data.texts!.description)}>
                  <Copy className="size-4 mr-1" /> Copier
                </Button>
              </div>
              <div className="text-sm whitespace-pre-wrap">{data.texts.description}</div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium">Tags</div>
                  <span className="text-xs text-muted-foreground">{data.texts.tags.split(',').map(t => t.trim()).filter(Boolean).length}/13</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => copy(data.texts!.tags)}>
                  <Copy className="size-4 mr-1" /> Copier
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.texts.tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((t, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer select-none hover:bg-white/10"
                      title="Cliquer pour copier ce tag"
                      onClick={() => copy(t)}
                    >
                      {t}
                    </Badge>
                  ))}
              </div>
            </div>
          </section>
        )}

        {/* Etsy integration */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Etsy</div>
            <div className={`text-xs ${etsyConnected ? "text-green-600" : "text-muted-foreground"}`}>
              {etsyConnected ? "Connecté" : "Non connecté"}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="price">Prix (EUR)</Label>
              <Input id="price" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qty">Quantité</Label>
              <Input id="qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={connectEtsy}>
              {etsyConnected ? "Reconnecter Etsy" : "Connecter Etsy"}
            </Button>
            <Button onClick={createEtsyDraft} disabled={creating || !data.processedImageUrl}>
              {creating ? "Création…" : "Créer un draft Etsy"}
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

