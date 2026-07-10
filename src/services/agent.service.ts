/**
 * @module services/agent.service
 * @description AI 에이전트 서비스 모듈
 *
 * 사용자가 지시한 작업을 AI 에이전트가 자율적으로 수행합니다.
 * 에이전트는 LLM을 호출하여 사고(thought) → 도구 호출(call) → 완료(finish)의
 * 루프를 최대 AGENT_MAX_STEPS까지 반복합니다.
 *
 * 사용 가능한 도구: 파일 읽기/쓰기, 디렉토리 조회, 웹 검색,
 * 터미널 명령어 실행, MCP 도구 호출
 */

import { settingRepository, agentTaskRepository } from "../database";
import { listFiles, readWorkspaceFile, writeWorkspaceFile } from "./file.service";
import { searchWeb } from "./search.service";
import { callMcpTool, listAllMcpTools } from "./mcp.service";
import { getProvider } from "../providers";
import { validateCommand } from "../utils/security";
import { getWorkspaceDir } from "../utils/security";
import { AGENT_MAX_STEPS } from "../config/constants";
import type { ProviderName, ChatMessage } from "../types";

/** 에이전트의 행동 지침을 정의하는 시스템 프롬프트 */
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
- Do NOT loop indefinitely. Maximum ${AGENT_MAX_STEPS} steps.
`;

/**
 * 에이전트 태스크를 비동기로 실행합니다.
 *
 * LLM과의 반복 대화를 통해 도구를 호출하고,
 * 각 스텝의 진행 상황을 DB에 로그로 기록합니다.
 *
 * @param taskId - 태스크 UUID
 * @param description - 사용자가 입력한 작업 설명
 */
export async function runAgentTask(taskId: string, description: string): Promise<void> {
  let logs = `[Agent Task Started] ${new Date().toISOString()}\nTask: ${description}\n\n`;
  agentTaskRepository.create(taskId, description, "running", logs);

  const providerName = (settingRepository.get("active_provider") || "ollama") as ProviderName;
  const model = settingRepository.get("active_model") || "llama3";
  const provider = getProvider(providerName);
  const mcpTools = await listAllMcpTools();

  /* MCP 도구 설명을 시스템 프롬프트에 추가 */
  let mcpToolsDescription = "";
  for (const [serverName, tools] of Object.entries(mcpTools)) {
    for (const tool of tools) {
      mcpToolsDescription += `- MCP Tool "mcp__${serverName}__${tool.name}": ${tool.description || ""}. Input Schema: ${JSON.stringify(tool.inputSchema)}\n`;
    }
  }

  const systemPrompt = AGENT_SYSTEM_PROMPT + "\nConfigured MCP Tools:\n" + (mcpToolsDescription || "No MCP tools configured.\n");
  const conversationHistory: ChatMessage[] = [
    { role: "user", content: `Please perform this task: ${description}` },
  ];

  let step = 1;
  const updateLog = (newLog: string) => {
    logs += newLog + "\n";
    agentTaskRepository.update(taskId, "running", logs);
  };

  try {
    while (step <= AGENT_MAX_STEPS) {
      updateLog(`--- Step ${step} ---`);

      /* LLM 호출 (비스트리밍, 프로바이더 Strategy 패턴 활용) */
      const response = await provider.callChat(model, conversationHistory, systemPrompt);
      const responseText = response.content;
      updateLog(`[LLM Response]:\n${responseText}\n`);
      conversationHistory.push({ role: "assistant", content: responseText });

      /* 완료 태그 파싱 */
      const finishMatch = /<finish>([\s\S]*?)<\/finish>/i.exec(responseText);
      if (finishMatch) {
        updateLog(`[Agent Finished] ${finishMatch[1].trim()}`);
        agentTaskRepository.update(taskId, "success", logs);
        return;
      }

      /* 도구 호출 태그 파싱 */
      const callMatch = /<call name="([^"]*)">([\s\S]*?)<\/call>/i.exec(responseText);
      if (!callMatch) {
        updateLog(`[Error] No tool call or finish command found in LLM response. Aborting.`);
        agentTaskRepository.update(taskId, "failed", logs);
        return;
      }

      const toolName = callMatch[1].trim();
      let toolArgs: Record<string, string>;
      try {
        toolArgs = JSON.parse(callMatch[2].trim());
      } catch (_e) {
        updateLog(`[Error] Failed to parse tool arguments JSON: ${callMatch[2].trim()}`);
        conversationHistory.push({ role: "user", content: "Error: Failed to parse tool arguments JSON. Please try again with valid JSON arguments." });
        step++;
        continue;
      }

      updateLog(`[Executing Tool] ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      let result = "";

      try {
        result = await executeTool(toolName, toolArgs);
      } catch (err: unknown) {
        result = `Error executing tool: ${(err as Error).message}`;
      }

      updateLog(`[Tool Result]:\n${result}\n`);
      conversationHistory.push({ role: "user", content: `<response>${result}</response>` });
      step++;
    }

    updateLog(`[Error] Reached maximum step limit of ${AGENT_MAX_STEPS}.`);
    agentTaskRepository.update(taskId, "failed", logs);
  } catch (err: unknown) {
    updateLog(`[Fatal Error] ${(err as Error).message}`);
    agentTaskRepository.update(taskId, "failed", logs);
  }
}

/**
 * 도구 이름과 인자에 따라 적절한 도구를 실행합니다.
 * mcp__ 접두사를 가진 도구는 MCP 서버로 라우팅됩니다.
 */
async function executeTool(toolName: string, toolArgs: Record<string, string>): Promise<string> {
  switch (toolName) {
    case "list_files":
      return JSON.stringify(await listFiles(toolArgs.path || ""), null, 2);
    case "read_file":
      return await readWorkspaceFile(toolArgs.path);
    case "write_file":
      await writeWorkspaceFile(toolArgs.path, toolArgs.content);
      return `Successfully wrote to ${toolArgs.path}`;
    case "search_web":
      return JSON.stringify(await searchWeb(toolArgs.query), null, 2);
    case "run_command":
      return await executeLocalCommand(toolArgs.cmd);
    default:
      if (toolName.startsWith("mcp__")) {
        const parts = toolName.split("__");
        if (parts.length < 3) throw new Error(`Invalid MCP tool name format: ${toolName}`);
        const serverName = parts[1];
        const actualToolName = parts.slice(2).join("__");
        const mcpResult = await callMcpTool(serverName, actualToolName, toolArgs as unknown as Record<string, unknown>);
        return JSON.stringify(mcpResult, null, 2);
      }
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * 보안 검증 후 워크스페이스 내에서 셸 명령어를 실행합니다.
 * 위험한 명령어는 validateCommand()에 의해 사전 차단됩니다.
 */
async function executeLocalCommand(cmd: string): Promise<string> {
  validateCommand(cmd);

  const workspaceDir = getWorkspaceDir();
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
