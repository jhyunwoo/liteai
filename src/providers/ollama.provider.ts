/**
 * @module providers/ollama.provider
 * @description Ollama LLM 프로바이더 구현
 *
 * 로컬 또는 원격 Ollama 서버와 통신하는 프로바이더입니다.
 * OpenAI 호환 API (/v1/chat/completions)를 사용합니다.
 * API 키는 선택사항이며, 원격 프록시 서버 사용 시에만 필요합니다.
 */

import { BaseLLMProvider } from "./base.provider";
import { settingRepository } from "../database";
import { DEFAULT_OLLAMA_URL } from "../config/constants";
import type { ChatMessage, LLMResponse } from "../types";

export class OllamaProvider extends BaseLLMProvider {
  /** Ollama 서버 URL과 인증 헤더를 가져옵니다. */
  private getConfig(): { url: string; headers: Record<string, string> } {
    const baseUrl = (settingRepository.get("ollama_url") || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
    const apiKey = settingRepository.get("ollama_api_key");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    return { url: baseUrl, headers };
  }

  async streamChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<ReadableStream<string>> {
    const { url, headers } = this.getConfig();
    const apiMessages = this.prepareMessages(messages, systemPrompt);

    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers,
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
    const { url, headers } = this.getConfig();
    const apiMessages = this.prepareMessages(messages, systemPrompt);

    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: apiMessages, stream: false }),
    });

    if (!response.ok) throw new Error(`LLM call failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { content: data.choices?.[0]?.message?.content || "" };
  }

  async listModels(): Promise<string[]> {
    const { url, headers } = this.getConfig();
    const response = await fetch(`${url}/api/tags`, { headers });
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name: string }> };
    return Array.isArray(data.models) ? data.models.map((m) => m.name) : [];
  }
}
