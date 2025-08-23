"use client"

import React from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"

export type DPI = 72 | 150 | 300 | 600

export interface Options {
  dpi: DPI
  mockups: boolean
  video: boolean
  texts: {
    enabled: boolean
    title: boolean
    alt: boolean
    description: boolean
    tags: boolean
  }
  enhance: {
    enabled: boolean
    scale: 2 | 4
  }
}

export interface OptionsPanelProps {
  value: Options
  onChange: (next: Options) => void
}

export function OptionsPanel({ value, onChange }: OptionsPanelProps) {
  function setDpi(next: DPI) {
    onChange({ ...value, dpi: next })
  }
  function setToggle<K extends keyof Options>(key: K, v: Options[K]) {
    onChange({ ...value, [key]: v })
  }
  function setTexts<K extends keyof Options["texts"]>(key: K, v: Options["texts"][K]) {
    onChange({ ...value, texts: { ...value.texts, [key]: v } })
  }
  function setEnhance<K extends keyof Options["enhance"]>(key: K, v: Options["enhance"][K]) {
    onChange({ ...value, enhance: { ...value.enhance, [key]: v } })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="dpi">DPI</Label>
          <Select value={String(value.dpi)} onValueChange={(v) => setDpi(Number(v) as DPI)}>
            <SelectTrigger id="dpi" className="w-[180px]">
              <SelectValue placeholder="Choisir DPI" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="72">72</SelectItem>
              <SelectItem value="150">150</SelectItem>
              <SelectItem value="300">300</SelectItem>
              <SelectItem value="600">600</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="mockups">Mockups</Label>
            <p className="text-xs text-muted-foreground">Inclure des rendus mockups</p>
          </div>
          <Switch id="mockups" checked={value.mockups} onCheckedChange={(v) => setToggle("mockups", v)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="video">Vidéo</Label>
            <p className="text-xs text-muted-foreground">Générer une vidéo courte <br /> (slide des mockups)</p>
          </div>
          <Switch id="video" checked={value.video} onCheckedChange={(v) => setToggle("video", v)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="texts">Textes</Label>
            <p className="text-xs text-muted-foreground">Activer les métadonnées texte</p>
          </div>
          <Switch id="texts" checked={value.texts.enabled} onCheckedChange={(v) => setTexts("enabled", v)} />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="enhance">Amélioration (Upscale)</Label>
            <p className="text-xs text-muted-foreground">Améliorer la qualité avec un upscaler</p>
          </div>
          <Switch id="enhance" checked={value.enhance.enabled} onCheckedChange={(v) => setEnhance("enabled", v)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="upscale">Facteur</Label>
          <Select value={String(value.enhance.scale)} onValueChange={(v) => setEnhance("scale", Number(v) as 2 | 4)}>
            <SelectTrigger id="upscale" className="w-[180px]" disabled={!value.enhance.enabled}>
              <SelectValue placeholder="Choisir" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">x2</SelectItem>
              <SelectItem value="4">x4</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/*{value.texts.enabled && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.texts.title}
              onCheckedChange={(v) => setTexts("title", Boolean(v))}
              aria-label="Titre"
            />
            Titre
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.texts.alt}
              onCheckedChange={(v) => setTexts("alt", Boolean(v))}
              aria-label="Alt SEO"
            />
            Alt SEO
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.texts.description}
              onCheckedChange={(v) => setTexts("description", Boolean(v))}
              aria-label="Description"
            />
            Description
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.texts.tags}
              onCheckedChange={(v) => setTexts("tags", Boolean(v))}
              aria-label="Tags"
            />
            Tags
          </label>
        </div>
      )}*/}

      {/** Controls moved to parent card. This panel now only exposes options. **/}
    </div>
  )
}

