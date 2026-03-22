"use client";

import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import { UploadZone } from "@/components/UploadZone";
import { ImageCard } from "@/components/ImageCard";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { ProviderStatus } from "@/components/ProviderStatus";

export default function Home() {
  const { entries, isInitialized, addImage, getImageData, removeEntry, clearAll } = useSession();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const activeEntry = entries.find((e) => e.id === activeId) ?? entries[0] ?? null;

  const handleFile = async (file: File) => {
    setIsUploading(true);
    const id = await addImage(file);
    if (id) setActiveId(id);
    setIsUploading(false);
  };

  const handleRemove = async (id: string) => {
    await removeEntry(id);
    if (activeId === id) {
      const remaining = entries.filter((e) => e.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="logo">
            <span className="logo-mark">V</span>
            <span className="logo-name">Viewly</span>
          </div>
          <p className="tagline">AI image analysis</p>
        </div>

        <div className="sidebar-upload">
          <UploadZone onFile={handleFile} disabled={isUploading || !isInitialized} />
        </div>

        <div className="sidebar-history">
          {!isInitialized && (
            <p className="history-loading">Loading session…</p>
          )}

          {isInitialized && entries.length === 0 && (
            <p className="history-empty">No images yet</p>
          )}

          {isInitialized && entries.length > 0 && (
            <>
              <div className="history-header">
                <span className="history-label">This session ({entries.length})</span>
                <button className="clear-btn" onClick={clearAll} title="Clear all">
                  Clear
                </button>
              </div>

              <div className="history-list">
                {entries.map((entry) => (
                  <ImageCard
                    key={entry.id}
                    entry={entry}
                    getImageData={getImageData}
                    onRemove={handleRemove}
                    isActive={entry.id === (activeEntry?.id ?? null)}
                    onClick={() => setActiveId(entry.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="sidebar-foot">
          <ProviderStatus />
          <p className="session-note">Session data is cleared when you close this tab.</p>
        </div>
      </aside>

      <main className="main">
        <AnalysisPanel entry={activeEntry} getImageData={getImageData} />
      </main>
    </div>
  );
}