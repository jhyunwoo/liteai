/**
 * @module providers/cerebras.provider
 * @description Cerebras AI LLM 프로바이더 구현
 *
 * Cerebras의 OpenAI 호환 API를 사용하는 프로바이더입니다.
 * 하드웨어 가속 추론이 특징이며 API 키가 필수입니다.
 */
import { BaseLLMProvider } from "./base.provider";
import { settingRepository } from "../database";
import { PROVIDER_API_ENDPOINTS, PROVIDER_MODEL_ENDPOINTS } from "../config/constants";
import type { ChatMessage, LLMResponse } from "../types";

export class CerebrasProvider extends BaseLLMProvider {
  private getApiKey(): string {
    const key = settingRepository.get("cerebras_api_key");
    if (!key) throw new Error("Cerebras API key not set.");
    return key;
  }

  async streamChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<ReadableStream<string>> {
    const apiMessages = this.prepareMessages(messages, systemPrompt);
    const response = await fetch(PROVIDER_API_ENDPOINTS.cerebras, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
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
    const response = await fetch(PROVIDER_API_ENDPOINTS.cerebras, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({ model, messages: apiMessages, stream: false }),
    });
    if (!response.ok) throw new Error(`LLM call failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { content: data.choices?.[0]?.message?.content || "" };
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(PROVIDER_MODEL_ENDPOINTS.cerebras, {
      headers: { Authorization: `Bearer ${this.getApiKey()}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as { data?: Array<{ id: string }> };
    return Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
  }
}
