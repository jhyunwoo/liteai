/**
 * @module providers/gemini.provider
 * @description Google Gemini LLM 프로바이더 구현
 *
 * Gemini API는 OpenAI와 다른 독자적인 메시지 형식을 사용합니다:
 * - 메시지 역할: "user" | "model" (OpenAI의 "assistant" 대신 "model")
 * - 시스템 프롬프트: 별도의 systemInstruction 필드 사용
 * - 스트리밍: JSON 배열 형태로 반환 (SSE가 아님)
 * - 검색 그라운딩: google_search 도구를 통한 실시간 검색 지원
 *
 * 스트리밍 파서는 중괄호 카운팅 방식으로 불완전한 JSON 스트림에서
 * 개별 JSON 객체를 추출하는 특수한 로직을 사용합니다.
 */
import { BaseLLMProvider } from "./base.provider";
import { settingRepository } from "../database";
import type { ChatMessage, LLMResponse } from "../types";

/** Gemini API 응답의 후보(candidate) 구조 타입 */
interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
}

/** Gemini API 응답 구조 타입 */
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export class GeminiProvider extends BaseLLMProvider {
  private getApiKey(): string {
    const key = settingRepository.get("gemini_api_key");
    if (!key) throw new Error("Gemini API key not set.");
    return key;
  }

  /** Gemini 형식의 메시지 배열과 요청 본문을 구성합니다. */
  private buildGeminiBody(messages: ChatMessage[], systemPrompt: string | null): Record<string, unknown> {
    const apiMessages = this.prepareMessages(messages, systemPrompt);

    /* Gemini는 시스템 메시지를 contents에 넣지 않고 별도 필드로 분리 */
    const contents = apiMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = { contents };

    /* 시스템 프롬프트를 systemInstruction 필드로 설정 */
    const systemMsg = apiMessages.find((m) => m.role === "system")?.content;
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg }] };
    }

    /* Google 검색 그라운딩 활성화 여부 확인 */
    if (settingRepository.get("gemini_search_grounding") === "true") {
      body.tools = [{ google_search: {} }];
    }

    return body;
  }

  /** Gemini 응답에서 그라운딩 소스를 추출합니다. */
  private extractGroundingSources(candidate: GeminiCandidate | undefined): Map<string, string> {
    const sources = new Map<string, string>();
    const chunks = candidate?.groundingMetadata?.groundingChunks;
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title || uri;
        if (uri) sources.set(uri, title);
      }
    }
    return sources;
  }

  async streamChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<ReadableStream<string>> {
    const apiKey = this.getApiKey();
    const body = this.buildGeminiBody(messages, systemPrompt);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`API error (${response.status}): ${await response.text()}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable.");

    const decoder = new TextDecoder();
    let buffer = "";
    const self = this;

    /**
     * Gemini 스트리밍 응답은 JSON 배열 형태로 반환됩니다:
     * [{"candidates":[...]}, {"candidates":[...]}, ...]
     *
     * 중괄호 카운팅으로 개별 JSON 객체를 분리하여 파싱합니다.
     */
    return new ReadableStream<string>({
      async start(controller) {
        const geminiSources = new Map<string, string>();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let cleanBuffer = buffer.trim();

            /* JSON 배열의 시작 브래킷과 구분 쉼표 제거 */
            if (cleanBuffer.startsWith("[")) cleanBuffer = cleanBuffer.slice(1).trim();
            if (cleanBuffer.startsWith(",")) cleanBuffer = cleanBuffer.slice(1).trim();

            /* 중괄호 카운팅으로 완전한 JSON 객체 추출 */
            let braceCount = 0;
            let startIdx = -1;
            for (let i = 0; i < cleanBuffer.length; i++) {
              if (cleanBuffer[i] === "{") {
                if (braceCount === 0) startIdx = i;
                braceCount++;
              } else if (cleanBuffer[i] === "}") {
                braceCount--;
                if (braceCount === 0 && startIdx !== -1) {
                  const jsonStr = cleanBuffer.slice(startIdx, i + 1);
                  try {
                    const parsed = JSON.parse(jsonStr) as GeminiResponse;
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) controller.enqueue(text);

                    /* 그라운딩 소스 수집 */
                    const sources = self.extractGroundingSources(parsed.candidates?.[0]);
                    for (const [uri, title] of sources) geminiSources.set(uri, title);
                  } catch (_e) { /* 불완전한 JSON 무시 */ }

                  buffer = cleanBuffer.slice(i + 1).trim();
                  if (buffer.startsWith(",")) buffer = buffer.slice(1).trim();
                  cleanBuffer = buffer;
                  i = -1;
                }
              }
            }
          }

          /* 그라운딩 소스가 있으면 스트림 끝에 추가 */
          if (geminiSources.size > 0) {
            controller.enqueue(self.formatGroundingSources(geminiSources));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  async callChat(model: string, messages: ChatMessage[], systemPrompt: string | null): Promise<LLMResponse> {
    const apiKey = this.getApiKey();
    const body = this.buildGeminiBody(messages, systemPrompt);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`LLM call failed (${response.status}): ${await response.text()}`);
    const data = await response.json() as GeminiResponse;

    let content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const sources = this.extractGroundingSources(data.candidates?.[0]);

    if (sources.size > 0) {
      content += this.formatGroundingSources(sources);
    }

    return { content, groundingSources: sources.size > 0 ? sources : undefined };
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name: string }> };
    if (!Array.isArray(data.models)) return [];
    return data.models
      .map((m) => m.name.replace("models/", ""))
      .filter((name) => name.startsWith("gemini-"));
  }
}
