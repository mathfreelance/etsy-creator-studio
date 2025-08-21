import { NextRequest } from "next/server"

export const runtime = "nodejs"

function getBackendBase(): string {
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL
  if (!base) throw new Error("API_URL or NEXT_PUBLIC_API_URL env var is required")
  return base.replace(/\/$/, "")
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rid = searchParams.get("rid")
  if (!rid) {
    return new Response(JSON.stringify({ detail: "rid is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }

  const url = `${getBackendBase()}/api/process/stream?rid=${encodeURIComponent(rid)}`

  let upstream: Response
  try {
    upstream = await fetch(url, { method: "GET" })
  } catch (e) {
    return new Response(
      JSON.stringify({ detail: "Upstream service unavailable" }),
      { status: 502, headers: { "content-type": "application/json" } }
    )
  }

  const headers = new Headers()
  headers.set("content-type", "text/event-stream")
  headers.set("cache-control", "no-store")
  headers.set("connection", "keep-alive")

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
