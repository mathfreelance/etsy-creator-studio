"use client"

import React from "react"
import { AppSidebar } from "@/components/dashboard/AppSidebar"
import { SiteHeader } from "@/components/dashboard/SiteHeader"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Image as ImageIcon, Settings } from "lucide-react"
import { ImageDropzone } from "@/components/dashboard/ImageDropzone"
import { OptionsPanel, type Options } from "@/components/dashboard/OptionsPanel"
import { processImage, downloadBlob } from "@/lib/api"
import { ResultsPanel } from "@/components/dashboard/ResultsPanel"
import { parseProcessZip, type ParsedPackage } from "@/lib/zip"
import { toast } from "sonner"

export default function Page() {
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null)
  const [options, setOptions] = React.useState<Options>({
    dpi: 300,
    mockups: true,
    video: false,
    texts: {
      enabled: true,
      title: true,
      alt: true,
      description: true,
      tags: true,
    },
    enhance: {
      enabled: false,
      scale: 2,
    },
  })
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [results, setResults] = React.useState<ParsedPackage | null>(null)
  const [zipBlob, setZipBlob] = React.useState<Blob | null>(null)
  const [zipFilename, setZipFilename] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    return () => {
      try { results?.release() } catch {}
    }
  }, [results])

  async function handleContinue() {
    if (!selectedImage) {
      toast.error("Aucune image sélectionnée")
      return
    }
    setIsProcessing(true)
    try {
      // Cleanup previous preview to avoid leaking object URLs
      if (results) {
        try { results.release() } catch {}
      }
      setResults(null)
      setZipBlob(null)
      setZipFilename(undefined)

      const promise = processImage({
        file: selectedImage,
        dpi: options.dpi,
        mockups: options.mockups,
        video: options.video,
        texts: options.texts.enabled,
        enhance: options.enhance.enabled,
        upscale: options.enhance.scale,
      })
      toast.promise(promise, {
        loading: "Traitement en cours…",
        success: "Traitement terminé",
        error: (err: any) => (typeof err?.message === "string" ? err.message : "Erreur pendant le traitement"),
      })
      const { blob, filename } = await promise
      const parsed = await parseProcessZip(blob)
      setResults(parsed)
      setZipBlob(blob)
      setZipFilename(filename)
    } catch (err: any) {
      // toast.promise handles error display
    } finally {
      setIsProcessing(false)
    }
  }

  function handleReset() {
    if (results) {
      try { results.release() } catch {}
    }
    setSelectedImage(null)
    setOptions({
      dpi: 300,
      mockups: true,
      video: false,
      texts: { enabled: true, title: true, alt: true, description: true, tags: true },
      enhance: { enabled: false, scale: 2 },
    })
    setResults(null)
    setZipBlob(null)
    setZipFilename(undefined)
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="container max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Creator Studio</h2>
              <p className="text-sm text-muted-foreground">Dépose une image, choisis tes options, c’est tout.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="size-4" /> Image
                  </CardTitle>
                  <CardDescription>Ajoute une seule image (JPG, PNG ou WEBP, max 15 Mo)</CardDescription>
                </CardHeader>
                <CardContent>
                  <ImageDropzone value={selectedImage} onChange={setSelectedImage} />
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="size-4" /> Options
                  </CardTitle>
                  <CardDescription>Choisis la résolution et les contenus à inclure</CardDescription>
                </CardHeader>
                <CardContent>
                  <OptionsPanel
                    hasImage={!!selectedImage}
                    value={options}
                    onChange={setOptions}
                    onContinue={handleContinue}
                    onReset={handleReset}
                    loading={isProcessing}
                  />
                </CardContent>
              </Card>
            </div>

            {results && (
              <ResultsPanel
                data={results}
                filename={zipFilename}
                onDownload={zipBlob ? () => downloadBlob(zipBlob, zipFilename || "package.zip") : undefined}
              />
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

