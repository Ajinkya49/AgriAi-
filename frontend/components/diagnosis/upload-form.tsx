"use client";

import {
  AlertCircle,
  Camera,
  ImageUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, diagnoseImage } from "@/lib/api";

type Status = "idle" | "analysing" | "error";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Crop photo upload and analysis.
 *
 * Per the App Flow: the camera/gallery picker is a native mobile sheet, there is
 * a brief analysing state, and on failure the error is inline with a retry — the
 * chosen photo is never lost from the form.
 */
export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // Object URLs are held in a ref so we can revoke the previous one at the exact
  // moment it is replaced, rather than in an effect that would re-render.
  const previewUrl = useRef<string | null>(null);

  function swapPreview(next: File | null) {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    if (next) {
      previewUrl.current = URL.createObjectURL(next);
    }
    setPreview(previewUrl.current);
  }

  // Revoke whatever is still held when the screen unmounts.
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  function choose(selected: File | null | undefined) {
    if (!selected) return;

    if (!selected.type.startsWith("image/")) {
      setError("That file is not a photo. Please choose a JPG, PNG or WEBP image.");
      setStatus("error");
      return;
    }
    if (selected.size > MAX_BYTES) {
      setError("That photo is larger than 10 MB. Please choose a smaller one.");
      setStatus("error");
      return;
    }

    setFile(selected);
    swapPreview(selected);
    setError(null);
    setStatus("idle");
  }

  function clear() {
    setFile(null);
    swapPreview(null);
    setError(null);
    setStatus("idle");
    if (cameraInput.current) cameraInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
  }

  async function analyse() {
    if (!file) return;
    setStatus("analysing");
    setError(null);

    try {
      const diagnosis = await diagnoseImage(file);
      // "After successful diagnosis -> /diagnosis/[id]" (App Flow redirect table)
      router.push(`/diagnosis/${diagnosis.id}`);
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Upload failed — check your connection and try again.");
      }
    }
  }

  const busy = status === "analysing";

  return (
    <div className="flex flex-col gap-5">
      {/* Native inputs, triggered by the styled buttons below. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />

      {error && (
        <p
          role="alert"
          className="rounded-card border-danger-border bg-danger-bg text-danger flex items-start gap-2 border p-3 text-base"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {!file ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            className="rounded-card border-primary bg-primary-soft text-primary hover:bg-primary/15 flex min-h-[140px] flex-col items-center justify-center gap-2 border-2 border-dashed px-5 py-6 font-semibold transition-colors"
          >
            <Camera className="size-9" aria-hidden="true" />
            Take a photo of the leaf
            <span className="text-muted text-sm font-normal">
              Hold the phone steady, leaf filling the frame
            </span>
          </button>

          <button
            type="button"
            onClick={() => galleryInput.current?.click()}
            className="min-h-tap rounded-card glass flex items-center justify-center gap-2 px-5 font-semibold"
          >
            <ImageUp className="size-5" aria-hidden="true" />
            Choose from gallery
          </button>
        </div>
      ) : (
        <div className="rounded-card glass shadow-card flex flex-col gap-4 p-4">
          <div className="rounded-card bg-surface relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview ?? ""}
              alt="The crop photo you selected"
              className="max-h-80 w-full object-contain"
            />
            {!busy && (
              <button
                type="button"
                onClick={clear}
                aria-label="Remove this photo"
                className="text-ink shadow-card bg-surface-2/95 absolute top-2 right-2 flex size-12 items-center justify-center rounded-full"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            )}
          </div>

          <p className="text-muted truncate text-sm">{file.name}</p>

          <button
            type="button"
            onClick={analyse}
            disabled={busy}
            className="min-h-tap rounded-card bg-accent inline-flex items-center justify-center gap-2 px-6 font-semibold text-white disabled:opacity-70"
          >
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                Analysing your photo…
              </>
            ) : status === "error" ? (
              <>
                <RefreshCw className="size-5" aria-hidden="true" />
                Try again
              </>
            ) : (
              "Analyse this photo"
            )}
          </button>

          {busy && (
            <p className="text-muted text-center text-sm">
              This usually takes a few seconds. Please keep the app open.
            </p>
          )}
        </div>
      )}

      <p className="text-muted flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Your photo is stored privately and only you can see it. It is shared with the
          community only if you choose to post it.
        </span>
      </p>
    </div>
  );
}
