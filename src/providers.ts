import { getSetting } from "./db";

export interface ChatMessage {
  role: string;
  content: string;
}

export async function streamChat(
  provider: string,
  model: string,
  messages: ChatMessage[],
  systemPrompt: string | null
): Promise<ReadableStream<string>> {
  // Prep messages, injecting system prompt if present
  const apiMessages = [...messages];
  if (systemPrompt) {
    // If there is a system message already, replace or prepend.
    // OpenAI/Groq/Cerebras/Ollama standard is to put system message at the beginning.
    const systemMessageIndex = apiMessages.findIndex((m) => m.role === "system");
    if (systemMessageIndex > -1) {
      apiMessages[systemMessageIndex].content = systemPrompt;
    } else {
      apiMessages.unshift({ role: "system", content: systemPrompt });
    }
  }

  let url = "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: any = {};

  if (provider === "ollama") {
    const ollamaUrl = getSetting("ollama_url") || "http://localhost:11434";
    const apiKey = getSetting("ollama_api_key");
    url = `${ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
    body = {
      model,
      messages: apiMessages,
      stream: true,
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  } else if (provider === "groq") {
    const apiKey = getSetting("groq_api_key");
    if (!apiKey) throw new Error("Groq API key not set.");
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: apiMessages,
      stream: true,
    };
  } else if (provider === "cerebras") {
    const apiKey = getSetting("cerebras_api_key");
    if (!apiKey) throw new Error("Cerebras API key not set.");
    url = "https://api.cerebras.ai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: apiMessages,
      stream: true,
    };
  } else if (provider === "cloudflare") {
    const accountId = getSetting("cloudflare_account_id");
    const apiToken = getSetting("cloudflare_api_token");
    if (!accountId || !apiToken) {
      throw new Error("Cloudflare account ID or API token not set.");
    }
    url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    headers["Authorization"] = `Bearer ${apiToken}`;
    body = {
      messages: apiMessages,
      stream: true,
    };
  } else if (provider === "gemini") {
    const apiKey = getSetting("gemini_api_key");
    if (!apiKey) throw new Error("Gemini API key not set.");
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    
    const contents = apiMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    
    body = { contents };
    
    const systemMsg = apiMessages.find((m) => m.role === "system")?.content;
    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg }],
      };
    }
    
    if (getSetting("gemini_search_grounding") === "true") {
      body.tools = [{ google_search: {} }];
    }
  } else if (provider === "openrouter") {
    const apiKey = getSetting("openrouter_api_key");
    if (!apiKey) throw new Error("OpenRouter API key not set.");
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "LiteAI";
    body = {
      model,
      messages: apiMessages,
      stream: true,
    };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          if (provider === "gemini") {
            let cleanBuffer = buffer.trim();
            if (cleanBuffer.startsWith("[")) {
              cleanBuffer = cleanBuffer.slice(1).trim();
            }
            if (cleanBuffer.startsWith(",")) {
              cleanBuffer = cleanBuffer.slice(1).trim();
            }

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
                    const parsed = JSON.parse(jsonStr);
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                      controller.enqueue(text);
                    }
                  } catch (e) {
                    // Ignore parse errors on incomplete JSON objects
                  }
                  buffer = cleanBuffer.slice(i + 1).trim();
                  if (buffer.startsWith(",")) {
                    buffer = buffer.slice(1).trim();
                  }
                  cleanBuffer = buffer;
                  i = -1; // reset loop index
                }
              }
            }
          } else {
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              if (provider === "cloudflare") {
                if (trimmed.startsWith("data:")) {
                  const dataStr = trimmed.slice(5).trim();
                  if (dataStr === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.response) {
                      controller.enqueue(parsed.response);
                    }
                  } catch (e) {}
                }
              } else {
                // OpenAI SSE format (Groq, Cerebras, Ollama, OpenRouter)
                if (trimmed.startsWith("data:")) {
                  const dataStr = trimmed.slice(5).trim();
                  if (dataStr === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(dataStr);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                      controller.enqueue(content);
                    }
                  } catch (e) {}
                }
              }
            }
          }
        }

        // Flush any remaining buffer (for non-gemini providers)
        if (provider !== "gemini" && buffer.trim()) {
          const trimmed = buffer.trim();
          if (provider === "cloudflare" && trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.response) controller.enqueue(parsed.response);
              } catch (e) {}
            }
          } else if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) controller.enqueue(content);
              } catch (e) {}
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
