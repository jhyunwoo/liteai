import { beforeAll, afterAll, describe, expect, it, spyOn } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-providers-db.db");
process.env.DATABASE_PATH = dbFile;

import * as db from "../../src/db";
import { streamChat } from "../../src/providers";

describe("LLM Providers Unit Tests", () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = global.fetch;
    db.setSetting("ollama_url", "http://localhost:11434");
    db.setSetting("gemini_api_key", "mock-gemini-key");
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  it("should stream responses correctly from Ollama provider (SSE)", async () => {
    const mockResponseText = 
      "data: " + JSON.stringify({ choices: [{ delta: { content: "Hello " } }] }) + "\n" +
      "data: " + JSON.stringify({ choices: [{ delta: { content: "world!" } }] }) + "\n" +
      "data: [DONE]\n";

    global.fetch = async (url: any, options: any) => {
      expect(url.toString()).toContain("http://localhost:11434/v1/chat/completions");
      expect(options.method).toBe("POST");
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(mockResponseText));
          controller.close();
        }
      });
      return new Response(stream);
    };

    const stream = await streamChat("ollama", "llama3", [{ role: "user", content: "hi" }], null);
    const reader = stream.getReader();
    
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += value;
    }
    expect(result).toBe("Hello world!");
  });

  it("should stream responses correctly from Gemini provider (JSON Array Stream)", async () => {
    const mockResponseChunk = JSON.stringify({
      candidates: [{
        content: { parts: [{ text: "Gemma is lightweight" }] }
      }]
    });

    global.fetch = async (url: any, options: any) => {
      expect(url.toString()).toContain("generativelanguage.googleapis.com");
      
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // JSON Stream usually sent as comma-separated array items
          controller.enqueue(encoder.encode(`[${mockResponseChunk}]`));
          controller.close();
        }
      });
      return new Response(stream);
    };

    const stream = await streamChat("gemini", "gemini-1.5-flash", [{ role: "user", content: "describe gemma" }], null);
    const reader = stream.getReader();
    
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += value;
    }
    expect(result).toBe("Gemma is lightweight");
  });
});
