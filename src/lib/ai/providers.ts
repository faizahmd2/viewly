/**
 * Provider Adapters
 *
 * Each adapter implements a unified `callProvider` signature.
 * Adding a new provider = adding a new adapter + registering it below.
 *
 * Future: queue/webhook support would wrap these adapters with
 * a job emitter instead of direct await.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AIRequestPayload, AIModel } from "@/types";

export interface ProviderCallResult {
  text: string;
  tokensUsed?: number;
}

export type ProviderAdapter = (
  payload: AIRequestPayload,
  model: AIModel
) => Promise<ProviderCallResult>;

// ─── Gemini Adapter ───────────────────────────────────────────────────────────

export const geminiAdapter: ProviderAdapter = async (payload, model) => {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model: model.id,
    generationConfig: {
      maxOutputTokens: payload.maxTokens ?? 2048,
      temperature: payload.temperature ?? 0.7,
    },
    systemInstruction: payload.systemPrompt,
  });

  let parts: Parameters<typeof geminiModel.generateContent>[0];

  if (payload.imageBase64 && payload.imageMimeType) {
    parts = [
      {
        inlineData: {
          data: payload.imageBase64,
          mimeType: payload.imageMimeType as "image/jpeg" | "image/png" | "image/webp",
        },
      },
      { text: payload.prompt },
    ];
  } else {
    parts = [{ text: payload.prompt }];
  }

  const result = await geminiModel.generateContent(parts);
  const response = result.response;
  const text = response.text();

  return {
    text,
    tokensUsed: response.usageMetadata?.totalTokenCount,
  };
};

// ─── Claude Adapter ───────────────────────────────────────────────────────────

export const claudeAdapter: ProviderAdapter = async (payload, model) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });

  const userContent: Anthropic.MessageParam["content"] = [];

  if (payload.imageBase64 && payload.imageMimeType) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: payload.imageMimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: payload.imageBase64,
      },
    });
  }

  userContent.push({ type: "text", text: payload.prompt });

  const response = await client.messages.create({
    model: model.id,
    max_tokens: payload.maxTokens ?? 2048,
    system: payload.systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  return {
    text: textBlock.text,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  };
};

// ─── OpenAI Adapter ───────────────────────────────────────────────────────────

export const openaiAdapter: ProviderAdapter = async (payload, model) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });

  const userContent: OpenAI.ChatCompletionContentPart[] = [];

  if (payload.imageBase64 && payload.imageMimeType) {
    const dataUrl = `data:${payload.imageMimeType};base64,${payload.imageBase64}`;
    userContent.push({
      type: "image_url",
      image_url: { url: dataUrl, detail: "high" },
    });
  }

  userContent.push({ type: "text", text: payload.prompt });

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (payload.systemPrompt) {
    messages.push({ role: "system", content: payload.systemPrompt });
  }
  messages.push({ role: "user", content: userContent });

  const response = await client.chat.completions.create({
    model: model.id,
    messages,
    max_tokens: payload.maxTokens ?? 2048,
    temperature: payload.temperature ?? 0.7,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no text content");

  return {
    text,
    tokensUsed: response.usage?.total_tokens,
  };
};

// ─── Adapter Registry ─────────────────────────────────────────────────────────

import type { AIProvider } from "@/types";

export const PROVIDER_ADAPTERS: Record<AIProvider, ProviderAdapter> = {
  gemini: geminiAdapter,
  claude: claudeAdapter,
  openai: openaiAdapter,
};