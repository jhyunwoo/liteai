import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { streamText } from "hono/streaming";
import {
  listConversations,
  getConversation,
  createConversation,
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
