/**
 * GET /api/health
 *
 * Returns current provider availability, rate limit states,
 * and which API keys are configured (without revealing values).
 */

import { NextResponse } from "next/server";
import { rateLimiter } from "@/lib/ai/rate-limiter";

export async function GET() {
  const providers = {
    gemini: Boolean(process.env.GOOGLE_AI_API_KEY),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  };

  const configuredCount = Object.values(providers).filter(Boolean).length;
  const rateLimitStatus = rateLimiter.getStatus();

  return NextResponse.json({
    status: configuredCount > 0 ? "ok" : "degraded",
    providers: {
      gemini: {
        configured: providers.gemini,
        ...rateLimitStatus.gemini,
      },
      claude: {
        configured: providers.claude,
        ...rateLimitStatus.claude,
      },
      openai: {
        configured: providers.openai,
        ...rateLimitStatus.openai,
      },
    },
    configuredCount,
    timestamp: new Date().toISOString(),
  });
}