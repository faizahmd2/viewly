/**
 * AI Caller — Core Engine
 *
 * Single entry point for all AI calls.
 * One call per image → JSON response with title + analysis.
 * Token budget is kept tight to maximise free-tier longevity.
 */

import {
  AI_MODELS,
  DEFAULT_FALLBACK_CHAIN,
  type AIRequestPayload,
  type AICallResult,
  type AIResponseResult,
  type ImageAnalysisResult,
} from "@/types";
import { PROVIDER_ADAPTERS } from "./providers";
import { rateLimiter } from "./rate-limiter";

export interface CallAIOptions {
  fallbackChain?: string[];
  requireVision?: boolean;
  timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function callAI(
  payload: AIRequestPayload,
  options: CallAIOptions = {}
): Promise<AICallResult> {
  const {
    fallbackChain = buildFallbackChain(),
    requireVision = true,
    timeoutMs = 30_000,
  } = options;

  const hasImage = Boolean(payload.imageBase64);
  const startTotal = Date.now();
  const allErrors: string[] = [];
  let attemptNumber = 0;
  let firstAttemptModelKey: string | null = null;

  for (const modelKey of fallbackChain) {
    const model = AI_MODELS[modelKey];
    if (!model) continue;
    if (hasImage && requireVision && !model.supportsVision) continue;
    if (!rateLimiter.canUse(model.provider)) {
      allErrors.push(`${modelKey}: rate limited`);
      continue;
    }
    if (!isProviderConfigured(model.provider)) {
      allErrors.push(`${modelKey}: not configured`);
      continue;
    }

    attemptNumber++;
    if (!firstAttemptModelKey) firstAttemptModelKey = modelKey;

    try {
      console.info(`[AI] ${modelKey} attempt #${attemptNumber}`);
      rateLimiter.recordRequest(model.provider);

      const adapter = PROVIDER_ADAPTERS[model.provider];
      const result = await withTimeout(adapter(payload, model), timeoutMs);

      rateLimiter.recordSuccess(model.provider);

      const response: AIResponseResult = {
        text: result.text,
        provider: model.provider,
        modelKey,
        modelId: model.id,
        tokensUsed: result.tokensUsed,
        durationMs: Date.now() - startTotal,
        attemptNumber,
        fallbackUsed: modelKey !== firstAttemptModelKey,
      };

      console.info(
        `[AI] OK: ${modelKey} ${response.durationMs}ms ~${result.tokensUsed ?? "?"}tok`
      );
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AI] ${modelKey} failed: ${msg}`);
      rateLimiter.recordError(model.provider);
      allErrors.push(`${modelKey}: ${msg}`);
    }
  }

  return {
    error: true,
    message: "All AI providers failed. Check API keys in .env.local",
    attempts: attemptNumber,
    allErrors,
  };
}

function buildFallbackChain(): string[] {
  const envChain = process.env.AI_FALLBACK_CHAIN;
  if (envChain) return envChain.split(",").map((s) => s.trim()).filter(Boolean);

  const primary = process.env.AI_PRIMARY_PROVIDER;
  if (primary) {
    const primaryModels = DEFAULT_FALLBACK_CHAIN.filter(
      (k) => AI_MODELS[k]?.provider === primary
    );
    const rest = DEFAULT_FALLBACK_CHAIN.filter(
      (k) => AI_MODELS[k]?.provider !== primary
    );
    return [...primaryModels, ...rest];
  }

  return DEFAULT_FALLBACK_CHAIN;
}

function isProviderConfigured(provider: string): boolean {
  switch (provider) {
    case "gemini": return Boolean(process.env.GOOGLE_AI_API_KEY);
    case "claude": return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openai": return Boolean(process.env.OPENAI_API_KEY);
    default: return false;
  }
}

// ─── Image analysis — single call, structured JSON output ────────────────────

/**
 * System prompt engineered for:
 * - Minimal output tokens (no filler, no repetition)
 * - Strict JSON so parsing never fails
 * - Rich but concise analysis (2 focused paragraphs)
 * - A short title so the sidebar shows something meaningful
 */
const IMAGE_ANALYSIS_SYSTEM = `You are a concise visual analyst. Respond with ONLY valid JSON — no markdown, no code fences, no extra text.

Return exactly this shape:
{"title":"<4-8 word descriptive title>","analysis":"<paragraph 1>\\n\\n<paragraph 2>"}

Rules:
- title: specific and descriptive, not generic ("Golden hour rice terraces, Bali" not "Beautiful landscape")
- analysis: exactly 2 paragraphs separated by \\n\\n
- paragraph 1: describe what is in the image — subjects, colours, composition, lighting
- paragraph 2: interpret mood, context, story, or meaning
- total analysis: 120-180 words maximum
- no bullet points, no headers, no lists in the analysis
- write in flowing prose`;

const IMAGE_ANALYSIS_PROMPT =
  "Analyze this image and return the JSON response as instructed.";

/**
 * Analyze an image in ONE API call.
 * Returns a parsed { title, analysis } or throws if JSON cannot be extracted.
 */
export async function analyzeImage(
  imageBase64: string,
  mimeType: string,
  options?: CallAIOptions
): Promise<{ result: ImageAnalysisResult; meta: AIResponseResult }> {
  const callResult = await callAI(
    {
      purpose: "image_analysis",
      prompt: IMAGE_ANALYSIS_PROMPT,
      systemPrompt: IMAGE_ANALYSIS_SYSTEM,
      imageBase64,
      imageMimeType: mimeType,
      // Keep tight: system + prompt ~120 tokens in, 200 tokens out max
      maxTokens: 300,
      temperature: 0.4, // lower = more consistent JSON output
    },
    options
  );

  if ("error" in callResult) {
    throw new Error(callResult.message);
  }

  const parsed = parseAnalysisJSON(callResult.text);
  return { result: parsed, meta: callResult };
}

/**
 * Robustly parse the model's JSON response.
 * Handles common model misbehaviours:
 *   - Wrapping in ```json ... ``` fences
 *   - Leading/trailing prose before/after the JSON object
 *   - Missing fields (graceful fallback values)
 */
function parseAnalysisJSON(raw: string): ImageAnalysisResult {
  // Strip markdown code fences if present
  let cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  // Extract first {...} block in case there's surrounding prose
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];

  try {
    const parsed = JSON.parse(cleaned) as Partial<ImageAnalysisResult>;
    return {
      title: typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : "Untitled image",
      analysis: typeof parsed.analysis === "string" && parsed.analysis.trim()
        ? parsed.analysis.trim()
        : cleaned, // last resort: show raw text
    };
  } catch {
    // JSON parse failed entirely — salvage what we can from raw text
    console.warn("[AI] JSON parse failed, using raw text as analysis");
    return {
      title: "Untitled image",
      analysis: raw.trim(),
    };
  }
}