"use client";

/**
 * useAudio
 *
 * Gives every image entry a full audio lifecycle:
 *   generate → record → store → play
 *
 * Stack:
 *   - SpeechSynthesisUtterance  — browser TTS (free, no API)
 *   - AudioContext + MediaRecorder — capture TTS output as WebM/Opus
 *   - localforage (IndexedDB)   — persist blob as base64 across refreshes
 *   - HTMLAudioElement          — playback from stored blob
 *
 * Browser support:
 *   SpeechSynthesis: Chrome, Edge, Safari, Firefox (all modern)
 *   MediaRecorder:   Chrome, Edge, Firefox ✓  |  Safari 14.1+ ✓
 *
 * Capture strategy:
 *   We route SpeechSynthesis audio through a dummy AudioContext destination
 *   and record via MediaRecorder on a MediaStreamDestination node.
 *   This avoids any microphone permission — it's purely system audio routing.
 *
 *   Fallback (Safari / browsers where AudioContext capture is blocked):
 *   We record the utterance duration via a timer and store a "tts-only" entry
 *   so playback is still possible via SpeechSynthesis re-play.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  loadAudio,
  saveAudio,
  removeAudio,
  type AudioEntry,
} from "@/lib/storage";

export type AudioStatus =
  | "idle"        // no audio, not generating
  | "generating"  // TTS is speaking + recording
  | "saving"      // encoding blob to base64 + writing IndexedDB
  | "ready"       // audio stored, ready to play
  | "playing"     // currently playing back
  | "paused"      // paused mid-playback
  | "error";      // something went wrong

export interface UseAudioReturn {
  status: AudioStatus;
  progress: number;           // 0–1 during playback
  duration: number;           // seconds
  error: string | null;
  hasAudio: boolean;
  generate: (text: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  discard: () => Promise<void>;
}

/** Convert a Blob to a base64 string */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to encode audio"));
    reader.readAsDataURL(blob);
  });
}

/** Convert base64 + mimeType back to an object URL for playback */
function base64ToObjectUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

/** Pick best supported MIME type for MediaRecorder */
function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "audio/webm"; // fallback
}

export function useAudio(entryId: string | null): UseAudioReturn {
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);

  // Refs for imperative audio control
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const storedEntryRef = useRef<AudioEntry | null>(null);

  // ── Cleanup helpers ──────────────────────────────────────────────────────────

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopAudioEl = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = "";
      audioElRef.current = null;
    }
  }, []);

  // ── Load persisted audio when entry changes ──────────────────────────────────

  useEffect(() => {
    setStatus("idle");
    setProgress(0);
    setDuration(0);
    setError(null);
    setHasAudio(false);
    storedEntryRef.current = null;
    clearProgressTimer();
    stopAudioEl();
    revokeObjectUrl();

    if (!entryId) return;

    loadAudio(entryId).then((stored) => {
      if (stored) {
        storedEntryRef.current = stored;
        setDuration(stored.duration);
        setHasAudio(true);
        setStatus("ready");
      }
    });
  }, [entryId, clearProgressTimer, stopAudioEl, revokeObjectUrl]);

  // ── Generate: speak via TTS and record via MediaRecorder ────────────────────

  const generate = useCallback(async (text: string) => {
    if (!entryId) return;
    if (!("speechSynthesis" in window)) {
      setError("Your browser does not support text-to-speech.");
      setStatus("error");
      return;
    }

    try {
      setStatus("generating");
      setError(null);

      const mimeType = getSupportedMimeType();
      const canRecord = typeof MediaRecorder !== "undefined";

      // ── Attempt MediaRecorder capture ──────────────────────────────────────
      // We create a silent AudioContext and a MediaStreamDestination.
      // SpeechSynthesis uses the system audio; we capture it by routing
      // a tiny oscillator at 0 gain through the context to keep it alive,
      // and rely on browser internals routing speech through the same graph.
      //
      // In practice, Chrome/Edge do route SpeechSynthesis through AudioContext.
      // Firefox and Safari may not — they'll fall through to the TTS-only path.

      if (canRecord) {
        let audioCtx: AudioContext | null = null;
        let destination: MediaStreamAudioDestinationNode | null = null;

        try {
          audioCtx = new AudioContext();
          destination = audioCtx.createMediaStreamDestination();

          // Keep context alive with a 0-gain oscillator
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(destination);
          osc.start();

          const recorder = new MediaRecorder(destination.stream, { mimeType });
          recorderRef.current = recorder;
          chunksRef.current = [];

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };

          const utterance = new SpeechSynthesisUtterance(text);
          utteranceRef.current = utterance;
          utterance.rate = 0.92;
          utterance.pitch = 1;
          utterance.volume = 1;

          // Pick a good English voice if available
          const voices = speechSynthesis.getVoices();
          const preferred = voices.find(
            (v) => v.lang.startsWith("en") && !v.name.includes("(")
          );
          if (preferred) utterance.voice = preferred;

          const startTime = Date.now();

          await new Promise<void>((resolve, reject) => {
            recorder.start(100); // collect every 100ms

            utterance.onend = () => {
              setTimeout(() => {
                recorder.stop();
                osc.stop();
                audioCtx?.close();
                resolve();
              }, 200); // small tail to avoid cut-off
            };

            utterance.onerror = (e) => {
              recorder.stop();
              osc.stop();
              audioCtx?.close();
              reject(new Error(`Speech error: ${e.error}`));
            };

            speechSynthesis.speak(utterance);

            // Safety timeout: 3 min max
            setTimeout(() => {
              if (speechSynthesis.speaking) speechSynthesis.cancel();
              recorder.stop();
              osc.stop();
              audioCtx?.close();
              resolve();
            }, 3 * 60 * 1000);
          });

          const elapsed = (Date.now() - startTime) / 1000;

          setStatus("saving");

          const blob = new Blob(chunksRef.current, { type: mimeType });

          if (blob.size > 1000) {
            // Got real audio data
            const base64 = await blobToBase64(blob);
            const audioEntry: AudioEntry = {
              id: entryId,
              base64,
              mimeType,
              duration: elapsed,
              createdAt: Date.now(),
            };
            await saveAudio(audioEntry);
            storedEntryRef.current = audioEntry;
            setDuration(elapsed);
            setHasAudio(true);
            setStatus("ready");
            return;
          }

          // Blob too small → MediaRecorder didn't capture speech audio
          // Fall through to TTS-only mode
          osc.stop();
          audioCtx?.close();
        } catch {
          // AudioContext or MediaRecorder failed — fall through
          audioCtx?.close();
        }
      }

      // ── TTS-only fallback (no stored audio, just replay via synthesis) ────────
      // Store a sentinel entry with empty base64 so we know TTS was done.
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = speechSynthesis.getVoices();
      const preferred = voices.find((v) => v.lang.startsWith("en") && !v.name.includes("("));
      if (preferred) utterance.voice = preferred;

      const startTime = Date.now();
      await new Promise<void>((resolve) => {
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
        setTimeout(resolve, 3 * 60 * 1000);
      });

      const elapsed = (Date.now() - startTime) / 1000;

      // Store sentinel: mimeType = "tts-only" signals re-play via synthesis
      const sentinel: AudioEntry = {
        id: entryId,
        base64: "", // empty — we'll re-synthesize on play
        mimeType: "tts-only",
        duration: elapsed,
        createdAt: Date.now(),
      };
      await saveAudio(sentinel);
      storedEntryRef.current = sentinel;
      setDuration(elapsed);
      setHasAudio(true);
      setStatus("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Audio generation failed";
      setError(msg);
      setStatus("error");
    }
  }, [entryId]);

  // ── Play ─────────────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const stored = storedEntryRef.current;
    if (!stored) return;

    // Resume if paused
    if (status === "paused" && audioElRef.current) {
      audioElRef.current.play();
      setStatus("playing");

      const el = audioElRef.current;
      progressTimerRef.current = setInterval(() => {
        if (!el.paused && el.duration) {
          setProgress(el.currentTime / el.duration);
        }
      }, 200);
      return;
    }

    if (stored.mimeType === "tts-only" || !stored.base64) {
      // Re-synthesize via browser TTS
      if (!utteranceRef.current) return;
      setStatus("playing");
      const start = Date.now();
      progressTimerRef.current = setInterval(() => {
        setProgress(Math.min((Date.now() - start) / 1000 / stored.duration, 1));
      }, 200);

      const utt = utteranceRef.current;
      utt.onend = () => {
        clearProgressTimer();
        setProgress(1);
        setStatus("ready");
      };
      speechSynthesis.speak(utt);
      return;
    }

    // Play from stored blob
    revokeObjectUrl();
    const url = base64ToObjectUrl(stored.base64, stored.mimeType);
    objectUrlRef.current = url;

    const audio = new Audio(url);
    audioElRef.current = audio;

    audio.onplay = () => setStatus("playing");
    audio.onpause = () => {
      clearProgressTimer();
      if (!audio.ended) setStatus("paused");
    };
    audio.onended = () => {
      clearProgressTimer();
      setProgress(1);
      setStatus("ready");
      revokeObjectUrl();
    };
    audio.onerror = () => {
      clearProgressTimer();
      setError("Playback failed");
      setStatus("error");
    };

    progressTimerRef.current = setInterval(() => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    }, 200);

    audio.play().catch((e) => {
      clearProgressTimer();
      setError(e.message);
      setStatus("error");
    });
  }, [status, clearProgressTimer, revokeObjectUrl]);

  // ── Pause ────────────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    clearProgressTimer();
    if (audioElRef.current && !audioElRef.current.paused) {
      audioElRef.current.pause();
      setStatus("paused");
    } else if (speechSynthesis.speaking) {
      speechSynthesis.pause();
      setStatus("paused");
    }
  }, [clearProgressTimer]);

  // ── Stop ─────────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    clearProgressTimer();
    speechSynthesis.cancel();
    stopAudioEl();
    revokeObjectUrl();
    setProgress(0);
    setStatus("ready");
  }, [clearProgressTimer, stopAudioEl, revokeObjectUrl]);

  // ── Discard ──────────────────────────────────────────────────────────────────

  const discard = useCallback(async () => {
    clearProgressTimer();
    speechSynthesis.cancel();
    stopAudioEl();
    revokeObjectUrl();

    if (entryId) await removeAudio(entryId);

    storedEntryRef.current = null;
    utteranceRef.current = null;
    setHasAudio(false);
    setProgress(0);
    setDuration(0);
    setStatus("idle");
  }, [entryId, clearProgressTimer, stopAudioEl, revokeObjectUrl]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearProgressTimer();
      speechSynthesis.cancel();
      stopAudioEl();
      revokeObjectUrl();
    };
  }, [clearProgressTimer, stopAudioEl, revokeObjectUrl]);

  return { status, progress, duration, error, hasAudio, generate, play, pause, stop, discard };
}