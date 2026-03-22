/**
 * RateLimiter
 *
 * Tracks per-provider request rates and error streaks.
 * In-process singleton — stateless across serverless cold starts,
 * but provides circuit-breaking within a warm instance.
 *
 * Future: replace with Redis/Upstash for distributed rate limiting.
 */

import type { AIProvider, ProviderRateLimitState } from "@/types";

const WINDOW_MS = 60_000; // 1 minute sliding window

const PROVIDER_LIMITS: Record<AIProvider, number> = {
  gemini: parseInt(process.env.GEMINI_RATE_LIMIT ?? "60"),
  claude: parseInt(process.env.CLAUDE_RATE_LIMIT ?? "50"),
  openai: parseInt(process.env.OPENAI_RATE_LIMIT ?? "60"),
};

const MAX_CONSECUTIVE_ERRORS = 3;
const BACKOFF_MS = 30_000; // 30s backoff after error streak

class RateLimiter {
  private state: Map<AIProvider, ProviderRateLimitState> = new Map();

  private getState(provider: AIProvider): ProviderRateLimitState {
    if (!this.state.has(provider)) {
      this.state.set(provider, {
        provider,
        requestsThisMinute: 0,
        windowStart: Date.now(),
        consecutiveErrors: 0,
        backoffUntil: null,
      });
    }
    return this.state.get(provider)!;
  }

  /** Returns true if provider is available to accept a request */
  canUse(provider: AIProvider): boolean {
    const s = this.getState(provider);
    const now = Date.now();

    // Check backoff
    if (s.backoffUntil !== null && now < s.backoffUntil) {
      return false;
    }
    if (s.backoffUntil !== null && now >= s.backoffUntil) {
      s.backoffUntil = null;
      s.consecutiveErrors = 0;
    }

    // Reset window if expired
    if (now - s.windowStart > WINDOW_MS) {
      s.requestsThisMinute = 0;
      s.windowStart = now;
    }

    return s.requestsThisMinute < PROVIDER_LIMITS[provider];
  }

  /** Call before making a request */
  recordRequest(provider: AIProvider): void {
    const s = this.getState(provider);
    const now = Date.now();

    if (now - s.windowStart > WINDOW_MS) {
      s.requestsThisMinute = 0;
      s.windowStart = now;
    }

    s.requestsThisMinute++;
  }

  /** Call on success to reset error streak */
  recordSuccess(provider: AIProvider): void {
    const s = this.getState(provider);
    s.consecutiveErrors = 0;
    s.backoffUntil = null;
  }

  /** Call on error — triggers backoff after threshold */
  recordError(provider: AIProvider): void {
    const s = this.getState(provider);
    s.consecutiveErrors++;

    if (s.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      s.backoffUntil = Date.now() + BACKOFF_MS;
      console.warn(
        `[RateLimiter] Provider ${provider} in backoff for ${BACKOFF_MS}ms after ${s.consecutiveErrors} consecutive errors`
      );
    }
  }

  getStatus(): Record<AIProvider, { available: boolean; requestsThisMinute: number; backoffUntil: number | null }> {
    const providers: AIProvider[] = ["gemini", "claude", "openai"];
    return Object.fromEntries(
      providers.map((p) => [
        p,
        {
          available: this.canUse(p),
          requestsThisMinute: this.getState(p).requestsThisMinute,
          backoffUntil: this.getState(p).backoffUntil,
        },
      ])
    ) as Record<AIProvider, { available: boolean; requestsThisMinute: number; backoffUntil: number | null }>;
  }
}

// Singleton — shared within a warm serverless instance
export const rateLimiter = new RateLimiter();