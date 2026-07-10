/**
 * @module services/search.service
 * @description 웹 검색 서비스 모듈
 *
 * 여러 검색 프로바이더(DuckDuckGo, Brave, Serper, SearXNG, Ollama)를 통합하여
 * 웹 검색 기능을 제공합니다. 설정에서 선택한 검색 프로바이더에 따라
 * 해당 API를 호출하고 통일된 SearchResult 형식으로 결과를 반환합니다.
 *
 * 검색 결과는 AI 채팅의 실시간 정보 컨텍스트로 주입되어
 * LLM이 최신 정보를 기반으로 응답할 수 있도록 합니다.
 */

import { settingRepository } from "../database";
import { DEFAULT_OLLAMA_URL, SEARCH_MAX_RESULTS } from "../config/constants";
import type { SearchResult, SearchProviderName } from "../types";

/**
 * 설정된 검색 프로바이더를 사용하여 웹 검색을 수행합니다.
 *
 * @param query - 검색 쿼리 문자열
 * @returns 최대 SEARCH_MAX_RESULTS개의 검색 결과 배열
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const provider = (settingRepository.get("search_provider") || "duckduckgo") as SearchProviderName;

  switch (provider) {
    case "brave":
      return searchBrave(query);
    case "serper":
      return searchSerper(query);
    case "searxng":
      return searchSearxng(query);
    case "ollama":
      return searchOllama(query);
    default:
      return searchDuckDuckGo(query);
  }
}

/** Brave Search API를 사용한 웹 검색 */
async function searchBrave(query: string): Promise<SearchResult[]> {
  const apiKey = settingRepository.get("brave_search_key");
  if (!apiKey) throw new Error("Brave Search API key not set.");

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } }
  );
  if (!response.ok) throw new Error(`Brave Search failed: ${response.statusText}`);

  const data = await response.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  const results: SearchResult[] = (data.web?.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.description,
  }));
  return results.slice(0, SEARCH_MAX_RESULTS);
}

/** Serper.dev (Google Search) API를 사용한 웹 검색 */
async function searchSerper(query: string): Promise<SearchResult[]> {
  const apiKey = settingRepository.get("serper_api_key");
  if (!apiKey) throw new Error("Serper API key not set.");

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query }),
  });
  if (!response.ok) throw new Error(`Serper search failed: ${response.statusText}`);

  const data = await response.json() as { organic?: Array<{ title: string; link: string; snippet?: string }> };
  const results: SearchResult[] = (data.organic || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet || "",
  }));
  return results.slice(0, SEARCH_MAX_RESULTS);
}

/** SearXNG 메타 검색 엔진을 사용한 웹 검색 */
async function searchSearxng(query: string): Promise<SearchResult[]> {
  const baseUrl = settingRepository.get("searxng_url");
  if (!baseUrl) throw new Error("SearXNG URL is not configured.");

  const searchUrl = `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`;
  const response = await fetch(searchUrl);
  if (!response.ok) throw new Error(`SearXNG search failed: ${response.statusText}`);

  const data = await response.json() as { results?: Array<{ title: string; url: string; content?: string }> };
  const results: SearchResult[] = (data.results || []).map((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.content || "",
  }));
  return results.slice(0, SEARCH_MAX_RESULTS);
}

/** Ollama Web Search API를 사용한 웹 검색 */
async function searchOllama(query: string): Promise<SearchResult[]> {
  const ollamaUrl = settingRepository.get("ollama_url") || DEFAULT_OLLAMA_URL;
  const apiKey = settingRepository.get("ollama_api_key");

  /* 로컬 Ollama + API 키가 있으면 공식 올라마 검색 API 사용 */
  let searchUrl = `${ollamaUrl.replace(/\/$/, "")}/api/web_search`;
  if (apiKey && (!ollamaUrl || ollamaUrl.includes("localhost") || ollamaUrl.includes("127.0.0.1"))) {
    searchUrl = "https://ollama.com/api/web_search";
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(searchUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, max_results: SEARCH_MAX_RESULTS }),
  });
  if (!response.ok) throw new Error(`Ollama Search failed: ${response.statusText}`);

  const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }> };
  const results: SearchResult[] = (data.results || []).map((item) => ({
    title: item.title || "Ollama Search Result",
    url: item.url || "",
    snippet: item.content || item.snippet || "",
  }));
  return results.slice(0, SEARCH_MAX_RESULTS);
}

/**
 * DuckDuckGo HTML 페이지를 크롤링하여 검색 결과를 추출합니다.
 *
 * API 키가 필요 없는 무료 폴백 검색 방법입니다.
 * HTML 정규표현식 파싱을 사용하므로 DuckDuckGo의 HTML 구조가
 * 변경되면 결과가 비어있을 수 있습니다.
 */
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      }
    );
    if (!response.ok) throw new Error(`DuckDuckGo request failed: ${response.statusText}`);
    const html = await response.text();

    const results: SearchResult[] = [];
    const resultBlockRegex = /<div class="[^"]*web-result[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g;
    let match;
    let count = 0;

    while ((match = resultBlockRegex.exec(html)) !== null && count < SEARCH_MAX_RESULTS) {
      const block = match[1];
      const linkMatch = /<a class="result__url"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      const snippetMatch = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

      if (linkMatch && snippetMatch) {
        let url = linkMatch[1];
        if (url.includes("uddg=")) {
          const matchUddg = /uddg=([^&]*)/.exec(url);
          if (matchUddg) url = decodeURIComponent(matchUddg[1]);
        }
        const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();
        const snippet = snippetMatch[1].replace(/<[^>]*>/g, "").trim();
        if (title && url) {
          results.push({ title, url, snippet });
          count++;
        }
      }
    }

    /* 정규표현식 실패 시 대체 파싱 시도 */
    if (results.length === 0) {
      const fallbackMatch = html.match(/<a class="result__url"[\s\S]*?<\/a>/gi);
      if (fallbackMatch) {
        for (let i = 0; i < Math.min(fallbackMatch.length, SEARCH_MAX_RESULTS); i++) {
          const href = /href="([^"]*)"/.exec(fallbackMatch[i]);
          const title = fallbackMatch[i].replace(/<[^>]*>/g, "").trim();
          if (href && title) {
            results.push({
              title,
              url: href[1].includes("uddg=") ? decodeURIComponent(/uddg=([^&]*)/.exec(href[1])?.[1] || href[1]) : href[1],
              snippet: "DuckDuckGo search result context.",
            });
          }
        }
      }
    }
    return results;
  } catch (err) {
    console.error("DuckDuckGo scraping failed:", err);
    return [];
  }
}
