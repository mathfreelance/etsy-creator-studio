import { NextRequest } from "next/server"

export const runtime = "nodejs"

function getBackendBase(): string {
  const base = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL
  if (!base) throw new Error("API_URL or NEXT_PUBLIC_API_URL env var is required")
  return base.replace(/\/$/, "")
}

function buildTargetUrl(pathParts: string[] | undefined, search: string): string {
  const path = (pathParts || []).join("/")
  const base = getBackendBase()
  const qs = search ? `?${search}` : ""
  return `${base}/api/etsy/${path}${qs}`
}

async function forward(req: NextRequest, method: string, pathParts: string[] | undefined) {
  const url = buildTargetUrl(pathParts, req.nextUrl.searchParams.toString())

  const fwdHeaders = new Headers(req.headers)
  fwdHeaders.delete("content-length")
  fwdHeaders.delete("connection")
  fwdHeaders.delete("host")

  const init: any = {
    method,
    headers: fwdHeaders,
    body: method === "GET" || method === "HEAD" ? undefined : (req.body as any),
  }
  if (init.body) {
    init.duplex = "half"
  }

  let upstream: Response
  try {
    upstream = await fetch(url, init)
  } catch (e) {
    return new Response(JSON.stringify({ detail: "Upstream service unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    })
  }

  const headers = new Headers()
  const ct = upstream.headers.get("content-type")
  if (ct) headers.set("content-type", ct)
  const cd = upstream.headers.get("content-disposition")
  if (cd) headers.set("content-disposition", cd)
  headers.set("cache-control", "no-store")

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, "GET", path)
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, "POST", path)
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, "PATCH", path)
}
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, "PUT", path)
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  return forward(req, "DELETE", path)
}

