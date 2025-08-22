"use client"

import React from "react"
import { useSelectedLayoutSegments } from "next/navigation"

function toTitleCase(segment: string) {
  return segment
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

const SPECIAL_LABELS: Record<string, string> = {
  "": "Dashboard",
  "dashboard": "Dashboard",
  "creator studio": "Creator Studio",
}

type Ctx = {
  title: string
  setTitle: (t: string | null) => void
}

const HeaderTitleContext = React.createContext<Ctx | null>(null)

export function HeaderTitleProvider({ children }: { children: React.ReactNode }) {
  const segments = useSelectedLayoutSegments()
  const auto = React.useMemo(() => {
    const last = segments[segments.length - 1]
    if (!last) return SPECIAL_LABELS[""]
    const candidate = toTitleCase(last)
    return SPECIAL_LABELS[candidate.toLowerCase()] || candidate
  }, [segments])

  const [manual, setManual] = React.useState<string | null>(null)
  const value = React.useMemo<Ctx>(() => ({
    title: manual ?? auto,
    setTitle: setManual,
  }), [manual, auto])

  return (
    <HeaderTitleContext.Provider value={value}>{children}</HeaderTitleContext.Provider>
  )
}

export function useHeaderTitle(): [string, (t: string | null) => void] {
  const ctx = React.useContext(HeaderTitleContext)
  if (!ctx) throw new Error("useHeaderTitle must be used within HeaderTitleProvider")
  return [ctx.title, ctx.setTitle]
}

export function HeaderTitle({ title }: { title: string }) {
  const [, setTitle] = useHeaderTitle()
  React.useEffect(() => {
    setTitle(title)
    return () => setTitle(null)
  }, [title, setTitle])
  return null
}
