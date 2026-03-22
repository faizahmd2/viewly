/**
 * POST /api/analyze
 *
 * Single AI call per image → returns { title, analysis } parsed from JSON.
 * Token budget is kept tight for free-tier longevity.
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzeImage } from "@/lib/ai/caller";
import type { AnalyzeRequestBody, AnalyzeResponse } from "@/types";

const MAX_BASE64_SIZE = 10 * 1024 * 1024; // ~10MB base64 ≈ 7.5MB actual

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeResponse>> {
  try {
    const body: AnalyzeRequestBody = await req.json();

    // ── Validation ────────────────────────────────────────────────────────────

    if (!body.imageBase64) {
      return NextResponse.json(
        { success: false, error: "Missing imageBase64" },
        { status: 400 }
      );
    }

    if (!body.mimeType) {
      return NextResponse.json(
        { success: false, error: "Missing mimeType" },
        { status: 400 }
      );
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
    if (!allowed.includes(body.mimeType)) {
      return NextResponse.json(
        { success: false, error: `Unsupported type: ${body.mimeType}` },
        { status: 400 }
      );
    }

    if (body.imageBase64.length > MAX_BASE64_SIZE) {
      return NextResponse.json(
        { success: false, error: "Image too large. Max ~7.5MB." },
        { status: 413 }
      );
    }

    // ── Build optional custom fallback chain from client hint ─────────────────

    let fallbackChain: string[] | undefined;
    if (body.preferredModel) {
      const { DEFAULT_FALLBACK_CHAIN } = await import("@/types");
      const rest = DEFAULT_FALLBACK_CHAIN.filter((k) => k !== body.preferredModel);
      fallbackChain = [body.preferredModel, ...rest];
    }

    // ── Single AI call ────────────────────────────────────────────────────────

    const { result, meta } = await analyzeImage(
      body.imageBase64,
      body.mimeType,
      { fallbackChain }
    );

    return NextResponse.json({
      success: true,
      title: result.title,
      analysis: result.analysis,
      provider: meta.provider,
      modelKey: meta.modelKey,
      durationMs: meta.durationMs,
      tokensUsed: meta.tokensUsed,
      fallbackUsed: meta.fallbackUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/analyze]", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 503 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}