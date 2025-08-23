import JSZip from "jszip"

export type ParsedTexts = {
  title: string
  alt_seo?: string
  description: string
  tags: string
}

export type ParsedPackage = {
  processedImageUrl?: string
  processedImageSize?: number
  mockups: Array<{ name: string; url: string; size?: number }>
  videoUrl?: string
  videoSize?: number
  texts?: ParsedTexts
  manifest?: any
  release: () => void
}

export async function parseProcessZip(zipBlob: Blob): Promise<ParsedPackage> {
  const zip = await JSZip.loadAsync(zipBlob)

  const urlsToRevoke: string[] = []
  const out: ParsedPackage = {
    mockups: [],
    release: () => {
      for (const u of urlsToRevoke) URL.revokeObjectURL(u)
    },
  }

  // Processed image (expected: image/processed.png)
  const processed = zip.file("image/processed.png")
  if (processed) {
    const b = await processed.async("blob")
    const url = URL.createObjectURL(b)
    urlsToRevoke.push(url)
    out.processedImageUrl = url
    out.processedImageSize = b.size
  }

  // Mockups folder
  for (const path of Object.keys(zip.files)) {
    const f = zip.files[path]
    if (!f.dir && path.startsWith("mockups/")) {
      const b = await f.async("blob")
      const url = URL.createObjectURL(b)
      urlsToRevoke.push(url)
      const name = path.substring("mockups/".length)
      out.mockups.push({ name, url, size: b.size })
    }
  }

  // Video
  const video = zip.file("video/preview.mp4")
  if (video) {
    const b = await video.async("blob")
    const url = URL.createObjectURL(b)
    urlsToRevoke.push(url)
    out.videoUrl = url
    out.videoSize = b.size
  }

  // Texts JSON
  const texts = zip.file("texts/etsy_metadata.json")
  if (texts) {
    try {
      const s = await texts.async("string")
      out.texts = JSON.parse(s)
    } catch {}
  }

  // Manifest (optional)
  const manifest = zip.file("manifest.json")
  if (manifest) {
    try {
      const s = await manifest.async("string")
      out.manifest = JSON.parse(s)
    } catch {}
  }

  return out
}
