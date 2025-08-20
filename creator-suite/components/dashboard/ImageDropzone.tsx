"use client"

import React from "react"
import { Image as ImageIcon, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export interface ImageDropzoneProps {
  value?: File | null
  onChange: (file: File | null) => void
}

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"]

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export function ImageDropzone({ value, onChange }: ImageDropzoneProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const previewUrl = React.useMemo(() => {
    if (!value) return null
    return URL.createObjectURL(value)
  }, [value])

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function validateFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Types acceptés: JPG, PNG, WEBP."
    }
    if (file.size > MAX_BYTES) {
      return "Image trop lourde (max 15 Mo)."
    }
    return null
  }

  function handleFiles(files: FileList | null) {
    setError(null)
    if (!files || files.length === 0) return
    const file = files[0]
    const err = validateFile(file)
    if (err) {
      setError(err)
      return
    }
    onChange(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
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

  function onPick() {
    inputRef.current?.click()
  }

  return (
    <div className="flex flex-col gap-4">
      {!value ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={[
            "border-2 border-dashed rounded-xl p-8 text-center transition-colors",
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
              <p className="text-sm font-medium">Dépose une image ici</p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG ou WEBP. Max 15 Mo.
              </p>
            </div>
            <div>
              <Button type="button" onClick={onPick} variant="secondary">
                Choisir une image
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={value.name}
              className="size-20 rounded-md object-cover border"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium" title={value.name}>
              {value.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(value.size)}</p>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onChange(null)}
            className="gap-2"
          >
            <Trash2 className="size-4" /> Retirer
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
