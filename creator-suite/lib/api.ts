export type ProcessParams = {
  file: File
  dpi: number
  mockups: boolean
  video: boolean
  texts: boolean
  enhance?: boolean
  upscale?: 2 | 4
  rid?: string
  signal?: AbortSignal
}

export type ProcessResult = {
  blob: Blob
  filename?: string
}

export async function processImage(params: ProcessParams): Promise<ProcessResult> {
  const { file, dpi, mockups, video, texts, enhance = false, upscale = 2, rid, signal } = params

  const fd = new FormData()
  fd.append('image', file)
  fd.append('dpi', String(dpi))
  fd.append('enhance', String(enhance))
  fd.append('upscale', String(upscale))
  fd.append('mockups', String(mockups))
  fd.append('video', String(video))
  fd.append('texts', String(texts))
  if (rid) fd.append('rid', rid)

  // Call Next.js proxy route to avoid CORS and hide backend URL
  const res = await fetch(`/api/process`, {
    method: 'POST',
    body: fd,
    signal,
  })

  if (!res.ok) {
    if (res.status === 499) {
      throw new Error('Cancelled')
    }
    try {
      const data = await res.json()
      const detail = data?.detail || res.statusText
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    } catch {
      throw new Error(`Request failed (${res.status})`)
    }
  }

  const cd = res.headers.get('Content-Disposition') || undefined
  const filename = cd ? parseContentDisposition(cd) : undefined
  const blob = await res.blob()
  return { blob, filename }
}

export function downloadBlob(blob: Blob, filename = 'package.zip') {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function parseContentDisposition(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  // content-disposition: attachment; filename=package.zip; filename*=UTF-8''package.zip
  const match = /filename\*=UTF-8''([^;\n]+)/i.exec(value) || /filename="?([^";\n]+)"?/i.exec(value)
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return undefined
}

export async function abortProcess(rid: string): Promise<void> {
  if (!rid) return
  try {
    await fetch(`/api/process/abort?rid=${encodeURIComponent(rid)}`, { method: 'POST' })
  } catch {
    // ignore network errors; best-effort
  }
}
