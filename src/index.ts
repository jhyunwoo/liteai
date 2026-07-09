import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { streamText } from "hono/streaming";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversationTitle,
  updateConversationSettings,
  deleteConversation,
  getMessages,
  addMessage,
  listSettings,
  setSetting,
  listAgentTasks,
  getAgentTask,
} from "./db";
import { streamChat } from "./providers";
import {
  listFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  createWorkspaceDirectory,
} from "./files";
import { listAllMcpTools, callMcpTool, saveMcpServersConfig, getMcpServersConfig } from "./mcp";
import { runAgentTask } from "./agent";
import { searchWeb } from "./search";

const app = new Hono();

// Enable Gzip/Deflate compression for all responses
app.use("*", compress());

// Serve static assets from public/ directory
app.use("/*", serveStatic({ root: "./public" }));

// 1. Conversations API
app.get("/api/conversations", (c) => {
  try {
    return c.json(listConversations());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/conversations/:id", (c) => {
  const id = c.req.param("id");
  try {
    const conv = getConversation(id);
    if (!conv) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const messages = getMessages(id);
    return c.json({ ...conv, messages });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/conversations", async (c) => {
  try {
    const { title, model, provider, systemPrompt } = await c.req.json();
    const id = crypto.randomUUID();
    createConversation(id, title || "New Chat", model, provider, systemPrompt || null);
    const newConv = getConversation(id);
    return c.json(newConv, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete("/api/conversations/:id", (c) => {
  const id = c.req.param("id");
  try {
    deleteConversation(id);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.patch("/api/conversations/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { title, provider, model } = await c.req.json();
    const conv = getConversation(id);
    if (!conv) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    if (title !== undefined) {
      updateConversationTitle(id, title);
    }
    if (provider !== undefined && model !== undefined) {
      updateConversationSettings(id, provider, model);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 2. Chat Streaming API
app.post("/api/chat", async (c) => {
  try {
    const { conversationId, message, webSearch } = await c.req.json();
    const conv = getConversation(conversationId);
    if (!conv) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    // Save user message to database
    const userMessageId = crypto.randomUUID();
    addMessage(userMessageId, conversationId, "user", message);

    // Get messages history
    const history = getMessages(conversationId).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // If web search toggle is enabled, perform grounding and enrich the final history entry
    if (webSearch) {
      try {
        const searchResults = await searchWeb(message);
        if (searchResults && searchResults.length > 0) {
          const searchContext = searchResults
            .map((r, i) => `[검색결과 ${i + 1}] 제목: ${r.title}\n출처: ${r.url}\n요약: ${r.snippet}`)
            .join("\n\n");
          
          if (history.length > 0 && history[history.length - 1].role === "user") {
            history[history.length - 1].content = `[실시간 웹 검색 결과]\n${searchContext}\n\n[사용자 질문]\n${message}`;
          }
        }
      } catch (searchErr) {
        console.error("Web search grounding failed:", searchErr);
      }
    }

    return streamText(c, async (stream) => {
      let assistantMessage = "";
      try {
        const chatStream = await streamChat(
          conv.provider,
          conv.model,
          history,
          conv.system_prompt
        );

        const reader = chatStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantMessage += value;
          await stream.write(value);
        }
      } catch (err: any) {
        console.error("Streaming error:", err);
        const errorMsg = `\n[Error during generation: ${err.message}]`;
        assistantMessage += errorMsg;
        await stream.write(errorMsg);
      } finally {
        if (assistantMessage.trim()) {
          const assistantMessageId = crypto.randomUUID();
          addMessage(assistantMessageId, conversationId, "assistant", assistantMessage);
        }
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 3. File System API
app.get("/api/files", async (c) => {
  const subDir = c.req.query("path") || "";
  try {
    const files = await listFiles(subDir);
    return c.json(files);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/files", async (c) => {
  try {
    const { path, content } = await c.req.json();
    if (!path) {
      return c.json({ error: "Path is required" }, 400);
    }
    await writeWorkspaceFile(path, content || "");
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/files/mkdir", async (c) => {
  try {
    const { path } = await c.req.json();
    if (!path) {
      return c.json({ error: "Path is required" }, 400);
    }
    await createWorkspaceDirectory(path);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete("/api/files", async (c) => {
  const path = c.req.query("path");
  if (!path) {
    return c.json({ error: "Path is required" }, 400);
  }
  try {
    await deleteWorkspaceFile(path);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/files/read", async (c) => {
  const path = c.req.query("path");
  if (!path) {
    return c.json({ error: "Path is required" }, 400);
  }
  try {
    const content = await readWorkspaceFile(path);
    return c.text(content);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. Configuration/Settings API
app.get("/api/config", (c) => {
  try {
    return c.json(listSettings());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/config", async (c) => {
  try {
    const body = await c.req.json();
    for (const [key, val] of Object.entries(body)) {
      setSetting(key, String(val));
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/models", async (c) => {
  const provider = c.req.query("provider");
  if (!provider) {
    return c.json({ error: "Provider is required" }, 400);
  }

  const fallbacks: Record<string, string[]> = {
    ollama: ["llama3", "llama3.1", "llama3.2", "gemma2", "mistral", "phi3", "qwen2.5"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"],
    openrouter: [
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "anthropic/claude-3.5-sonnet",
      "deepseek/deepseek-chat"
    ],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
    cerebras: ["llama3.1-8b", "llama3.1-70b"],
    cloudflare: [
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/meta/llama-3-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.1",
      "@cf/qwen/qwen1.5-7b-chat"
    ]
  };

  try {
    if (provider === "ollama") {
      const url = getSetting("ollama_url") || "http://localhost:11434";
      const key = getSetting("ollama_api_key");
      const headers: Record<string, string> = {};
      if (key) headers["Authorization"] = `Bearer ${key}`;
      
      const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { headers });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.models)) {
          return c.json(data.models.map((m: any) => m.name));
        }
      }
    } else if (provider === "gemini") {
      const key = getSetting("gemini_api_key");
      if (key) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.models)) {
            const models = data.models
              .map((m: any) => m.name.replace("models/", ""))
              .filter((name: string) => name.startsWith("gemini-"));
            if (models.length > 0) return c.json(models);
          }
        }
      }
    } else if (provider === "openrouter") {
      const key = getSetting("openrouter_api_key");
      const headers: Record<string, string> = {};
      if (key) headers["Authorization"] = `Bearer ${key}`;
      
      const res = await fetch("https://openrouter.ai/api/v1/models", { headers });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data.data)) {
          return c.json(data.data.map((m: any) => m.id));
        }
      }
    } else if (provider === "groq") {
      const key = getSetting("groq_api_key");
      if (key) {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${key}` }
        });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.data)) {
            return c.json(data.data.map((m: any) => m.id));
          }
        }
      }
    } else if (provider === "cerebras") {
      const key = getSetting("cerebras_api_key");
      if (key) {
        const res = await fetch("https://api.cerebras.ai/v1/models", {
          headers: { "Authorization": `Bearer ${key}` }
        });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.data)) {
            return c.json(data.data.map((m: any) => m.id));
          }
        }
      }
    } else if (provider === "cloudflare") {
      const accountId = getSetting("cloudflare_account_id");
      const token = getSetting("cloudflare_api_token");
      if (accountId && token) {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.result)) {
            return c.json(data.result.map((m: any) => m.name));
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`Failed to fetch dynamic models for ${provider}:`, err.message);
  }

  return c.json(fallbacks[provider] || []);
});

// MCP Servers configurations
app.get("/api/config/mcp", (c) => {
  return c.json(getMcpServersConfig());
});

app.post("/api/config/mcp", async (c) => {
  try {
    const body = await c.req.json();
    saveMcpServersConfig(body);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 5. MCP Tools API
app.get("/api/mcp/tools", async (c) => {
  try {
    const tools = await listAllMcpTools();
    return c.json(tools);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/mcp/call", async (c) => {
  try {
    const { serverName, toolName, args } = await c.req.json();
    const res = await callMcpTool(serverName, toolName, args);
    return c.json(res);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 6. Agent API
app.get("/api/agent/tasks", (c) => {
  try {
    return c.json(listAgentTasks());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/agent/tasks/:id", (c) => {
  const id = c.req.param("id");
  try {
    const task = getAgentTask(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(task);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/agent/tasks", async (c) => {
  try {
    const { description } = await c.req.json();
    if (!description) {
      return c.json({ error: "Description is required" }, 400);
    }
    const id = crypto.randomUUID();
    
    // Start agent task in background
    runAgentTask(id, description).catch((e) => {
      console.error(`Agent task ${id} failed:`, e);
    });

    return c.json({ taskId: id }, 202);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Export default object for Bun to run the server on port 3000
export default {
  port: 3000,
  fetch: app.fetch,
};
