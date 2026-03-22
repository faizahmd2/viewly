"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ImageEntry, ImageDataEntry, AnalyzeResponse } from "@/types";
import {
  saveImageMeta,
  updateImageMeta,
  loadSessionEntries,
  saveImageData,
  loadImageData,
  removeImageWithAudio as removeImage,
  clearSessionWithAudio as clearSession,
  purgeOrphanedSessions,
} from "@/lib/storage";

export interface UseSessionReturn {
  entries: ImageEntry[];
  isInitialized: boolean;
  addImage: (file: File) => Promise<string | null>;
  getImageData: (id: string) => Promise<ImageDataEntry | null>;
  removeEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

function fileToBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({ base64: dataUrl.split(",")[1], dataUrl });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function useSession(): UseSessionReturn {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const analyzingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await purgeOrphanedSessions();
        const saved = await loadSessionEntries();
        if (cancelled) return;

        // Reset any entries that were mid-flight when the page reloaded
        const cleaned = await Promise.all(
          saved.map(async (e) => {
            if (e.status === "loading") {
              return (await updateImageMeta(e.id, {
                status: "error",
                errorMessage: "Interrupted by page reload",
              })) ?? e;
            }
            return e;
          })
        );

        if (!cancelled) {
          setEntries(cleaned);
          setIsInitialized(true);
        }
      } catch (err) {
        console.error("[useSession] init:", err);
        if (!cancelled) setIsInitialized(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const addImage = useCallback(async (file: File): Promise<string | null> => {
    const id = uuidv4();

    try {
      const { base64, dataUrl } = await fileToBase64(file);

      const entry: ImageEntry = {
        id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        createdAt: Date.now(),
        status: "loading",
      };

      await saveImageMeta(entry);
      await saveImageData({ id, dataUrl, base64, mimeType: file.type });

      // Show immediately in sidebar as loading
      setEntries((prev) => [entry, ...prev]);

      if (analyzingRef.current.has(id)) return id;
      analyzingRef.current.add(id);

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: file.type,
            fileName: file.name,
          }),
        });

        const data: AnalyzeResponse = await response.json();

        if (data.success) {
          const updated = await updateImageMeta(id, {
            status: "done",
            title: data.title,
            analysis: data.analysis,
            provider: data.provider,
            modelKey: data.modelKey,
            durationMs: data.durationMs,
            tokensUsed: data.tokensUsed,
          });
          if (updated) setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
        } else {
          const updated = await updateImageMeta(id, {
            status: "error",
            errorMessage: data.error,
          });
          if (updated) setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
        }
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        const updated = await updateImageMeta(id, { status: "error", errorMessage: msg });
        if (updated) setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      } finally {
        analyzingRef.current.delete(id);
      }

      return id;
    } catch (err) {
      console.error("[useSession] addImage:", err);
      return null;
    }
  }, []);

  const getImageData = useCallback(
    (id: string) => loadImageData(id),
    []
  );

  const removeEntry = useCallback(async (id: string) => {
    await removeImage(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(async () => {
    await clearSession();
    setEntries([]);
  }, []);

  return { entries, isInitialized, addImage, getImageData, removeEntry, clearAll };
}