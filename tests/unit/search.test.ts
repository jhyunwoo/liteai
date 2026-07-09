import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-search-db.db");
process.env.DATABASE_PATH = dbFile;

import * as db from "../../src/db";
import { searchWeb } from "../../src/search";

describe("Web Search Providers Unit Tests", () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  it("should parse Brave Search JSON response correctly", async () => {
    db.setSetting("search_provider", "brave");
    db.setSetting("brave_search_key", "mock-brave-key");

    global.fetch = async (url: any) => {
      expect(url.toString()).toContain("api.search.brave.com");
      return new Response(JSON.stringify({
        web: {
          results: [
            { title: "Brave Search", url: "https://brave.com", description: "Brave Search engine" }
          ]
        }
      }));
    };

    const results = await searchWeb("brave");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Brave Search");
    expect(results[0].url).toBe("https://brave.com");
    expect(results[0].snippet).toBe("Brave Search engine");
  });

  it("should parse Serper.dev JSON response correctly", async () => {
    db.setSetting("search_provider", "serper");
    db.setSetting("serper_api_key", "mock-serper-key");

    global.fetch = async (url: any, options: any) => {
      expect(url.toString()).toContain("google.serper.dev/search");
      expect(options.method).toBe("POST");
      return new Response(JSON.stringify({
        organic: [
          { title: "Google Serper", link: "https://google.serper.dev", snippet: "Google search API" }
        ]
      }));
    };

    const results = await searchWeb("serper");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Google Serper");
    expect(results[0].url).toBe("https://google.serper.dev");
    expect(results[0].snippet).toBe("Google search API");
  });

  it("should crawl and parse DuckDuckGo HTML fallback response", async () => {
    db.setSetting("search_provider", "duckduckgo");

    const mockHtml = `
      <html>
        <body>
          <div class="result results_links results_links_deep web-result ">
            <a class="result__url" href="https://duckduckgo.com/lite?uddg=https%3A%2F%2Fduckduckgo.com%2Fabout">DuckDuckGo About</a>
            <a class="result__snippet">Learn about DuckDuckGo search engine privacy.</a>
          </div></div>
        </body>
      </html>
    `;

    global.fetch = async (url: any) => {
      expect(url.toString()).toContain("html.duckduckgo.com");
      return new Response(mockHtml);
    };

    const results = await searchWeb("privacy");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("DuckDuckGo About");
    expect(results[0].url).toBe("https://duckduckgo.com/about");
    expect(results[0].snippet).toBe("Learn about DuckDuckGo search engine privacy.");
  });
});
