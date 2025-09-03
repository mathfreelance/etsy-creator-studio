"use client"

import * as React from "react"
import { HeaderTitle } from "@/components/contexts/header-title-context"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import type { EtsyReceiptsResponse, EtsyReceipt, EtsyReceiptTransaction, EtsyPrefs } from "@/lib/etsy"
import { etsyGetShopReceipts, etsyGetPrefs } from "@/lib/etsy"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import JSZip from "jszip"

export default function InvoiceGeneratorPage() {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [resp, setResp] = React.useState<EtsyReceiptsResponse | null>(null)
  const [openReceiptId, setOpenReceiptId] = React.useState<number | string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = await etsyGetShopReceipts({ limit: 100, max_pages: 10 })
        if (!cancelled) setResp(r)
        if (r && r.ok === false && r.detail) {
          toast.error(r.detail)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load receipts")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const currency = resp?.currency_code || "EUR"

  // Selection state (by receipt)
  const [selectedReceipts, setSelectedReceipts] = React.useState<Set<string>>(new Set())
  const receiptIdList = React.useMemo(() => {
    const ids = new Set<string>()
    for (const r of (resp?.receipts || [])) ids.add(String(r.receipt_id))
    return Array.from(ids)
  }, [resp])
  const allCount = receiptIdList.length
  const selectedCount = selectedReceipts.size
  const allChecked = allCount > 0 && selectedCount === allCount
  const someChecked = selectedCount > 0 && selectedCount < allCount
  const toggleAll = (checked: boolean) => {
    setSelectedReceipts(checked ? new Set(receiptIdList) : new Set())
  }
  const toggleOne = (receiptId: string, checked: boolean) => {
    setSelectedReceipts((prev) => {
      const next = new Set(prev)
      if (checked) next.add(receiptId)
      else next.delete(receiptId)
      return next
    })
  }

  const selectedReceiptIds = React.useMemo(() => Array.from(selectedReceipts), [selectedReceipts])
  async function handleCreateInvoices(ids: string[]) {
    if (!ids.length) {
      toast.info("Sélectionne au moins une commande")
      return
    }
    try {
      const prefs = await etsyGetPrefs().catch(() => ({} as EtsyPrefs))
      // Helper: build one PDF
      const buildPdf = (receipt: EtsyReceipt) => {
        const doc = new jsPDF({ unit: "pt", format: "a4" })
        const marginX = 40
        const pageWidth = doc.internal.pageSize.getWidth()
        const pageHeight = doc.internal.pageSize.getHeight()
        const rightX = pageWidth - marginX

        // Header
        doc.setFontSize(20)
        doc.setFont("helvetica", "bold")
        doc.text("FACTURE", marginX, 50)
        doc.setFontSize(11)
        doc.setFont("helvetica", "normal")
        doc.text(`N° ${String(receipt.receipt_id)}`, marginX, 70)
        const orderDateStr = fmtDate(receipt.order_date_ts)
        doc.text(`Date: ${orderDateStr}`, marginX, 86)

        // Seller block (billing prefs)
        const sellerLines = [
          prefs?.billing_name,
          prefs?.billing_address1,
          prefs?.billing_address2,
          [prefs?.billing_zip, prefs?.billing_city].filter(Boolean).join(" "),
          [prefs?.billing_state, prefs?.billing_country].filter(Boolean).join(", "),
          prefs?.billing_email ? `Email: ${prefs.billing_email}` : undefined,
          prefs?.billing_tax_id ? `SIREN: ${prefs.billing_tax_id}` : undefined,
        ].filter((s) => !!s && String(s).trim().length > 0) as string[]

        doc.setFont("helvetica", "bold")
        doc.text("Émetteur", marginX, 120)
        doc.setFont("helvetica", "normal")
        let y = 138
        sellerLines.forEach((l) => {
          doc.text(String(l), marginX, y)
          y += 16
        })

        // Buyer block
        const buyer = receipt.buyer || ({} as any)
        const buyerLines = [
          buyer?.name,
          buyer?.first_line,
          buyer?.second_line,
          [buyer?.zip, buyer?.city].filter(Boolean).join(" "),
          [buyer?.state, buyer?.country].filter(Boolean).join(", "),
        ].filter((s) => !!s && String(s).trim().length > 0) as string[]

        doc.setFont("helvetica", "bold")
        doc.text("Client", rightX - 200, 120, { align: "right" })
        doc.setFont("helvetica", "normal")
        let yb = 138
        buyerLines.forEach((l) => {
          doc.text(String(l), rightX, yb, { align: "right" })
          yb += 16
        })

        // Compute line allocations (discount/shipping proportionnel)
        const txs: EtsyReceiptTransaction[] = Array.isArray(receipt.transactions) ? receipt.transactions : []
        const lineSubtotals = txs.map((t) => Number((t.price || 0) * (t.quantity || 1)))
        const totalLineSubtotal = lineSubtotals.reduce((a, b) => a + b, 0)
        const discount = Number(receipt.discount || 0)
        const shipping = Number(receipt.shipping || 0)

        const body = txs.map((t, idx) => {
          const lineSubtotal = lineSubtotals[idx] || 0
          const weight = totalLineSubtotal > 0 ? lineSubtotal / totalLineSubtotal : 0
          const lineDiscount = Number(discount * weight)
          const lineShipping = Number(shipping * weight)
          const variation = extractVariation((t as any)?.variation)
          const desc = [t.title, variation ? `(${variation})` : undefined, t.sku ? `SKU: ${t.sku}` : undefined]
            .filter(Boolean)
            .join(" ")
          const qty = Number(t.quantity || 1)
          const unit = Number(t.price || 0)
          const lineTotal = Math.max(0, lineSubtotal - lineDiscount + lineShipping)
          return [
            desc,
            String(qty),
            `${unit.toFixed(2)} ${currency}`,
            `${lineDiscount.toFixed(2)} ${currency}`,
            `${lineShipping.toFixed(2)} ${currency}`,
            `${lineTotal.toFixed(2)} ${currency}`,
          ]
        })

        autoTable(doc, {
          startY: Math.max(y, yb) + 20,
          head: [["Description", "Qté", "PU", "Remise", "Port", "Total"]],
          body,
          styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
          headStyles: { fillColor: [15, 76, 129], textColor: 255 },
          columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
        })

        // Totals block
        const afterTableY = (doc as any).lastAutoTable?.finalY || 200
        const totalsX = pageWidth - marginX - 220
        const lineH = 16
        let ty = afterTableY + 20
        const addTotal = (label: string, value: number, bold?: boolean) => {
          doc.setFont("helvetica", bold ? "bold" : "normal")
          doc.text(label, totalsX, ty)
          doc.text(`${value.toFixed(2)} ${currency}`, totalsX + 200, ty, { align: "right" })
          ty += lineH
        }
        const subtotal = Number(receipt.subtotal || 0)
        addTotal("Sous-total", subtotal)
        addTotal("Remise", discount)
        addTotal("Port", shipping)
        doc.setDrawColor(200)
        doc.line(totalsX, ty + 2, totalsX + 220, ty + 2)
        addTotal("Total", Number(receipt.total || Math.max(0, subtotal - discount + shipping))),

        // Legal mention footer
        doc.setFontSize(9)
        doc.setFont("helvetica", "italic")
        const footer = "TVA non applicable, article 293B du CGI"
        doc.text(footer, marginX, pageHeight - 30)

        return doc
      }

      if (ids.length === 1) {
        const id = ids[0]
        const receipt = resp?.receipts?.find((r) => String(r.receipt_id) === String(id))
        if (!receipt) throw new Error(`Commande ${id} introuvable`)
        const doc = buildPdf(receipt)
        doc.save(`facture-${String(id)}.pdf`)
      } else {
        const zip = new JSZip()
        for (const id of ids) {
          const receipt = resp?.receipts?.find((r) => String(r.receipt_id) === String(id))
          if (!receipt) continue
          const doc = buildPdf(receipt)
          const blob = doc.output("blob") as Blob
          zip.file(`facture-${String(id)}.pdf`, blob)
        }
        const zipBlob = await zip.generateAsync({ type: "blob" })
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement("a")
        a.href = url
        a.download = `factures-${ids.length}.zip`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (e: any) {
      toast.error(e?.message || "Erreur lors de la génération des factures")
    }
  }

  type Row = {
    receipt_id: string | number
    order_date: string
    transaction_id?: string | number
    listing_id?: string | number
    title?: string
    sku?: string
    variation?: string
    qty: number
    unit_price: number
    line_subtotal: number
    discount: number
    shipping: number
    line_total: number
    buyer_name?: string
    address?: string
    order_url?: string
    listing_url?: string
    raw_receipt?: EtsyReceipt
    raw_tx?: EtsyReceiptTransaction
  }

  function fmtMoney(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return "—"
    return `${n.toFixed(2)} ${currency}`
  }

  function fmtDate(ts?: number | null): string {
    if (!ts) return "—"
    // Etsy timestamps are seconds; convert to ms
    const d = new Date(ts * 1000)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleDateString()
  }

  function extractVariation(v: any): string | undefined {
    try {
      if (!v) return undefined
      if (Array.isArray(v)) {
        return v
          .map((it) => {
            const name = String((it && (it.property_name || it.name)) || "").trim()
            const val = String((it && (it.value || it.value_name)) || "").trim()
            return name && val ? `${name}: ${val}` : val || name
          })
          .filter(Boolean)
          .join(", ")
      }
      if (typeof v === "object") {
        const parts: string[] = []
        for (const [k, val] of Object.entries(v)) {
          const name = String(k || "").trim()
          const value = String((val as any) ?? "").trim()
          if (name || value) parts.push(name && value ? `${name}: ${value}` : value || name)
        }
        return parts.filter(Boolean).join(", ")
      }
      return String(v)
    } catch {
      return undefined
    }
  }

  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = []
    const receipts: EtsyReceipt[] = (resp?.receipts || []) as EtsyReceipt[]
    for (const r of receipts) {
      const orderDate = fmtDate(r.order_date_ts)
      const subtotal = Number(r.subtotal || 0)
      const discount = Number(r.discount || 0)
      const shipping = Number(r.shipping || 0)
      const buyerName = (r.buyer?.name || "").toString()
      const addrParts = [
        r.buyer?.first_line,
        r.buyer?.second_line,
        [r.buyer?.zip, r.buyer?.city].filter(Boolean).join(" "),
        [r.buyer?.state, r.buyer?.country].filter(Boolean).join(", "),
      ].filter((s) => !!s && String(s).trim().length > 0)
      const address = addrParts.join(" · ")

      // Allocate discount/shipping proportionally by line subtotal
      const txs: EtsyReceiptTransaction[] = Array.isArray(r.transactions) ? r.transactions : []
      const lineSubtotals = txs.map((t) => Number((t.price || 0) * (t.quantity || 1)))
      const totalLineSubtotal = lineSubtotals.reduce((a, b) => a + b, 0)

      txs.forEach((t, idx) => {
        const lineSubtotal = lineSubtotals[idx] || 0
        const weight = totalLineSubtotal > 0 ? lineSubtotal / totalLineSubtotal : 0
        const lineDiscount = Number(discount * weight)
        const lineShipping = Number(shipping * weight)
        const variation = extractVariation((t as any)?.variation)
        const orderUrl = r.receipt_id ? `https://www.etsy.com/your/orders/sold?order_id=${r.receipt_id}` : undefined
        const listingUrl = t.listing_id ? `https://www.etsy.com/listing/${t.listing_id}` : undefined
        out.push({
          receipt_id: r.receipt_id,
          order_date: orderDate,
          transaction_id: t.transaction_id,
          listing_id: t.listing_id,
          title: t.title,
          sku: t.sku,
          variation,
          qty: Number(t.quantity || 1),
          unit_price: Number(t.price || 0),
          line_subtotal: lineSubtotal,
          discount: lineDiscount,
          shipping: lineShipping,
          line_total: Math.max(0, lineSubtotal - lineDiscount + lineShipping),
          buyer_name: buyerName,
          address,
          order_url: orderUrl,
          listing_url: listingUrl,
          raw_receipt: r,
          raw_tx: t,
        })
      })
    }
    return out
  }, [resp])

  // Map of first row index per receipt for rendering a single checkbox per receipt
  const firstIndexByReceipt = React.useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((row, idx) => {
      const id = String(row.receipt_id)
      if (!m.has(id)) m.set(id, idx)
    })
    return m
  }, [rows])

  return (
    <>
      <HeaderTitle title="Invoice Generator" />
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Invoice Generator</h2>
        <p className="text-sm text-muted-foreground">Reçus Etsy détaillés avec promotions, expédition et lignes de transaction.</p>
      </div>

      <Card className="rounded-2xl mt-4">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Ventes détaillées</CardTitle>
            <CardDescription>
              {loading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <span>{rows.length.toLocaleString()} lignes • Devise: <Badge variant="secondary">{currency}</Badge></span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!loading ? (
              <Button size="sm" onClick={() => handleCreateInvoices(selectedReceiptIds)} disabled={selectedReceiptIds.length === 0}>
                Créer facture(s)
              </Button>
            ) : null}
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Aucun reçu trouvé.</div>
          ) : (
            <div className="overflow-auto">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[3rem]">
                      <Checkbox
                        checked={allChecked ? true : someChecked ? "indeterminate" : false}
                        onCheckedChange={(v) => toggleAll(!!v)}
                        aria-label="Tout sélectionner"
                      />
                    </TableHead>
                    <TableHead className="w-[7.5rem]">Date</TableHead>
                    <TableHead className="w-[8rem]">Commande</TableHead>
                    <TableHead className="w-[8rem]">Txn</TableHead>
                    <TableHead className="w-[26rem]">Produit</TableHead>
                    <TableHead className="w-[8rem]">SKU</TableHead>
                    <TableHead className="w-[16rem]">Variation</TableHead>
                    <TableHead className="w-[4rem] text-right">Qté</TableHead>
                    <TableHead className="w-[8rem] text-right">Prix</TableHead>
                    <TableHead className="w-[8rem] text-right">Remise</TableHead>
                    <TableHead className="w-[8rem] text-right">Port</TableHead>
                    <TableHead className="w-[10rem] text-right">Total ligne</TableHead>
                    <TableHead className="w-[12rem]">Acheteur</TableHead>
                    <TableHead className="w-[18rem] hidden lg:table-cell">Adresse</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow
                      key={`${row.receipt_id}-${row.transaction_id}-${idx}`}
                      className="cursor-pointer"
                      onClick={() => setOpenReceiptId(row.receipt_id)}
                      onKeyDown={(e) => { if (e.key === "Enter") setOpenReceiptId(row.receipt_id) }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Voir détails commande #${row.receipt_id}`}
                    >
                      <TableCell className="w-[3rem]" onClick={(e) => e.stopPropagation()}>
                        {firstIndexByReceipt.get(String(row.receipt_id)) === idx ? (
                          <Checkbox
                            checked={selectedReceipts.has(String(row.receipt_id))}
                            onCheckedChange={(v) => toggleOne(String(row.receipt_id), !!v)}
                            aria-label={`Sélectionner la commande #${row.receipt_id}`}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="w-[7.5rem]">{row.order_date}</TableCell>
                      <TableCell className="w-[8rem]">
                        {row.order_url ? (
                          <a className="underline underline-offset-2" href={row.order_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            #{row.receipt_id}
                          </a>
                        ) : (
                          <>#{row.receipt_id}</>
                        )}
                      </TableCell>
                      <TableCell className="w-[8rem] text-xs text-muted-foreground">{row.transaction_id ?? "—"}</TableCell>
                      <TableCell className="w-[26rem]">
                        {row.listing_url ? (
                          <a className="hover:underline block truncate" href={row.listing_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            {row.title || `Listing #${row.listing_id}`}
                          </a>
                        ) : (
                          <div className="truncate">{row.title || `Listing #${row.listing_id}`}</div>
                        )}
                      </TableCell>
                      <TableCell className="w-[8rem] text-xs font-mono truncate">{row.sku || "—"}</TableCell>
                      <TableCell className="w-[16rem] text-xs truncate">{row.variation || "—"}</TableCell>
                      <TableCell className="w-[4rem] text-right">{row.qty}</TableCell>
                      <TableCell className="w-[8rem] text-right">{fmtMoney(row.unit_price)}</TableCell>
                      <TableCell className="w-[8rem] text-right">{fmtMoney(row.discount)}</TableCell>
                      <TableCell className="w-[8rem] text-right">{fmtMoney(row.shipping)}</TableCell>
                      <TableCell className="w-[10rem] text-right">{fmtMoney(row.line_total)}</TableCell>
                      <TableCell className="w-[12rem] truncate">{row.buyer_name || "—"}</TableCell>
                      <TableCell className="w-[18rem] hidden lg:table-cell text-xs text-muted-foreground truncate">{row.address || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog: détails de la commande */}
      <Dialog open={openReceiptId != null} onOpenChange={(o) => { if (!o) setOpenReceiptId(null) }}>
        <DialogContent className="sm:max-w-3xl md:max-w-5xl max-h-[85vh] overflow-hidden">
          {(() => {
            const receipt = resp?.receipts?.find((r) => String(r.receipt_id) === String(openReceiptId))
            if (!receipt) return (
              <div className="text-sm text-muted-foreground">Aucune donnée de commande.</div>
            )
            const orderDate = fmtDate(receipt.order_date_ts)
            const txs: EtsyReceiptTransaction[] = Array.isArray(receipt.transactions) ? receipt.transactions : []
            const lineSubtotals = txs.map((t) => Number((t.price || 0) * (t.quantity || 1)))
            const totalLineSubtotal = lineSubtotals.reduce((a, b) => a + b, 0)
            const lines = txs.map((t, idx) => {
              const lineSubtotal = lineSubtotals[idx] || 0
              const weight = totalLineSubtotal > 0 ? lineSubtotal / totalLineSubtotal : 0
              const lineDiscount = Number(Number(receipt.discount || 0) * weight)
              const lineShipping = Number(Number(receipt.shipping || 0) * weight)
              return {
                t,
                variation: extractVariation((t as any)?.variation),
                qty: Number(t.quantity || 1),
                unit: Number(t.price || 0),
                lineSubtotal,
                lineDiscount,
                lineShipping,
                lineTotal: Math.max(0, lineSubtotal - lineDiscount + lineShipping),
              }
            })
            const addrLines = [
              receipt.buyer?.first_line,
              receipt.buyer?.second_line,
              [receipt.buyer?.zip, receipt.buyer?.city].filter(Boolean).join(" "),
              [receipt.buyer?.state, receipt.buyer?.country].filter(Boolean).join(", "),
            ].filter((s) => !!s && String(s).trim().length > 0)
            return (
              <div className="max-h-[80vh] overflow-y-auto pr-1 space-y-5">
                <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <DialogHeader className="p-0">
                      <DialogTitle>Détails de la commande #{String(receipt.receipt_id)}</DialogTitle>
                      <DialogDescription>Passée le {orderDate} • Devise: {currency}</DialogDescription>
                    </DialogHeader>
                    <Button size="sm" onClick={() => handleCreateInvoices([String(receipt.receipt_id)])}>Créer la facture</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4">
                    <div className="text-sm font-medium mb-2">Acheteur</div>
                    <div className="text-sm font-semibold">{receipt.buyer?.name || "—"}</div>
                    <div className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs">
                      {addrLines.length ? addrLines.join("\n") : "Adresse indisponible"}
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm font-medium mb-2">Montants</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between"><span>Sous-total</span><span className="font-mono">{fmtMoney(Number(receipt.subtotal || 0))}</span></div>
                      <div className="flex items-center justify-between"><span>Remise</span><span className="font-mono">{fmtMoney(Number(receipt.discount || 0))}</span></div>
                      <div className="flex items-center justify-between"><span>Port</span><span className="font-mono">{fmtMoney(Number(receipt.shipping || 0))}</span></div>
                      <div className="flex items-center justify-between border-t mt-2 pt-2"><span className="font-semibold">Total</span><span className="font-mono font-semibold">{fmtMoney(Number(receipt.total || 0))}</span></div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {lines.map((ln, i) => (
                    <div key={(ln.t.transaction_id as any) ?? i} className="rounded-lg border p-3 sm:p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium break-words">
                          {ln.t.listing_id ? (
                            <a
                              href={`https://www.etsy.com/listing/${ln.t.listing_id}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline"
                            >
                              {ln.t.title || `Listing #${ln.t.listing_id}`}
                            </a>
                          ) : (
                            <>{ln.t.title || `Listing #${ln.t.listing_id}`}</>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                          <span>SKU: <span className="font-mono">{ln.t.sku || "—"}</span></span>
                          <span>Variation: {ln.variation || "—"}</span>
                          {ln.t.transaction_id ? (<span>Txn: {String(ln.t.transaction_id)}</span>) : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="whitespace-nowrap">{ln.qty} × {fmtMoney(ln.unit)}</div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">Remise {fmtMoney(ln.lineDiscount)} • Port {fmtMoney(ln.lineShipping)}</div>
                        <div className="font-semibold whitespace-nowrap">{fmtMoney(ln.lineTotal)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </>
  )
}
