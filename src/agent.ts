import { getSetting, createAgentTask, updateAgentTask, getAgentTask } from "./db";
import { readWorkspaceFile, writeWorkspaceFile, listFiles } from "./files";
import { searchWeb } from "./search";
import { callMcpTool, listAllMcpTools } from "./mcp";
import { join } from "path";

// Define the system prompt for the Agent
const AGENT_SYSTEM_PROMPT = `You are an AI Agent with access to tools to complete tasks in a local workspace.
You can read/write files, list directory contents, search the web, run terminal commands, and call custom MCP tools.
You MUST think step-by-step and write your thoughts.

For every step, you must choose to:
1. Call a tool.
2. Finish the task if it is complete.

Your response MUST follow this format:
<thought>Your explanation of what you are doing and what tool you need next.</thought>
<call name="tool_name">{"arg1": "value"}</call>

Once you are done and the task is fully completed, output:
<thought>Explanation of final results.</thought>
<finish>Final summary of the completed task.</finish>

Available tools:
1. "list_files": List files in a subdirectory. Args: {"path": "relative/path"}
2. "read_file": Read content of a file. Args: {"path": "relative/path/to/file"}
3. "write_file": Write content to a file. Args: {"path": "relative/path/to/file", "content": "file content"}
4. "search_web": Search the web. Args: {"query": "search query"}
5. "run_command": Run a terminal command inside the workspace directory. Args: {"cmd": "command to execute"}

You also have access to configured MCP tools (if any). You can call them using:
<call name="mcp__server_name__tool_name">{"arg1": "val1"}</call>

Rules:
- Strictly run commands that are safe.
- Do NOT loop indefinitely. Maximum 10 steps.
`;

export async function runAgentTask(taskId: string, description: string): Promise<void> {
  let logs = `[Agent Task Started] ${new Date().toISOString()}\nTask: ${description}\n\n`;
  createAgentTask(taskId, description, "running", logs);

  const provider = getSetting("active_provider") || "ollama";
  const model = getSetting("active_model") || "llama3";
  const mcpTools = await listAllMcpTools();

  // Create active tools prompt string
  let mcpToolsDescription = "";
  for (const [serverName, tools] of Object.entries(mcpTools)) {
    for (const tool of tools) {
      mcpToolsDescription += `- MCP Tool "mcp__${serverName}__${tool.name}": ${tool.description || ""}. Input Schema: ${JSON.stringify(tool.inputSchema)}\n`;
    }
  }

  const systemPrompt = AGENT_SYSTEM_PROMPT + "\nConfigured MCP Tools:\n" + (mcpToolsDescription || "No MCP tools configured.\n");

  const conversationHistory: { role: string; content: string }[] = [];
  conversationHistory.push({ role: "user", content: `Please perform this task: ${description}` });

  let step = 1;
  const maxSteps = 10;

  const updateLog = (newLog: string) => {
    logs += newLog + "\n";
    updateAgentTask(taskId, "running", logs);
  };

  try {
    while (step <= maxSteps) {
      updateLog(`--- Step ${step} ---`);
      
      // Call LLM
      const responseText = await callLLM(provider, model, conversationHistory, systemPrompt);
      updateLog(`[LLM Response]:\n${responseText}\n`);
      
      conversationHistory.push({ role: "assistant", content: responseText });

      // Parse Thought
      const thoughtMatch = /<thought>([\s\S]*?)<\/thought>/i.exec(responseText);
      const thought = thoughtMatch ? thoughtMatch[1].trim() : "Thinking...";

      // Parse Finish
      const finishMatch = /<finish>([\s\S]*?)<\/finish>/i.exec(responseText);
      if (finishMatch) {
        updateLog(`[Agent Finished] ${finishMatch[1].trim()}`);
        updateAgentTask(taskId, "success", logs);
        return;
      }

      // Parse Call
      const callMatch = /<call name="([^"]*)">([\s\S]*?)<\/call>/i.exec(responseText);
      if (!callMatch) {
        updateLog(`[Error] No tool call or finish command found in LLM response. Aborting.`);
        updateAgentTask(taskId, "failed", logs);
        return;
      }

      const toolName = callMatch[1].trim();
      const toolArgsRaw = callMatch[2].trim();
      let toolArgs: any = {};
      try {
        toolArgs = JSON.parse(toolArgsRaw);
      } catch (e) {
        updateLog(`[Error] Failed to parse tool arguments JSON: ${toolArgsRaw}`);
        conversationHistory.push({ role: "user", content: "Error: Failed to parse tool arguments JSON. Please try again with valid JSON arguments." });
        step++;
        continue;
      }

      updateLog(`[Executing Tool] ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      let result = "";

      try {
        if (toolName === "list_files") {
          const files = await listFiles(toolArgs.path || "");
          result = JSON.stringify(files, null, 2);
        } else if (toolName === "read_file") {
          result = await readWorkspaceFile(toolArgs.path);
        } else if (toolName === "write_file") {
          await writeWorkspaceFile(toolArgs.path, toolArgs.content);
          result = `Successfully wrote to ${toolArgs.path}`;
        } else if (toolName === "search_web") {
          const searchResults = await searchWeb(toolArgs.query);
          result = JSON.stringify(searchResults, null, 2);
        } else if (toolName === "run_command") {
          result = await executeLocalCommand(toolArgs.cmd);
        } else if (toolName.startsWith("mcp__")) {
          // Parse MCP call
          const parts = toolName.split("__");
          if (parts.length < 3) {
            throw new Error(`Invalid MCP tool name format: ${toolName}`);
          }
          const serverName = parts[1];
          const actualToolName = parts.slice(2).join("__");
          const mcpResult = await callMcpTool(serverName, actualToolName, toolArgs);
          result = JSON.stringify(mcpResult, null, 2);
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }
      } catch (err: any) {
        result = `Error executing tool: ${err.message}`;
      }

      updateLog(`[Tool Result]:\n${result}\n`);
      conversationHistory.push({ role: "user", content: `<response>${result}</response>` });
      step++;
    }

    updateLog(`[Error] Reached maximum step limit of ${maxSteps}.`);
    updateAgentTask(taskId, "failed", logs);
  } catch (err: any) {
    updateLog(`[Fatal Error] ${err.message}`);
    updateAgentTask(taskId, "failed", logs);
  }
}

async function executeLocalCommand(cmd: string): Promise<string> {
  const workspaceDir = join(process.cwd(), "liteai_workspace");
  const p = Bun.spawn({
    cmd: ["bash", "-c", cmd],
    cwd: workspaceDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const stdout = await new Response(p.stdout).text();
  const stderr = await new Response(p.stderr).text();
  
  return `Exit Code: ${await p.exited}\nStdout:\n${stdout}\nStderr:\n${stderr}`;
}

async function callLLM(
  provider: string,
  model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const apiMessages = [...messages];
  apiMessages.unshift({ role: "system", content: systemPrompt });

  let url = "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: any = {};

  if (provider === "ollama") {
    const ollamaUrl = getSetting("ollama_url") || "http://localhost:11434";
    const apiKey = getSetting("ollama_api_key");
    url = `${ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
    body = { model, messages: apiMessages, stream: false };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  } else if (provider === "groq") {
    const apiKey = getSetting("groq_api_key");
    if (!apiKey) throw new Error("Groq API key not set.");
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = { model, messages: apiMessages, stream: false };
  } else if (provider === "cerebras") {
    const apiKey = getSetting("cerebras_api_key");
    if (!apiKey) throw new Error("Cerebras API key not set.");
    url = "https://api.cerebras.ai/v1/chat/completions";
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = { model, messages: apiMessages, stream: false };
  } else if (provider === "cloudflare") {
    const accountId = getSetting("cloudflare_account_id");
    const apiToken = getSetting("cloudflare_api_token");
    if (!accountId || !apiToken) throw new Error("Cloudflare settings incomplete.");
    url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    headers["Authorization"] = `Bearer ${apiToken}`;
    body = { messages: apiMessages, stream: false };
  } else if (provider === "gemini") {
    const apiKey = getSetting("gemini_api_key");
    if (!apiKey) throw new Error("Gemini API key not set.");
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
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
      stream: false,
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
    const errText = await response.text();
    throw new Error(`LLM call failed (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  if (provider === "cloudflare") {
    return data.result?.response || "";
  } else if (provider === "gemini") {
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (Array.isArray(chunks) && chunks.length > 0) {
      const geminiSources = new Map<string, string>();
      for (const chunk of chunks) {
        const uri = chunk?.web?.uri;
        const title = chunk?.web?.title || uri;
        if (uri) {
          geminiSources.set(uri, title);
        }
      }
      if (geminiSources.size > 0) {
        text += "\n\n**🌐 웹 검색 출처:**\n";
        for (const [uri, title] of geminiSources.entries()) {
          text += `- [${title}](${uri})\n`;
        }
      }
    }
    return text;
  } else {
    return data.choices?.[0]?.message?.content || "";
  }
}
