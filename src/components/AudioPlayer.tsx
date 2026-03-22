"use client";

import { useCallback } from "react";
import { useAudio, type AudioStatus } from "@/hooks/useAudio";

interface AudioPlayerProps {
  entryId: string;
  text: string; // the analysis text to be read aloud
}

function fmtTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function statusLabel(status: AudioStatus, hasAudio: boolean): string {
  if (status === "generating") return "Reading aloud…";
  if (status === "saving") return "Saving audio…";
  if (status === "playing") return "Playing";
  if (status === "paused") return "Paused";
  if (status === "error") return "Error";
  if (hasAudio) return "Ready";
  return "Listen";
}

export function AudioPlayer({ entryId, text }: AudioPlayerProps) {
  const { status, progress, duration, error, hasAudio, generate, play, pause, stop, discard } =
    useAudio(entryId);

  const isGenerating = status === "generating" || status === "saving";
  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const isActive = isPlaying || isPaused;

  const handleMainAction = useCallback(() => {
    if (isGenerating) return;
    if (!hasAudio) { generate(text); return; }
    if (isPlaying) { pause(); return; }
    play();
  }, [isGenerating, hasAudio, isPlaying, generate, text, pause, play]);

  const progressPct = Math.round(progress * 100);
  const elapsed = duration > 0 ? duration * progress : 0;

  return (
    <div className={`audio-player ${status}`} aria-label="Audio player">

      {/* ── Progress bar (only visible when audio exists) ── */}
      {(hasAudio || isGenerating) && (
        <div className="audio-progress-wrap" role="progressbar" aria-valuenow={progressPct}>
          <div
            className="audio-progress-fill"
            style={{ width: isGenerating ? undefined : `${progressPct}%` }}
          />
        </div>
      )}

      {/* ── Controls row ── */}
      <div className="audio-controls">

        {/* Main action button */}
        <button
          className="audio-btn-main"
          onClick={handleMainAction}
          disabled={isGenerating}
          aria-label={isPlaying ? "Pause" : hasAudio ? "Play" : "Generate audio"}
          title={isPlaying ? "Pause" : hasAudio ? "Play" : "Read aloud (browser TTS)"}
        >
          {isGenerating ? (
            <span className="audio-spinner" />
          ) : isPlaying ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>

        {/* Status + timing */}
        <div className="audio-info">
          <span className="audio-status-label">{statusLabel(status, hasAudio)}</span>
          {duration > 0 && !isGenerating && (
            <span className="audio-time">
              {isActive ? `${fmtTime(elapsed)} / ` : ""}{fmtTime(duration)}
            </span>
          )}
        </div>

        {/* Stop — only while playing/paused */}
        {isActive && (
          <button
            className="audio-btn-secondary"
            onClick={stop}
            aria-label="Stop"
            title="Stop"
          >
            <StopIcon />
          </button>
        )}

        {/* Discard — remove stored audio */}
        {hasAudio && !isActive && !isGenerating && (
          <button
            className="audio-btn-discard"
            onClick={discard}
            aria-label="Discard audio"
            title="Delete stored audio"
          >
            ×
          </button>
        )}
      </div>

      {/* Error */}
      {error && status === "error" && (
        <p className="audio-error">{error}</p>
      )}
    </div>
  );
}

// ── SVG icons (inline, no dependencies) ──────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 2.5l9 4.5-9 4.5V2.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2.5" y="2" width="3" height="10" rx="0.5" />
      <rect x="8.5" y="2" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
    </svg>
  );
}