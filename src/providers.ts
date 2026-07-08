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
    // We can use the OpenAI compatible endpoint of Ollama
    url = `${ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
    body = {
      model,
      messages: apiMessages,
      stream: true,
    };
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
          const lines = buffer.split("\n");
          // Save the last partial line back to the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (provider === "cloudflare") {
              // Cloudflare streams send data: {"response": "chunk"} or data: [DONE]
              if (trimmed.startsWith("data:")) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.response) {
                    controller.enqueue(parsed.response);
                  }
                } catch (e) {
                  // Ignore parse errors on individual stream lines
                }
              }
            } else {
              // OpenAI SSE format (Groq, Cerebras, Ollama v1/chat/completions)
              // data: {"choices": [{"delta": {"content": "..."}}]}
              if (trimmed.startsWith("data:")) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(content);
                  }
                } catch (e) {
                  // Ignore JSON parse errors for stream metadata lines
                }
              }
            }
          }
        }

        // Flush any remaining buffer
        if (buffer.trim()) {
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
