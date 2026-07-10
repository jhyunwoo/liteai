/**
 * @module routes/chat.routes
 * @description 채팅 스트리밍 API 라우트
 *
 * LLM 프로바이더를 통해 실시간 스트리밍 채팅 응답을 생성합니다.
 * 웹 검색 그라운딩 기능을 선택적으로 활용할 수 있습니다.
 */

import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { conversationRepository, messageRepository, settingRepository } from "../database";
import { getProvider } from "../providers";
import { buildSearchContext, formatSearchSources } from "../services/chat.service";
import { handleRouteError } from "../utils/error-handler";
import type { ProviderName, SearchResult } from "../types";

export const chatRoutes = new Hono();

/** POST / - 스트리밍 채팅 응답 생성 */
chatRoutes.post("/", async (c) => {
  try {
    const { conversationId, message, webSearch } = await c.req.json();
    const conv = conversationRepository.getById(conversationId);
    if (!conv) return c.json({ error: "Conversation not found" }, 404);

    /* 사용자 메시지 저장 */
    messageRepository.create(crypto.randomUUID(), conversationId, "user", message);

    /* 대화 히스토리 구성 */
    const history = messageRepository.getByConversationId(conversationId).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    /* 웹 검색 그라운딩 (선택적) */
    let searchResults: SearchResult[] = [];
    if (webSearch) {
      const searchContext = await buildSearchContext(message);
      if (searchContext && history.length > 0 && history[history.length - 1].role === "user") {
        history[history.length - 1].content = searchContext.enrichedMessage;
        searchResults = searchContext.searchResults;
      }
    }

    /* 프로바이더 Strategy 패턴으로 스트리밍 응답 생성 */
    const provider = getProvider(conv.provider as ProviderName);

    return streamText(c, async (stream) => {
      let assistantMessage = "";
      try {
        const chatStream = await provider.streamChat(conv.model, history, conv.system_prompt);
        const reader = chatStream.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantMessage += value;
          await stream.write(value);
        }

        /* 외부 웹 검색 출처 추가 (Gemini 자체 그라운딩은 이미 스트림에 포함) */
        const isGeminiGrounding = conv.provider === "gemini" && settingRepository.get("gemini_search_grounding") === "true";
        if (webSearch && searchResults.length > 0 && !isGeminiGrounding) {
          const sourcesText = formatSearchSources(searchResults);
          assistantMessage += sourcesText;
          await stream.write(sourcesText);
        }
      } catch (err: unknown) {
        console.error("Streaming error:", err);
        const errorMsg = `\n[Error during generation: ${(err as Error).message}]`;
        assistantMessage += errorMsg;
        await stream.write(errorMsg);
      } finally {
        if (assistantMessage.trim()) {
          messageRepository.create(crypto.randomUUID(), conversationId, "assistant", assistantMessage);
        }
      }
    });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});
