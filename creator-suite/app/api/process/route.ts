import { NextRequest } from "next/server"

export const runtime = "nodejs"

function getBackendBase(): string {
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL
  if (!base) throw new Error("API_URL or NEXT_PUBLIC_API_URL env var is required")
  return base.replace(/\/$/, "")
}

export async function POST(req: NextRequest) {
  const url = `${getBackendBase()}/api/process`

  // Clone the incoming request to preserve method, headers and the streaming body
  const fwdHeaders = new Headers(req.headers)
  // Remove hop-by-hop or conflicting headers for streaming uploads
  fwdHeaders.delete("content-length")
  fwdHeaders.delete("connection")
  fwdHeaders.delete("host")

  const proxyRequest = new Request(url, {
    method: "POST",
    headers: fwdHeaders,
    body: req.body as any,
    // @ts-expect-error: Node fetch requires duplex when streaming a body
    duplex: "half",
  })

  let upstream: Response
  try {
    upstream = await fetch(proxyRequest)
  } catch (e) {
    return new Response(
      JSON.stringify({ detail: "Upstream service unavailable" }),
      { status: 502, headers: { "content-type": "application/json" } }
    )
  }

  // Pass-through response body and key headers
  const headers = new Headers()
  const ct = upstream.headers.get("content-type")
  if (ct) headers.set("content-type", ct)
  const cd = upstream.headers.get("content-disposition")
  if (cd) headers.set("content-disposition", cd)

  // Avoid caching and ensure client can read headers
  headers.set("cache-control", "no-store")

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
