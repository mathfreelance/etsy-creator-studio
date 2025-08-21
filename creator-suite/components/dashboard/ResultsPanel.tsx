"use client"

import React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Download, Image as ImageIcon, Images, Film, FileText, Copy } from "lucide-react"
import type { ParsedPackage } from "@/lib/zip"
import { toast } from "sonner"

export interface ResultsPanelProps {
  data: ParsedPackage
  onDownload?: () => void
  filename?: string
}

export function ResultsPanel({ data, onDownload, filename }: ResultsPanelProps) {
  const copy = (text: string) => {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copié dans le presse-papiers"))
      .catch(() => toast.error("Impossible de copier"))
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
            <img src={data.processedImageUrl} alt="Processed" className="w-full rounded-lg border" />
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
                  <img src={m.url} alt={m.name} className="w-full rounded-lg border" />
                  <div className="text-xs text-muted-foreground truncate">{m.name}</div>
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
            <video controls className="w-full rounded-lg border">
              <source src={data.videoUrl} type="video/mp4" />
            </video>
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
                {data.texts.tags.split(',').map((t, i) => (
                  <Badge key={i} variant="secondary">{t.trim()}</Badge>
                ))}
              </div>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
