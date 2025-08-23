import { NextRequest } from "next/server"

export const runtime = "nodejs"

function getBackendBase(): string {
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL
  if (!base) throw new Error("API_URL or NEXT_PUBLIC_API_URL env var is required")
  return base.replace(/\/$/, "")
}

export async function POST(req: NextRequest) {
  const search = new URL(req.url).search || ""
  const url = `${getBackendBase()}/api/process/abort${search}`

  let upstream: Response
  try {
    upstream = await fetch(url, { method: "POST" })
  } catch (e) {
    return new Response(
      JSON.stringify({ detail: "Upstream service unavailable" }),
      { status: 502, headers: { "content-type": "application/json" } }
    )
  }

  const headers = new Headers()
  const ct = upstream.headers.get("content-type")
  if (ct) headers.set("content-type", ct)
  headers.set("cache-control", "no-store")

  const body = await upstream.text()
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
