"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Image as ImageIcon, Settings } from "lucide-react";
import { ImageDropzone } from "@/components/dashboard/ImageDropzone";
import {
  OptionsPanel,
  type Options,
} from "@/components/dashboard/OptionsPanel";
import { processImage, downloadBlob } from "@/lib/api";
import { ResultsPanel } from "@/components/dashboard/ResultsPanel";
import {
  ProgressPanel,
  type StepKey,
} from "@/components/dashboard/ProgressPanel";
import { parseProcessZip, type ParsedPackage } from "@/lib/zip";
import { toast } from "sonner";
import { HeaderTitle } from "@/components/contexts/header-title-context";

export default function Page() {
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null);
  const [options, setOptions] = React.useState<Options>({
    dpi: 300,
    mockups: true,
    video: true,
    texts: {
      enabled: true,
      title: true,
      alt: true,
      description: true,
      tags: true,
    },
    enhance: {
      enabled: true,
      scale: 2,
    },
  });
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [results, setResults] = React.useState<ParsedPackage | null>(null);
  const [zipBlob, setZipBlob] = React.useState<Blob | null>(null);
  const [zipFilename, setZipFilename] = React.useState<string | undefined>(
    undefined
  );
  React.useEffect(() => {
    return () => {
      try {
        results?.release();
      } catch {}
    };
  }, [results]);

  // Progress (SSE)
  const [rid, setRid] = React.useState<string | null>(null);
  const esRef = React.useRef<EventSource | null>(null);
  const [stepOrder, setStepOrder] = React.useState<StepKey[]>([]);
  const [stepStatus, setStepStatus] = React.useState<
    Record<string, "pending" | "started" | "done">
  >({});

  React.useEffect(() => {
    return () => {
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
    };
  }, []);

  function computeSteps(opts: Options): StepKey[] {
    const arr: StepKey[] = ["image"];
    if (opts.mockups) arr.push("mockups");
    if (opts.video) arr.push("video");
    if (opts.texts.enabled) arr.push("texts");
    arr.push("zip");
    return arr;
  }

  function startProgress(newRid: string, opts: Options) {
    // Close previous stream if any
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {}
      esRef.current = null;
    }
    const steps = computeSteps(opts);
    setStepOrder(steps);
    const init: Record<string, "pending" | "started" | "done"> = {};
    for (const s of steps) init[s] = "pending";
    setStepStatus(init);
    // Optimistically mark the first step as started to avoid race with SSE subscription
    if (steps.includes("image")) {
      setStepStatus((prev) => ({ ...prev, image: "started" }));
    }

    const es = new EventSource(
      `/api/process/stream?rid=${encodeURIComponent(newRid)}`
    );
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.event === "step" && payload.step && payload.status) {
          setStepStatus((prev) => ({
            ...prev,
            [payload.step]: payload.status,
          }));
        } else if (payload.event === "started") {
          // Fallback: ensure UI shows running if backend only sends global started
          setStepStatus((prev) =>
            prev.image === "pending" ? { ...prev, image: "started" } : prev
          );
        } else if (payload.event === "connected") {
          // Connection established: if any early events were missed, ensure initial running states
          setStepStatus((prev) => ({
            ...prev,
            ...(steps.includes("image") && prev.image === "pending"
              ? { image: "started" }
              : {}),
          }));
        } else if (payload.event === "done") {
          // Mark any remaining steps as done
          setStepStatus((prev) => {
            const next = { ...prev };
            for (const s of steps) if (next[s] !== "done") next[s] = "done";
            return next;
          });
          try {
            es.close();
          } catch {}
        } else if (payload.event === "error") {
          toast.error(`Erreur étape ${payload.step || ""}`.trim());
          try {
            es.close();
          } catch {}
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Silent; the main request still runs; avoid spamming toasts
    };
  }

  async function handleContinue() {
    if (!selectedImage) {
      toast.error("Aucune image sélectionnée");
      return;
    }
    setIsProcessing(true);
    try {
      // Cleanup previous preview to avoid leaking object URLs
      if (results) {
        try {
          results.release();
        } catch {}
      }
      setResults(null);
      setZipBlob(null);
      setZipFilename(undefined);

      // Progress: new rid and start SSE
      const newRid =
        globalThis.crypto && "randomUUID" in globalThis.crypto
          ? (globalThis.crypto as any).randomUUID()
          : Math.random().toString(36).slice(2);
      setRid(newRid);
      startProgress(newRid, options);

      const promise = processImage({
        file: selectedImage,
        dpi: options.dpi,
        mockups: options.mockups,
        video: options.video,
        texts: options.texts.enabled,
        enhance: options.enhance.enabled,
        upscale: options.enhance.scale,
        rid: newRid,
      });
      toast.promise(promise, {
        loading: "Traitement en cours…",
        success: "Traitement terminé",
        error: (err: any) =>
          typeof err?.message === "string"
            ? err.message
            : "Erreur pendant le traitement",
      });
      const { blob, filename } = await promise;
      const parsed = await parseProcessZip(blob);
      setResults(parsed);
      setZipBlob(blob);
      setZipFilename(filename);
    } catch (err: any) {
      // toast.promise handles error display
    } finally {
      setIsProcessing(false);
    }
  }

  function handleReset() {
    if (results) {
      try {
        results.release();
      } catch {}
    }
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {}
      esRef.current = null;
    }
    setSelectedImage(null);
    setOptions({
      dpi: 300,
      mockups: true,
      video: true,
      texts: {
        enabled: true,
        title: true,
        alt: true,
        description: true,
        tags: true,
      },
      enhance: { enabled: true, scale: 2 },
    });
    setResults(null);
    setZipBlob(null);
    setZipFilename(undefined);
    setRid(null);
    setStepOrder([]);
    setStepStatus({});
  }

  return (
    <>
      <HeaderTitle title="Creator Studio" />

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Creator Studio</h2>
        <p className="text-sm text-muted-foreground">
          Dépose une image, choisis tes options, c’est tout.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4" /> Image
            </CardTitle>
            <CardDescription>
              Ajoute une seule image (JPG, PNG ou WEBP, max 15 Mo)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImageDropzone value={selectedImage} onChange={setSelectedImage} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-4" /> Options
            </CardTitle>
            <CardDescription>
              Choisis la résolution et les contenus à inclure
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OptionsPanel
              hasImage={!!selectedImage}
              value={options}
              onChange={setOptions}
              onContinue={handleContinue}
              onReset={handleReset}
              loading={isProcessing}
            />
          </CardContent>
        </Card>
      </div>

      {stepOrder.length > 0 && (
        <ProgressPanel steps={stepOrder} status={stepStatus} />
      )}

      {results && (
        <ResultsPanel
          data={results}
          filename={zipFilename}
          onDownload={
            zipBlob
              ? () => downloadBlob(zipBlob, zipFilename || "package.zip")
              : undefined
          }
        />
      )}
    </>
  );
}
