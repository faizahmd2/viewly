"use client";

import { useState, useEffect } from "react";
import type { AIProvider } from "@/types";

interface ProviderStatusData {
  configured: boolean;
  available: boolean;
  requestsThisMinute: number;
  backoffUntil: number | null;
}

interface HealthData {
  status: "ok" | "degraded";
  providers: Record<AIProvider, ProviderStatusData>;
  configuredCount: number;
}

export function ProviderStatus() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => null);
  }, []);

  if (!health) return null;

  const providers: AIProvider[] = ["gemini", "claude", "openai"];
  const configured = providers.filter((p) => health.providers[p]?.configured);

  if (configured.length === 0) {
    return (
      <div className="provider-status warn">
        No AI providers configured. Add API keys to <code>.env.local</code>
      </div>
    );
  }

  return (
    <div className="provider-status">
      {providers.map((p) => {
        const s = health.providers[p];
        if (!s?.configured) return null;
        return (
          <span key={p} className={`provider-pill ${s.available ? "ok" : "limited"}`}>
            <span className="pill-dot" />
            {p}
            {s.requestsThisMinute > 0 && (
              <span className="pill-count">{s.requestsThisMinute}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}