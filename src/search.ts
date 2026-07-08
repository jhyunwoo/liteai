import { getSetting } from "./db";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const provider = getSetting("search_provider") || "duckduckgo";

  if (provider === "brave") {
    const apiKey = getSetting("brave_search_key");
    if (!apiKey) {
      throw new Error("Brave Search API key not set.");
    }
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        query
      )}`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Brave Search failed: ${response.statusText}`);
    }
    const data: any = await response.json();
    const results: SearchResult[] = [];
    if (data.web?.results) {
      for (const item of data.web.results) {
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.description,
        });
      }
    }
    return results.slice(0, 5);
  } else if (provider === "searxng") {
    const url = getSetting("searxng_url");
    if (!url) {
      throw new Error("SearXNG URL is not configured.");
    }
    const searchUrl = `${url.replace(/\/$/, "")}/search?q=${encodeURIComponent(
      query
    )}&format=json`;
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`SearXNG search failed: ${response.statusText}`);
    }
    const data: any = await response.json();
    const results: SearchResult[] = [];
    if (data.results) {
      for (const item of data.results) {
        results.push({
          title: item.title,
          url: item.url,
          snippet: item.content || "",
        });
      }
    }
    return results.slice(0, 5);
  } else {
    // DuckDuckGo fallback - fetch standard HTML search
    try {
      const response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        }
      );
      if (!response.ok) {
        throw new Error(`DuckDuckGo request failed: ${response.statusText}`);
      }
      const html = await response.text();

      // Quick regex parsing of DuckDuckGo Lite / HTML results
      // Typically results are structure in divs:
      // <div class="result results_links results_links_deep web-result ">
      //   <a class="result__snippet" ...>
      //   <a class="result__url" ...>
      // We will parse out result containers using regex.
      const results: SearchResult[] = [];
      const resultBlockRegex = /<div class="[^"]*web-result[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g;
      let match;
      let count = 0;

      while ((match = resultBlockRegex.exec(html)) !== null && count < 5) {
        const block = match[1];

        // Extract Title and URL
        const linkMatch = /<a class="result__url"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(
          block
        );
        // Extract Snippet
        const snippetMatch = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(
          block
        );

        if (linkMatch && snippetMatch) {
          let url = linkMatch[1];
          // Strip DuckDuckGo outgoing proxy redirection if present
          if (url.includes("uddg=")) {
            const matchUddg = /uddg=([^&]*)/.exec(url);
            if (matchUddg) {
              url = decodeURIComponent(matchUddg[1]);
            }
          }

          const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();
          const snippet = snippetMatch[1].replace(/<[^>]*>/g, "").trim();

          if (title && url) {
            results.push({
              title,
              url,
              snippet,
            });
            count++;
          }
        }
      }

      // If regex failed, let's try a simpler selector-based approach using regex
      if (results.length === 0) {
        const linkRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        // Basic fallback search if structural regex fails
        const fallbackMatch = html.match(/<a class="result__url"[\s\S]*?<\/a>/gi);
        if (fallbackMatch) {
          for (let i = 0; i < Math.min(fallbackMatch.length, 5); i++) {
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
      // Return empty results rather than throwing
      return [];
    }
  }
}
