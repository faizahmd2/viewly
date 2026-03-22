"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  DragEvent,
  ChangeEvent,
} from "react";

interface UploadZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const ACCEPT_ATTR = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
const MAX_SIZE_MB = 8;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

/**
 * Detect touch/mobile at runtime so we never SSR-mismatch.
 * Returns true on phones/tablets — we show the two-button mobile layout.
 */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () =>
      setMobile(
        window.matchMedia("(pointer: coarse)").matches ||
          /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      );
    check();
    window.matchMedia("(pointer: coarse)").addEventListener("change", check);
    return () =>
      window.matchMedia("(pointer: coarse)").removeEventListener("change", check);
  }, []);
  return mobile;
}

export function UploadZone({ onFile, disabled }: UploadZoneProps) {
  // Two separate hidden inputs:
  //   galleryRef  — opens photo library / file picker (no capture attr)
  //   cameraRef   — opens camera directly (capture="environment")
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef  = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const isMobile                = useIsMobile();

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      // HEIC/HEIF come from iPhone — accept them, backend handles it
      const isHeic =
        file.type === "image/heic" ||
        file.type === "image/heif" ||
        file.name.toLowerCase().endsWith(".heic") ||
        file.name.toLowerCase().endsWith(".heif");

      if (!ACCEPTED_TYPES.includes(file.type) && !isHeic) {
        setError("Unsupported format. Use JPEG, PNG, WebP, GIF, or HEIC.");
        return;
      }

      if (file.size > MAX_SIZE_BYTES) {
        setError(`File too large. Maximum is ${MAX_SIZE_MB}MB.`);
        return;
      }

      onFile(file);
    },
    [onFile]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = ""; // reset so same file can be picked again
    },
    [processFile]
  );

  // ── Drag-and-drop (desktop only, ignored on touch) ──────────────────────────
  const onDragOver  = (e: DragEvent) => { e.preventDefault(); if (!disabled) setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop      = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // MOBILE LAYOUT — two tap targets
  // ─────────────────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="upload-zone-wrapper">
        {/* Hidden inputs */}
        <input
          ref={galleryRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleChange}
          style={{ display: "none" }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"   // rear camera by default
          onChange={handleChange}
          style={{ display: "none" }}
        />

        <div className={`upload-mobile ${disabled ? "disabled" : ""}`}>
          {/* Camera button */}
          <button
            className="upload-mobile-btn camera"
            onClick={() => !disabled && cameraRef.current?.click()}
            disabled={disabled}
            aria-label="Take a photo"
            type="button"
          >
            <CameraIcon />
            <span className="upload-mobile-label">Camera</span>
            <span className="upload-mobile-sub">Take a photo now</span>
          </button>

          <div className="upload-mobile-divider" aria-hidden>or</div>

          {/* Gallery / file picker button */}
          <button
            className="upload-mobile-btn gallery"
            onClick={() => !disabled && galleryRef.current?.click()}
            disabled={disabled}
            aria-label="Choose from gallery"
            type="button"
          >
            <GalleryIcon />
            <span className="upload-mobile-label">Gallery</span>
            <span className="upload-mobile-sub">Recent photos &amp; files</span>
          </button>
        </div>

        {error && <p className="upload-error" role="alert">{error}</p>}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DESKTOP LAYOUT — drag-and-drop zone (unchanged behaviour)
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="upload-zone-wrapper">
      <input
        ref={galleryRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleChange}
        style={{ display: "none" }}
      />

      <div
        className={`upload-zone ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !disabled && galleryRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload image"
        onKeyDown={(e) => e.key === "Enter" && !disabled && galleryRef.current?.click()}
      >
        <div className="upload-content">
          <div className="upload-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" strokeWidth="1.5" stroke="currentColor">
              <rect x="3" y="3" width="26" height="26" rx="2" strokeDasharray="4 2" />
              <path d="M16 20V12M13 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="upload-primary">
            {dragging ? "Drop to analyze" : "Drop an image here"}
          </p>
          <p className="upload-secondary">
            or <span className="upload-link">click to browse</span> — JPEG, PNG, WebP, GIF up to {MAX_SIZE_MB}MB
          </p>
        </div>
      </div>

      {error && <p className="upload-error" role="alert">{error}</p>}
    </div>
  );
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}