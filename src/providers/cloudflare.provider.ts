/**
 * @module providers/cloudflare.provider
 * @description Cloudflare Workers AI LLM 프로바이더 구현
 *
 * Cloudflare의 Workers AI 인프라를 사용하는 프로바이더입니다.
 * 다른 프로바이더와 달리 모델명이 URL 경로에 포함되며,
 * 스트리밍 응답 형식이 `parsed.response` 필드를 사용합니다.
 */
import { BaseLLMProvider } from "./base.provider";
import { settingRepository } from "../database";
import type { ChatMessage, LLMResponse } from "../types";

export class CloudflareProvider extends BaseLLMProvider {
  /** 계정 ID와 API 토큰을 가져옵니다. 둘 다 필수입니다. */
  private getConfig(): { accountId: string; token: string } {
    const accountId = settingRepository.get("cloudflare_account_id");
    const token = settingRepository.get("cloudflare_api_token");
    if (!accountId || !token) throw new Error("Cloudflare account ID or API token not set.");
    return { accountId, token };
  }

  /** 모델명이 포함된 Cloudflare AI API URL을 생성합니다. */
  private getModelUrl(accountId: string, model: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  }

  async streamChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<ReadableStream<string>> {
    const { accountId, token } = this.getConfig();
    const apiMessages = this.prepareMessages(messages, systemPrompt);
    const response = await fetch(this.getModelUrl(accountId, model), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: apiMessages, stream: true }),
    });
    if (!response.ok) throw new Error(`API error (${response.status}): ${await response.text()}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable.");

    /* Cloudflare는 response 필드에 텍스트를 반환 (OpenAI와 다른 형식) */
    return this.parseSSEStream(reader, (parsed) => {
      return (parsed as { response?: string }).response;
    });
  }

  async callChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<LLMResponse> {
    const { accountId, token } = this.getConfig();
    const apiMessages = this.prepareMessages(messages, systemPrompt);
    const response = await fetch(this.getModelUrl(accountId, model), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: apiMessages, stream: false }),
    });
    if (!response.ok) throw new Error(`LLM call failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as { result?: { response?: string } };
    return { content: data.result?.response || "" };
  }

  async listModels(): Promise<string[]> {
    const { accountId, token } = this.getConfig();
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return [];
    const data = await response.json() as { result?: Array<{ name: string }> };
    return Array.isArray(data.result) ? data.result.map((m) => m.name) : [];
  }
}
