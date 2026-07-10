/**
 * @module providers/base.provider
 * @description LLM 프로바이더 공통 인터페이스 및 기본 클래스 정의
 *
 * Strategy 패턴의 핵심이 되는 인터페이스와 추상 클래스를 정의합니다.
 * 모든 LLM 프로바이더(Ollama, Gemini, Groq 등)는 이 인터페이스를 구현하여
 * 동일한 방식으로 호출할 수 있도록 합니다.
 *
 * 공통 로직(메시지 전처리, SSE 파싱, 그라운딩 소스 포맷팅)은
 * BaseLLMProvider 추상 클래스에 구현되어 코드 중복을 제거합니다.
 */

import type { ChatMessage, LLMResponse } from "../types";

// ============================================================================
// 프로바이더 인터페이스
// ============================================================================

/**
 * LLM 프로바이더 인터페이스
 *
 * 모든 AI 프로바이더 클래스가 구현해야 하는 공통 계약(contract)입니다.
 * 이 인터페이스를 통해 호출부에서 프로바이더 구현 세부사항을 모르더라도
 * 일관된 방식으로 LLM 기능을 사용할 수 있습니다.
 */
export interface LLMProvider {
  /**
   * 스트리밍 방식으로 AI 채팅 응답을 생성합니다.
   *
   * HTTP 스트리밍을 통해 실시간으로 토큰을 전달받아
   * 사용자에게 타이핑 효과와 함께 응답을 표시합니다.
   *
   * @param model - 사용할 LLM 모델명
   * @param messages - 대화 히스토리 메시지 배열
   * @param systemPrompt - 시스템 프롬프트 (null이면 미적용)
   * @returns 텍스트 청크를 방출하는 ReadableStream
   */
  streamChat(
    model: string,
    messages: ChatMessage[],
    systemPrompt: string | null
  ): Promise<ReadableStream<string>>;

  /**
   * 비스트리밍 방식으로 AI 채팅 응답을 생성합니다 (에이전트용).
   *
   * 에이전트 모드에서는 전체 응답을 한 번에 받아
   * XML 태그를 파싱해야 하므로 스트리밍 대신 이 메서드를 사용합니다.
   *
   * @param model - 사용할 LLM 모델명
   * @param messages - 대화 히스토리 메시지 배열
   * @param systemPrompt - 시스템 프롬프트
   * @returns 전체 응답 텍스트와 선택적 그라운딩 소스 정보
   */
  callChat(
    model: string,
    messages: ChatMessage[],
    systemPrompt: string | null
  ): Promise<LLMResponse>;

  /**
   * 프로바이더에서 사용 가능한 모델 목록을 조회합니다.
   *
   * 설정 화면이나 대화 모델 선택 드롭다운에서
   * 동적으로 모델 목록을 불러올 때 사용됩니다.
   *
   * @returns 모델명 문자열 배열
   */
  listModels(): Promise<string[]>;
}

// ============================================================================
// 프로바이더 추상 기본 클래스
// ============================================================================

/**
 * LLM 프로바이더 추상 기본 클래스
 *
 * 여러 프로바이더에서 공통으로 사용되는 로직을 구현합니다:
 * - 메시지 배열에 시스템 프롬프트 주입
 * - OpenAI 호환 SSE 스트림 파싱 (Groq, Cerebras, Ollama, OpenRouter)
 * - 웹 검색 그라운딩 소스 HTML 포맷팅
 *
 * 각 프로바이더 클래스는 이 클래스를 상속받아
 * 프로바이더 고유의 로직만 구현하면 됩니다.
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract streamChat(
    model: string,
    messages: ChatMessage[],
    systemPrompt: string | null
  ): Promise<ReadableStream<string>>;

  abstract callChat(
    model: string,
    messages: ChatMessage[],
    systemPrompt: string | null
  ): Promise<LLMResponse>;

  abstract listModels(): Promise<string[]>;

  /**
   * 메시지 배열에 시스템 프롬프트를 주입합니다.
   *
   * OpenAI 호환 API에서 시스템 프롬프트는 메시지 배열의
   * 첫 번째 요소로 role="system"으로 추가됩니다.
   * 이미 시스템 메시지가 있으면 내용을 교체합니다.
   *
   * @param messages - 원본 메시지 배열 (변경되지 않음)
   * @param systemPrompt - 주입할 시스템 프롬프트 (null이면 원본 그대로 반환)
   * @returns 시스템 프롬프트가 주입된 새 메시지 배열
   */
  protected prepareMessages(
    messages: ChatMessage[],
    systemPrompt: string | null
  ): ChatMessage[] {
    const apiMessages = [...messages];
    if (systemPrompt) {
      const systemIndex = apiMessages.findIndex((m) => m.role === "system");
      if (systemIndex > -1) {
        apiMessages[systemIndex].content = systemPrompt;
      } else {
        apiMessages.unshift({ role: "system", content: systemPrompt });
      }
    }
    return apiMessages;
  }

  /**
   * OpenAI 호환 SSE(Server-Sent Events) 스트림을 파싱하여 ReadableStream으로 변환합니다.
   *
   * Groq, Cerebras, Ollama, OpenRouter 등 OpenAI 호환 API에서 반환하는
   * SSE 형식의 스트리밍 응답을 파싱합니다.
   *
   * SSE 형식:
   * ```
   * data: {"choices": [{"delta": {"content": "안녕"}}]}
   * data: {"choices": [{"delta": {"content": "하세요"}}]}
   * data: [DONE]
   * ```
   *
   * @param reader - fetch 응답 본문의 ReadableStreamDefaultReader
   * @param contentExtractor - 파싱된 JSON에서 텍스트를 추출하는 함수
   * @returns 텍스트 청크를 방출하는 ReadableStream
   */
  protected parseSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    contentExtractor: (parsed: Record<string, unknown>) => string | undefined
  ): ReadableStream<string> {
    const decoder = new TextDecoder();
    let buffer = "";

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data:")) continue;

              const dataStr = trimmed.slice(5).trim();
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                const content = contentExtractor(parsed);
                if (content) {
                  controller.enqueue(content);
                }
              } catch (_e) {
                /* 불완전한 JSON 청크는 무시 */
              }
            }
          }

          /* 버퍼에 남은 마지막 데이터 처리 */
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr !== "[DONE]") {
                try {
                  const parsed = JSON.parse(dataStr);
                  const content = contentExtractor(parsed);
                  if (content) controller.enqueue(content);
                } catch (_e) {
                  /* 무시 */
                }
              }
            }
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

  /**
   * 웹 검색 그라운딩 소스를 접을 수 있는 HTML 형식으로 포맷팅합니다.
   *
   * Gemini의 검색 그라운딩이나 외부 웹 검색 결과의 출처를
   * 마크다운 <details> 태그로 포맷팅하여 채팅 메시지 끝에 추가합니다.
   *
   * @param sources - URL → 제목 매핑 (Map 객체)
   * @returns 포맷팅된 HTML 문자열
   */
  protected formatGroundingSources(sources: Map<string, string>): string {
    if (sources.size === 0) return "";

    let text =
      "\n\n<details>\n<summary>🌐 웹 검색 출처 보기 (클릭하여 펼치기)</summary>\n\n";
    for (const [uri, title] of sources.entries()) {
      text += `- [${title}](${uri})\n`;
    }
    text += "</details>";
    return text;
  }
}
