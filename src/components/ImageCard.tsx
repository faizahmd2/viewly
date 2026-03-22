"use client";

import { useState, useEffect } from "react";
import type { ImageEntry, ImageDataEntry } from "@/types";
import { AI_MODELS } from "@/types";

interface ImageCardProps {
  entry: ImageEntry;
  getImageData: (id: string) => Promise<ImageDataEntry | null>;
  onRemove: (id: string) => void;
  isActive: boolean;
  onClick: () => void;
}

export function ImageCard({ entry, getImageData, onRemove, isActive, onClick }: ImageCardProps) {
  const [imageData, setImageData] = useState<ImageDataEntry | null>(null);

  useEffect(() => {
    getImageData(entry.id).then(setImageData);
  }, [entry.id, getImageData]);

  const model = entry.modelKey ? AI_MODELS[entry.modelKey] : null;

  // Primary label: AI title if done, filename otherwise
  const primaryLabel = entry.status === "done" && entry.title
    ? entry.title
    : entry.fileName;

  return (
    <div
      className={`image-card ${isActive ? "active" : ""} ${entry.status}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-label={`View ${primaryLabel}`}
    >
      <div className="card-thumb">
        {imageData ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageData.dataUrl} alt={entry.fileName} className="thumb-img" />
        ) : (
          <div className="thumb-placeholder" />
        )}

        {entry.status === "loading" && (
          <div className="thumb-overlay">
            <div className="spinner" />
          </div>
        )}

        {entry.status === "error" && (
          <div className="thumb-overlay error-overlay">
            <span className="error-mark">!</span>
          </div>
        )}
      </div>

      <div className="card-meta">
        <p className="card-filename">{truncate(primaryLabel, 24)}</p>
        <p className="card-detail">
          {entry.status === "loading" && "Analyzing…"}
          {entry.status === "done" && model && (
            <span className="provider-badge" data-provider={model.provider}>
              {model.provider}
              {entry.tokensUsed ? ` · ${entry.tokensUsed}tok` : ""}
            </span>
          )}
          {entry.status === "error" && <span className="error-text">Failed</span>}
        </p>
      </div>

      <button
        className="card-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(entry.id); }}
        aria-label="Remove"
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}