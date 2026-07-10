/**
 * @module providers/openrouter.provider
 * @description OpenRouter 통합 LLM 프로바이더 구현
 *
 * OpenRouter를 통해 다양한 AI 모델(GPT, Claude, Gemini 등)에
 * 단일 API로 접근하는 프로바이더입니다.
 * 추가 헤더(HTTP-Referer, X-Title)가 필요합니다.
 */
import { BaseLLMProvider } from "./base.provider";
import { settingRepository } from "../database";
import { PROVIDER_API_ENDPOINTS, PROVIDER_MODEL_ENDPOINTS } from "../config/constants";
import type { ChatMessage, LLMResponse } from "../types";

export class OpenRouterProvider extends BaseLLMProvider {
  private getHeaders(): Record<string, string> {
    const key = settingRepository.get("openrouter_api_key");
    if (!key) throw new Error("OpenRouter API key not set.");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "LiteAI",
    };
  }

  async streamChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<ReadableStream<string>> {
    const apiMessages = this.prepareMessages(messages, systemPrompt);
    const response = await fetch(PROVIDER_API_ENDPOINTS.openrouter, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ model, messages: apiMessages, stream: true }),
    });
    if (!response.ok) throw new Error(`API error (${response.status}): ${await response.text()}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable.");
    return this.parseSSEStream(reader, (parsed) => {
      const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
      return choices?.[0]?.delta?.content;
    });
  }

  async callChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<LLMResponse> {
    const apiMessages = this.prepareMessages(messages, systemPrompt);
    const response = await fetch(PROVIDER_API_ENDPOINTS.openrouter, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ model, messages: apiMessages, stream: false }),
    });
    if (!response.ok) throw new Error(`LLM call failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { content: data.choices?.[0]?.message?.content || "" };
  }

  async listModels(): Promise<string[]> {
    const key = settingRepository.get("openrouter_api_key");
    const headers: Record<string, string> = {};
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const response = await fetch(PROVIDER_MODEL_ENDPOINTS.openrouter, { headers });
    if (!response.ok) return [];
    const data = await response.json() as { data?: Array<{ id: string }> };
    return Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
  }
}
