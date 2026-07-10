/**
 * @module services/chat.service
 * @description 채팅 비즈니스 로직 서비스
 *
 * 웹 검색 그라운딩 컨텍스트 구성, 검색 출처 포맷팅 등
 * 채팅 라우트에서 사용하는 비즈니스 로직을 캡슐화합니다.
 */

import { searchWeb } from "./search.service";
import type { SearchResult } from "../types";

/**
 * 웹 검색 결과를 대화 컨텍스트에 주입할 형태로 구성합니다.
 *
 * 사용자의 질문을 웹 검색하고, 검색 결과를 구조화된 텍스트로 변환하여
 * LLM이 최신 정보를 참고할 수 있도록 컨텍스트를 구성합니다.
 *
 * @param query - 사용자의 원본 질문 텍스트
 * @returns 검색 결과와 강화된 메시지, 실패 시 null
 */
export async function buildSearchContext(query: string): Promise<{
  enrichedMessage: string;
  searchResults: SearchResult[];
} | null> {
  try {
    const searchResults = await searchWeb(query);
    if (!searchResults || searchResults.length === 0) return null;

    const searchContext = searchResults
      .map((r, i) => `[검색결과 ${i + 1}] 제목: ${r.title}\n출처: ${r.url}\n요약: ${r.snippet}`)
      .join("\n\n");

    const enrichedMessage = `[실시간 웹 검색 결과]\n${searchContext}\n\n[사용자 질문]\n${query}`;
    return { enrichedMessage, searchResults };
  } catch (err) {
    console.error("Web search grounding failed:", err);
    return null;
  }
}

/**
 * 검색 결과 출처를 마크다운 접이식 형태로 포맷팅합니다.
 *
 * @param searchResults - 포맷팅할 검색 결과 배열
 * @returns 마크다운 <details> 형식의 출처 텍스트
 */
export function formatSearchSources(searchResults: SearchResult[]): string {
  return (
    "\n\n<details>\n<summary>🌐 웹 검색 출처 보기 (클릭하여 펼치기)</summary>\n\n" +
    searchResults.map((r) => `- [${r.title}](${r.url})`).join("\n") +
    "\n</details>"
  );
}
