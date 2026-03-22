"use client";

import { useState, useEffect } from "react";
import type { ImageEntry, ImageDataEntry } from "@/types";
import { AudioPlayer } from "@/components/AudioPlayer";

interface AnalysisPanelProps {
  entry: ImageEntry | null;
  getImageData: (id: string) => Promise<ImageDataEntry | null>;
}

function fmt(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function fmtBytes(b: number) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)}KB` : `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

export function AnalysisPanel({ entry, getImageData }: AnalysisPanelProps) {
  const [imageData, setImageData] = useState<ImageDataEntry | null>(null);

  useEffect(() => {
    setImageData(null);
    if (entry) getImageData(entry.id).then(setImageData);
  }, [entry?.id, getImageData]);

  if (!entry) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-inner">
          <div className="panel-empty-mark">◎</div>
          <p className="panel-empty-text">Select an image to read its analysis</p>
          <p className="panel-empty-sub">Upload one or more images using the zone on the left</p>
        </div>
      </div>
    );
  }

  const headline =
    entry.status === "done" && entry.title ? entry.title : entry.fileName;

  // Text read aloud: title + analysis in one utterance
  const audioText =
    entry.title && entry.analysis
      ? `${entry.title}. ${entry.analysis}`
      : entry.analysis ?? "";

  return (
    <article className="analysis-panel">
      <div className="panel-image-wrap">
        {imageData ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageData.dataUrl} alt={headline} className="panel-image" />
        ) : (
          <div className="panel-image-skeleton" />
        )}
      </div>

      <header className="panel-header">
        <div className="panel-title-row">
          <h2 className="panel-filename">{headline}</h2>
          <div className="panel-stats">
            <span>{fmtBytes(entry.fileSize)}</span>
            {entry.durationMs !== undefined && <span>{fmt(entry.durationMs)}</span>}
            {entry.tokensUsed !== undefined && (
              <span title="Tokens used by AI">{entry.tokensUsed} tok</span>
            )}
          </div>
        </div>
      </header>

      <div className="panel-body">
        {entry.status === "loading" && (
          <div className="analysis-loading">
            <div className="loading-bar">
              <div className="loading-bar-fill" />
            </div>
            <p className="loading-text">Analyzing image…</p>
            <p className="loading-sub">One AI call — title and description together</p>
          </div>
        )}

        {entry.status === "error" && (
          <div className="analysis-error">
            <p className="error-label">Analysis failed</p>
            <p className="error-message">{entry.errorMessage ?? "Unknown error"}</p>
            <p className="error-hint">
              Check that at least one API key is set in .env.local
            </p>
          </div>
        )}

        {entry.status === "done" && entry.analysis && (
          <>
            <div className="analysis-text">
              {entry.analysis.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            <div className="audio-player-wrap">
              <AudioPlayer entryId={entry.id} text={audioText} />
            </div>
          </>
        )}
      </div>

      <footer className="panel-footer">
        <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
      </footer>
    </article>
  );
}