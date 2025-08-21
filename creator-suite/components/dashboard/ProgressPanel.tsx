"use client"

import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Loader2 } from "lucide-react"

export type StepKey = "image" | "mockups" | "video" | "texts" | "zip"

export type ProgressStatus = "pending" | "started" | "done"

export interface ProgressPanelProps {
  steps: StepKey[]
  status: Record<string, ProgressStatus>
}

const labels: Record<StepKey, string> = {
  image: "Image",
  mockups: "Mockups",
  video: "Vidéo",
  texts: "Textes",
  zip: "ZIP",
}

export function ProgressPanel({ steps, status }: ProgressPanelProps) {
  const total = steps.length
  const doneCount = steps.filter((s) => status[s] === "done").length
  const percent = Math.round((doneCount / Math.max(1, total)) * 100)

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>Progression</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {steps.map((s) => {
            const st = status[s] || "pending"
            const isDone = st === "done"
            const isStarted = st === "started"
            return (
              <li key={s} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{labels[s]}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  {isDone ? (
                    <>
                      <Check className="size-4 text-green-600" />
                      <span className="text-xs text-muted-foreground">Terminé</span>
                    </>
                  ) : isStarted ? (
                    <>
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                      <span className="text-xs text-muted-foreground">En cours…</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">En attente</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
