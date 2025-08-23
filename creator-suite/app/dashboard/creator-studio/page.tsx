"use client"

import React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Image as ImageIcon, Loader2, Download, Trash2, Eye, Settings, Play, X } from "lucide-react"

import { HeaderTitle } from "@/components/contexts/header-title-context"
import { OptionsPanel, type Options } from "@/components/dashboard/OptionsPanel"
import { processImage, downloadBlob, abortProcess } from "@/lib/api"
import { parseProcessZip, type ParsedPackage } from "@/lib/zip"
import { ResultsPanel } from "@/components/dashboard/ResultsPanel"
import { type StepKey } from "@/components/dashboard/ProgressPanel"
import { toast } from "sonner"

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_BYTES = 15 * 1024 * 1024 // 15MB
const CONCURRENCY = 3

type JobStatus = "queued" | "running" | "done" | "error" | "cancelled"

type PublishState = {
  status: "idle" | "pending" | "done" | "error"
  listingId?: string
  error?: string
}

type Job = {
  id: string
  file: File
  previewUrl: string
  status: JobStatus
  rid?: string | null
  stepOrder: StepKey[]
  stepStatus: Record<string, "pending" | "started" | "done">
  es?: EventSource | null
  controller?: AbortController | null
  result?: ParsedPackage
  zip?: Blob
  zipFilename?: string
  error?: string
  publish: PublishState
}

function computeSteps(opts: Options): StepKey[] {
  const arr: StepKey[] = ["image"]
  if (opts.mockups) arr.push("mockups")
  if (opts.video) arr.push("video")
  if (opts.texts.enabled) arr.push("texts")
  arr.push("zip")
  return arr
}

// Simple JPEG conversion for Etsy digital file friendliness
async function toJpeg(blob: Blob, quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas non supporté'))
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((b) => {
          if (!b) {
            reject(new Error('Conversion JPEG échouée'))
            return
          }
          resolve(b)
        }, 'image/jpeg', quality)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Chargement image échoué'))
    }
    img.src = url
  })
}

async function etsyConnected(): Promise<boolean> {
  try {
    const r = await fetch("/api/etsy/auth/status", { cache: "no-store" })
    if (!r.ok) return false
    const j = await r.json()
    return !!j?.connected
  } catch {
    return false
  }
}

async function publishDraftFromParsed(
  data: ParsedPackage,
  price = "5.00",
  quantity = "10",
  opts?: { skipAuthCheck?: boolean }
) {
  if (!data.processedImageUrl) throw new Error("Aucune image traitée disponible")
  // ensure auth
  if (!opts?.skipAuthCheck) {
    const connected = await etsyConnected()
    if (!connected) {
      window.dispatchEvent(new Event('open-settings'))
      throw new Error("Authentification Etsy requise. Ouvre les paramètres pour te connecter.")
    }
  }
  const srcBlob = await fetch(data.processedImageUrl).then((r) => r.blob())
  const jpegBlob = await toJpeg(srcBlob, 1)
  if (jpegBlob.size > 20 * 1024 * 1024) {
    throw new Error("Le fichier digital dépasse 20 Mo après conversion JPEG")
  }
  const fd = new FormData()
  fd.append("processed", new File([jpegBlob], "digital.jpg", { type: "image/jpeg" }))
  fd.append("image", new File([jpegBlob], "image.jpg", { type: "image/jpeg" }))

  const texts = data.texts
  if (texts?.title) fd.append("title", texts.title)
  if (texts?.description) fd.append("description", texts.description)
  if (texts?.tags) fd.append("tags", texts.tags)
  if (texts?.alt_seo) fd.append("alt_seo", texts.alt_seo)

  fd.append("price", Number(price || 0).toFixed(2))
  fd.append("quantity", String(Math.max(1, Number(quantity || 1))))
  fd.append("orientation", "vertical")
  fd.append("pieces_included", "1")

  if (data.mockups?.length) {
    for (let i = 0; i < data.mockups.length; i++) {
      const m = data.mockups[i]
      try {
        const mb = await fetch(m.url).then((r) => r.blob())
        if (mb && mb.size > 0) {
          const name = m.name || `mockup-${i + 1}.png`
          fd.append("mockups", new File([mb], name, { type: mb.type || "image/png" as any }))
        }
      } catch {}
    }
  }

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
      window.dispatchEvent(new Event('open-settings'))
      throw new Error("Authentification Etsy requise. Ouvre les paramètres pour te connecter.")
    }
    throw new Error(json?.detail || "Création du draft Etsy a échoué")
  }
  const id = json?.listing_id || json?.listing?.listing_id
  const sku = json?.sku
  return { id, sku }
}

export default function BatchPage() {
  const [options, setOptions] = React.useState<Options>({
    dpi: 300,
    mockups: true,
    video: true,
    texts: { enabled: true, title: true, alt: true, description: true, tags: true },
    enhance: { enabled: true, scale: 4 },
  })
  const [autoPublish, setAutoPublish] = React.useState<"off" | "draft">("off")
  const [etsyPrice, setEtsyPrice] = React.useState<string>("5.00")
  const [etsyQuantity, setEtsyQuantity] = React.useState<string>("10")
  const [jobs, setJobs] = React.useState<Job[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [dialogJobId, setDialogJobId] = React.useState<string | null>(null)
  // Prevent duplicate starts (e.g., StrictMode, rapid schedule calls)
  const startingRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => () => {
    // cleanup on unmount
    setJobs((prev) => {
      prev.forEach((j) => {
        try { j.es?.close() } catch {}
        try { j.controller?.abort() } catch {}
        try { j.result?.release?.() } catch {}
        try { URL.revokeObjectURL(j.previewUrl) } catch {}
      })
      return prev
    })
  }, [])

  const hasFiles = jobs.length > 0
  const runningCount = jobs.filter((j) => j.status === "running").length

  function validate(file: File): string | null {
    if (!ACCEPTED_TYPES.includes(file.type)) return "Types acceptés: JPG, PNG, WEBP."
    if (file.size > MAX_BYTES) return "Image trop lourde (max 15 Mo)."
    return null
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const added: Job[] = []
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      const err = validate(f)
      if (err) {
        toast.error(`${f.name}: ${err}`)
        continue
      }
      const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
      const previewUrl = URL.createObjectURL(f)
      const stepOrder = computeSteps(options)
      const stepStatus: Record<string, "pending" | "started" | "done"> = {}
      for (const s of stepOrder) stepStatus[s] = "pending"
      added.push({
        id,
        file: f,
        previewUrl,
        status: "queued",
        rid: null,
        stepOrder,
        stepStatus,
        es: null,
        controller: null,
        publish: { status: "idle" },
      })
    }
    if (added.length) setJobs((prev) => [...prev, ...added])
  }

  function removeJob(id: string) {
    setJobs((prev) => {
      const j = prev.find((x) => x.id === id)
      if (j?.status === "running" && j.rid) {
        // try cancel then remove
        abortProcess(j.rid).catch(() => {})
        try { j.es?.close() } catch {}
        try { j.controller?.abort() } catch {}
      }
      if (j?.result) {
        try { j.result.release() } catch {}
      }
      try { if (j?.previewUrl) URL.revokeObjectURL(j.previewUrl) } catch {}
      // clear idempotency guard if present
      startingRef.current.delete(id)
      return prev.filter((x) => x.id !== id)
    })
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function toggleSelect(id: string, checked?: boolean | "indeterminate") {
    setSelected((prev) => {
      const next = new Set(prev)
      const shouldCheck = checked !== undefined ? Boolean(checked) : !next.has(id)
      if (shouldCheck) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(jobs.map((j) => j.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function startQueued() {
    // Compute synchronously to avoid relying on setState ordering
    const running = jobs.filter((j) => j.status === "running").length
    const active = Math.max(running, startingRef.current.size)
    const capacity = Math.max(0, CONCURRENCY - active)
    if (capacity <= 0) return
    const toStart = jobs.filter((j) => j.status === "queued").slice(0, capacity)
    toStart.forEach((j) => startJob(j))
  }

  function startJob(job: Job) {
    const id = job.id
    const fileName = job.file.name
    // Idempotency guard
    if (startingRef.current.has(id)) return
    // Double-check latest state says it's queued
    const current = jobs.find((j) => j.id === id)
    if (current && current.status !== "queued") return
    startingRef.current.add(id)
    // mark as running immediately
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "running" } : j)))

    const rid = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
    const controller = new AbortController()

    // initialize progress
    setJobs((prev) => prev.map((j) => {
      if (j.id !== id) return j
      const stepStatus = { ...j.stepStatus }
      if (j.stepOrder.includes("image")) stepStatus.image = "started"
      return { ...j, rid, controller, stepStatus }
    }))

    const es = new EventSource(`/api/process/stream?rid=${encodeURIComponent(rid)}`)
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.event === "step" && payload.step && payload.status) {
          setJobs((prev) => prev.map((j) => {
            if (j.id !== id) return j
            return { ...j, stepStatus: { ...j.stepStatus, [payload.step]: payload.status } }
          }))
        } else if (payload.event === "done") {
          try { es.close() } catch {}
        }
      } catch {}
    }
    es.onerror = () => {}

    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, es } : j)))

    ;(async () => {
      try {
        const { blob, filename } = await processImage({
          file: job.file,
          dpi: options.dpi,
          mockups: options.mockups,
          video: options.video,
          texts: options.texts.enabled,
          enhance: options.enhance.enabled,
          upscale: options.enhance.scale,
          rid,
          signal: controller.signal,
        })
        const parsed = await parseProcessZip(blob)
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, zip: blob, zipFilename: filename, result: parsed, status: "done" } : j)))
        toast.success(`${fileName}: traitement terminé`)
        // schedule more if capacity available
        scheduleNext()
        // auto-publish if enabled
        if (autoPublish === "draft") {
          setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, publish: { status: "pending" } } : j)))
          const p = publishDraftFromParsed(parsed, etsyPrice, etsyQuantity)
          toast.promise(p, {
            loading: `${fileName}: publication Etsy...`,
            success: ({ id: listingId }: any) => `${fileName}: draft Etsy créé${listingId ? ` (#${listingId})` : ''}`,
            error: (e: any) => `${fileName}: ${e?.message || 'Publication Etsy échouée'}`,
          })
          try {
            const { id: listingId } = await p
            setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, publish: { status: "done", listingId } } : j)))
          } catch (e: any) {
            setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, publish: { status: "error", error: e?.message || "Erreur" } } : j)))
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || err?.message === "Cancelled") {
          setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)))
        } else {
          setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "error", error: String(err?.message || 'Erreur') } : j)))
          toast.error(`${fileName}: ${String(err?.message || 'Erreur pendant le traitement')}`)
        }
        scheduleNext()
      } finally {
        try { es.close() } catch {}
        // clear idempotency guard
        startingRef.current.delete(id)
      }
    })()
  }

  function scheduleNext() {
    setJobs((prev) => {
      const running = prev.filter((j) => j.status === "running").length
      const queued = prev.filter((j) => j.status === "queued")
      const active = Math.max(running, startingRef.current.size)
      const capacity = Math.max(0, CONCURRENCY - active)
      const toStart = queued.slice(0, capacity)
      toStart.forEach((j) => startJob(j))
      return prev
    })
  }

  function cancelJob(id: string) {
    setJobs((prev) => {
      const j = prev.find((x) => x.id === id)
      if (!j || j.status !== "running" || !j.rid) return prev
      abortProcess(j.rid).catch(() => {})
      try { j.es?.close() } catch {}
      try { j.controller?.abort() } catch {}
      // clear idempotency guard when cancelling
      startingRef.current.delete(id)
      return prev.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x))
    })
  }

  function bulkDownloadZips() {
    const selectedJobs = jobs.filter((j) => selected.has(j.id))
    const withZip = selectedJobs.filter((j) => !!j.zip)
    if (withZip.length === 0) {
      toast.error("Aucun ZIP disponible parmi la sélection")
      return
    }
    toast.message(`Téléchargement de ${withZip.length} ZIP(s)`) // simple info toast
    withZip.forEach((j) => downloadBlob(j.zip!, j.zipFilename || 'package.zip'))
  }

  async function bulkPublishDrafts() {
    const selectedJobs = jobs.filter((j) => selected.has(j.id))
    const publishable = selectedJobs.filter((j) => !!j.result)
    if (publishable.length === 0) {
      toast.error("Aucun job publiable (résultat manquant)")
      return
    }
    const connected = await etsyConnected()
    if (!connected) {
      window.dispatchEvent(new Event('open-settings'))
      toast.error("Authentification Etsy requise")
      return
    }
    // set all to pending
    setJobs((prev) => prev.map((j) => selected.has(j.id) && j.result ? { ...j, publish: { status: 'pending' } } : j))
    // progress toast with remaining count
    let ok = 0, ko = 0
    const total = publishable.length
    let remaining = total
    const tid = toast.loading(`Publication Etsy • ${remaining} restant(s)`) // returns id
    await Promise.allSettled(publishable.map(async (j) => {
      try {
        const { id: listingId } = await publishDraftFromParsed(j.result!, etsyPrice, etsyQuantity, { skipAuthCheck: true })
        ok++
        setJobs((prev) => prev.map((x) => x.id === j.id ? { ...x, publish: { status: 'done', listingId } } : x))
      } catch (e: any) {
        ko++
        setJobs((prev) => prev.map((x) => x.id === j.id ? { ...x, publish: { status: 'error', error: e?.message || 'Erreur' } } : x))
      } finally {
        remaining--
        toast.loading(`Publication Etsy • ${remaining} restant(s)`, { id: tid })
      }
    }))
    toast.success(`Publication terminée • ${ok} succès, ${ko} échec(s)`, { id: tid })
  }

  function resetAll() {
    setJobs((prev) => {
      prev.forEach((j) => {
        if (j.status === "running" && j.rid) {
          abortProcess(j.rid).catch(() => {})
          try { j.es?.close() } catch {}
          try { j.controller?.abort() } catch {}
        }
        try { j.result?.release?.() } catch {}
        try { URL.revokeObjectURL(j.previewUrl) } catch {}
      })
      return []
    })
    // clear idempotency guard for all jobs
    startingRef.current.clear()
    setOptions({ dpi: 300, mockups: true, video: true, texts: { enabled: true, title: true, alt: true, description: true, tags: true }, enhance: { enabled: true, scale: 4 } })
    setAutoPublish("off")
    setSelected(new Set())
  }

  const currentDialogJob = React.useMemo(() => jobs.find((j) => j.id === dialogJobId) || null, [jobs, dialogJobId])

  return (
    <>
      <HeaderTitle title="Creator Studio" />

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Creator Studio</h2>
        <p className="text-sm text-muted-foreground">Dépose une ou plusieurs images, choisis tes options, lance jusqu'à {CONCURRENCY} traitements en parallèle.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-2xl h-full flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4" /> Images
            </CardTitle>
            <CardDescription>Dépose une ou plusieurs images (JPG, PNG, WEBP, max 15 Mo chacune). Tu peux en retirer.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <MultiImageDropzone onFiles={addFiles} jobs={jobs} onRemove={removeJob} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-4" /> Options
            </CardTitle>
            <CardDescription>Options globales appliquées à tous les jobs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <OptionsPanel
              value={options}
              onChange={setOptions}
              etsyPrice={etsyPrice}
              etsyQuantity={etsyQuantity}
              onChangeEtsy={({ price, quantity }) => { setEtsyPrice(price); setEtsyQuantity(quantity) }}
            />

            <div className="space-y-2">
              <Label>Publication Etsy</Label>
              <RadioGroup value={autoPublish} onValueChange={(v) => setAutoPublish(v as any)} className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                  <RadioGroupItem value="off" />
                  <span className="text-sm">Désactivé</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer">
                  <RadioGroupItem value="draft" />
                  <span className="text-sm">Auto-publier en Draft</span>
                </label>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">Non activé par défaut. Si activé, chaque image terminée crée un draft Etsy automatiquement.</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button type="button" onClick={startQueued} disabled={!jobs.some(j => j.status === 'queued') || runningCount >= CONCURRENCY}>
                  <Play className="size-4 mr-2" /> Lancer le traitement
                </Button>
                <div className="text-xs text-muted-foreground">Concurrence: {runningCount}/{CONCURRENCY}</div>
              </div>
              <Button type="button" variant="ghost" onClick={resetAll}>
                Réinitialiser
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Processed/Runs grid */}
      <div className="space-y-3 mt-2">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Jobs</div>
          <div className="text-xs text-muted-foreground">{jobs.length} total • {jobs.filter(j => j.status === 'done').length} terminés</div>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border rounded-md p-2 text-sm">
            <div>{selected.size} sélectionné(s)</div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>Tout sélectionner</Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>Tout désélectionner</Button>
              <Button size="sm" variant="secondary" onClick={bulkDownloadZips} disabled={!jobs.some(j => selected.has(j.id) && j.zip)}>Télécharger ZIPs</Button>
              <Button size="sm" onClick={bulkPublishDrafts} disabled={!jobs.some(j => selected.has(j.id) && j.result)}>Publier en Draft</Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              onOpen={() => j.result && setDialogJobId(j.id)}
              onCancel={() => cancelJob(j.id)}
              onRemove={() => removeJob(j.id)}
              onDownloadZip={() => j.zip && downloadBlob(j.zip, j.zipFilename || 'package.zip')}
              onPublish={async () => {
                if (!j.result) return
                setJobs((prev) => prev.map((x) => x.id === j.id ? { ...x, publish: { status: 'pending' } } : x))
                const p = publishDraftFromParsed(j.result, etsyPrice, etsyQuantity)
                toast.promise(p, {
                  loading: `${j.file.name}: publication Etsy...`,
                  success: ({ id }: any) => `${j.file.name}: draft Etsy créé${id ? ` (#${id})` : ''}`,
                  error: (e: any) => `${j.file.name}: ${e?.message || 'Publication Etsy échouée'}`,
                })
                try {
                  const { id: listingId } = await p
                  setJobs((prev) => prev.map((x) => x.id === j.id ? { ...x, publish: { status: 'done', listingId } } : x))
                } catch (e: any) {
                  setJobs((prev) => prev.map((x) => x.id === j.id ? { ...x, publish: { status: 'error', error: e?.message || 'Erreur' } } : x))
                }
              }}
              selected={selected.has(j.id)}
              onToggleSelect={(checked: boolean | "indeterminate") => toggleSelect(j.id, typeof checked === 'string' ? undefined : checked)}
            />
          ))}
        </div>
      </div>

      <Dialog open={!!currentDialogJob} onOpenChange={(o) => !o && setDialogJobId(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détails du résultat</DialogTitle>
          </DialogHeader>
          {currentDialogJob?.result && (
            <ResultsPanel
              data={currentDialogJob.result}
              filename={currentDialogJob.zipFilename}
              onDownload={currentDialogJob.zip ? () => downloadBlob(currentDialogJob.zip!, currentDialogJob.zipFilename || 'package.zip') : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function MultiImageDropzone({ onFiles, jobs, onRemove }: { onFiles: (files: FileList | null) => void; jobs: Job[]; onRemove: (id: string) => void }) {
  const [isDragging, setIsDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    onFiles(e.dataTransfer.files)
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "copy"
    setIsDragging(true)
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          "border-2 border-dashed rounded-xl p-8 text-center transition-colors flex-1 flex items-center justify-center",
          "bg-muted/10 hover:bg-muted/20",
          isDragging ? "border-primary bg-muted/20" : "border-border",
        ].join(" ")}
        role="region"
        aria-label="Zone de dépôt"
        tabIndex={0}
      >
        <div className="flex flex-col items-center gap-3">
          <ImageIcon className="size-10 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Dépose des images ici</p>
            <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP. Max 15 Mo chacune.</p>
          </div>
          <div>
            <Button type="button" onClick={() => inputRef.current?.click()} variant="secondary">
              Choisir des images
            </Button>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" multiple onChange={(e) => onFiles(e.target.files)} />
          </div>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Sélection ({jobs.length})</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {jobs.map((j) => {
              const total = j.stepOrder.length || 1
              const doneCount = j.stepOrder.filter((s) => j.stepStatus[s] === 'done').length
              const percent = Math.round((doneCount / Math.max(1, total)) * 100)
              const displayStatus =
                j.publish.status === 'pending'
                  ? 'publishing'
                  : j.publish.status === 'done'
                    ? 'published'
                    : j.publish.status === 'error'
                      ? 'publish error'
                      : j.status
              return (
                <div key={j.id} className="rounded-lg border p-3 relative">
                  {/* Overlay action top-right */}
                  {(j.status === 'running' || j.publish.status === 'pending') ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8"
                      disabled
                      aria-label={j.publish.status === 'pending' ? 'Publication en cours' : 'En cours'}
                    >
                      <Loader2 className="size-4 animate-spin" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8"
                      onClick={() => onRemove(j.id)}
                      aria-label={`Retirer ${j.file.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                  <div className="grid grid-cols-[auto,1fr] items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={j.previewUrl} alt={j.file.name} className="size-16 rounded object-cover border" />
                    <div className="min-w-0 overflow-hidden pr-10">
                      <div className="truncate text-sm font-medium" title={j.file.name}>{j.file.name}</div>
                      <div
                        className={[
                          "text-xs capitalize truncate",
                          j.publish.status === 'pending'
                            ? 'text-blue-600 dark:text-blue-400'
                            : j.publish.status === 'done'
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        {displayStatus}
                      </div>
                    </div>
                  </div>
                  {j.status === 'running' && (
                    <div className="mt-2 w-full h-2 bg-muted rounded-full overflow-hidden" aria-label="Progression du traitement">
                      <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function JobCard({ job, onOpen, onCancel, onRemove, onDownloadZip, onPublish, selected, onToggleSelect }: {
  job: Job
  onOpen: () => void
  onCancel: () => void
  onRemove: () => void
  onDownloadZip: () => void
  onPublish: () => void
  selected: boolean
  onToggleSelect: (checked: boolean | "indeterminate") => void
}) {
  return (
    <div
      className={"rounded-xl border overflow-hidden bg-card cursor-pointer " + (selected ? "ring-2 ring-primary" : "")}
      onClick={() => onToggleSelect(!selected)}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onToggleSelect(!selected)
        }
      }}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={job.result?.processedImageUrl || job.previewUrl} alt={job.file.name} className="w-full aspect-[4/3] object-cover" />
        <div className="absolute top-2 left-2 flex items-center gap-2">
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
          </span>
          <Badge variant="secondary" className="capitalize">{job.status}</Badge>
          {job.publish.status !== 'idle' && (
            <Badge
              variant="secondary"
              className={[
                'capitalize border-0',
                job.publish.status === 'pending'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : job.publish.status === 'done'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
              ].join(' ')}
            >
              {job.publish.status === 'pending' ? 'Publ.' : job.publish.status === 'done' ? `Draft${job.publish.listingId ? ` #${job.publish.listingId}` : ''}` : 'Erreur publ.'}
            </Badge>
          )}
        </div>
      </div>
      <div className="p-3 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="truncate text-sm" title={job.file.name}>{job.file.name}</div>
        <div className="flex items-center gap-2">
          {job.status === 'running' && (
            <Button size="sm" variant="outline" onClick={onCancel}>
              <X className="size-4 mr-1" /> Annuler
            </Button>
          )}
          {job.status === 'done' && (
            <>
              <Button size="sm" variant="secondary" onClick={onDownloadZip} disabled={!job.zip}>
                <Download className="size-4 mr-1" /> ZIP
              </Button>
              <Button size="sm" onClick={onPublish} disabled={!job.result || job.publish.status === 'pending'}>
                Etsy
              </Button>
              <Button size="sm" onClick={onOpen}>
                <Eye className="size-4 mr-1" /> Détails
              </Button>
            </>
          )}
          {(job.status === 'queued' || job.status === 'error' || job.status === 'cancelled') && (
            <Button size="sm" variant="destructive" onClick={onRemove}>
              <Trash2 className="size-4 mr-1" /> Retirer
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
