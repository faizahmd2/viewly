// ─── AI Provider Types ────────────────────────────────────────────────────────

export type AIProvider = "gemini" | "claude" | "openai";

export type AIModel = {
  id: string;
  name: string;
  provider: AIProvider;
  supportsVision: boolean;
  contextWindow: number;
  tier: "free" | "paid";
};

export const AI_MODELS: Record<string, AIModel> = {
  // Gemini models (Generous Free Tier available via Google AI Studio)
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    supportsVision: true,
    contextWindow: 1_000_000,
    tier: "free",
  },
  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "gemini",
    supportsVision: true,
    contextWindow: 1_000_000,
    tier: "free",
  },
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    supportsVision: true,
    contextWindow: 1_000_000,
    tier: "free",
  },
  
  // Claude models (Paid, but Haiku is extremely cheap / "almost free")
  "claude-3-5-haiku": {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    provider: "claude",
    supportsVision: true,
    contextWindow: 200_000,
    tier: "paid", 
  },
  "claude-3-5-sonnet": {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "claude",
    supportsVision: true,
    contextWindow: 200_000,
    tier: "paid", // Left this in as your high-tier fallback, but it is standard pricing
  },

  // OpenAI models (Paid, but mini is extremely cheap / "almost free")
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    supportsVision: true,
    contextWindow: 128_000,
    tier: "paid",
  },
  "gpt-4o": {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    supportsVision: true,
    contextWindow: 128_000,
    tier: "paid", // Standard pricing
  },
};

// Default fallback chain: try free/cheapest models first, then paid/premium
export const DEFAULT_FALLBACK_CHAIN: string[] = [
  "gemini-2.5-flash-lite", // Cheapest & fastest
  "gemini-2.5-flash",      // Best free-tier balance of speed/intelligence
  "gemini-2.0-flash",      // Solid free fallback
  "gpt-4o-mini",           // "Almost free" tier
  "claude-3-5-haiku",      // "Almost free" tier
  "claude-3-5-sonnet",     // Premium paid fallback
  "gpt-4o",                // Premium paid fallback
];

// ─── AI Request / Response Types ─────────────────────────────────────────────

export type AIRequestPurpose = "image_analysis" | "text_summary" | "custom";

export interface AIRequestPayload {
  purpose: AIRequestPurpose;
  prompt: string;
  systemPrompt?: string;
  imageBase64?: string;
  imageMimeType?: string;
  maxTokens?: number;
  temperature?: number;
  // Future: webhookUrl?: string;
  // Future: callbackId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Structured result from one AI call.
 * `text` is the raw model output — callers parse it as needed.
 */
export interface AIResponseResult {
  text: string;
  provider: AIProvider;
  modelKey: string;
  modelId: string;
  tokensUsed?: number;
  durationMs: number;
  attemptNumber: number;
  fallbackUsed: boolean;
}

export interface AIErrorResult {
  error: true;
  message: string;
  provider?: AIProvider;
  modelKey?: string;
  attempts: number;
  allErrors: string[];
}

export type AICallResult = AIResponseResult | AIErrorResult;

// ─── Parsed image analysis (single AI call, JSON response) ───────────────────

/**
 * The structured result we ask the model to return in one call.
 * title   — short descriptive name (4–8 words)
 * analysis — 2–3 paragraphs of prose description
 */
export interface ImageAnalysisResult {
  title: string;
  analysis: string;
}

// ─── Rate Limiter Types ───────────────────────────────────────────────────────

export interface ProviderRateLimitState {
  provider: AIProvider;
  requestsThisMinute: number;
  windowStart: number;
  consecutiveErrors: number;
  backoffUntil: number | null;
}

// ─── Image Session Types (client-side) ────────────────────────────────────────

export type AnalysisStatus = "pending" | "loading" | "done" | "error";

export interface ImageEntry {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
  status: AnalysisStatus;
  // Populated after a successful analysis
  title?: string;
  analysis?: string;
  provider?: AIProvider;
  modelKey?: string;
  durationMs?: number;
  tokensUsed?: number;
  errorMessage?: string;
}

// Stored in IndexedDB separately (large binary)
export type ImageDataEntry = {
  id: string;
  dataUrl: string; // full data URL for display
  base64: string;  // raw base64 for API calls
  mimeType: string;
};

// ─── API Route Types ──────────────────────────────────────────────────────────

export interface AnalyzeRequestBody {
  imageBase64: string;
  mimeType: string;
  fileName: string;
  preferredModel?: string;
}

export interface AnalyzeResponseSuccess {
  success: true;
  title: string;
  analysis: string;
  provider: AIProvider;
  modelKey: string;
  durationMs: number;
  tokensUsed?: number;
  fallbackUsed: boolean;
}

export interface AnalyzeResponseError {
  success: false;
  error: string;
  attempts?: number;
}

export type AnalyzeResponse = AnalyzeResponseSuccess | AnalyzeResponseError;