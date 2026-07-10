/**
 * @module services/mcp.service
 * @description MCP (Model Context Protocol) 서비스 모듈
 *
 * stdio 기반 MCP 서버 프로세스와의 JSON-RPC 통신을 관리합니다.
 * MCP 서버의 생명주기(시작, 도구 조회, 도구 호출, 종료)를 제어하고,
 * 여러 MCP 서버를 동시에 관리할 수 있는 연결 풀을 유지합니다.
 */

import { settingRepository } from "../database";
import type { McpServerConfig, McpTool } from "../types";

/**
 * MCP 서버와의 JSON-RPC 연결을 관리하는 내부 클래스
 *
 * 하나의 MCP 서버 프로세스에 대한 stdin/stdout 통신,
 * 요청/응답 매칭, 초기화 핸드셰이크를 처리합니다.
 */
class McpConnection {
  private process: ReturnType<typeof Bun.spawn> | null = null;
  private readerPromise: Promise<void> | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (val: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private initialized = false;

  constructor(
    public name: string,
    private config: McpServerConfig
  ) {}

  /** MCP 서버 프로세스를 시작하고 초기화 핸드셰이크를 수행합니다. */
  async start(): Promise<void> {
    if (this.process) return;

    const env = { ...process.env, ...(this.config.env || {}) };
    this.process = Bun.spawn({
      cmd: [this.config.command, ...this.config.args],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env,
    });

    this.readerPromise = this.readLoop();
    await this.initialize();
  }

  /** MCP 프로토콜 초기화: initialize 요청 후 initialized 알림 전송 */
  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "liteai-client", version: "1.0.0" },
    });
    this.sendNotification("notifications/initialized", {});
    this.initialized = true;
  }

  /** stdout에서 JSON-RPC 응답을 지속적으로 읽는 비동기 루프 */
  private async readLoop(): Promise<void> {
    if (!this.process) return;
    const reader = (this.process.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed) as { id?: number; error?: { message?: string }; result?: unknown };
            if (msg.id !== undefined) {
              const pending = this.pendingRequests.get(msg.id);
              if (pending) {
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                  pending.reject(new Error(msg.error.message || "MCP RPC Error"));
                } else {
                  pending.resolve(msg.result);
                }
              }
            }
          } catch (e) {
            console.error(`[MCP ${this.name}] JSON parse error:`, e, "Line:", trimmed);
          }
        }
      }
    } catch (err) {
      console.error(`[MCP ${this.name}] Read loop crashed:`, err);
    } finally {
      reader.releaseLock();
    }
  }

  /** JSON-RPC 요청을 전송하고 응답을 Promise로 반환합니다. */
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      const writer = (this.process!.stdin as { writer(): { write(data: string): void; flush(): void } }).writer();
      writer.write(payload + "\n");
      writer.flush();
    });
  }

  /** JSON-RPC 알림을 전송합니다 (응답 불필요). */
  private sendNotification(method: string, params: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    const writer = (this.process!.stdin as { writer(): { write(data: string): void; flush(): void } }).writer();
    writer.write(payload + "\n");
    writer.flush();
  }

  /** MCP 서버가 제공하는 도구 목록을 조회합니다. */
  async listTools(): Promise<McpTool[]> {
    await this.start();
    const result = await this.sendRequest("tools/list", {}) as { tools?: McpTool[] };
    return result.tools || [];
  }

  /** MCP 도구를 호출합니다. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.start();
    return await this.sendRequest("tools/call", { name, arguments: args });
  }

  /** MCP 서버 프로세스를 종료합니다. */
  async stop(): Promise<void> {
    if (!this.process) return;
    try { this.process.kill(); } catch (_e) { /* 무시 */ }
    this.process = null;
    this.initialized = false;
    this.pendingRequests.clear();
  }
}

// ============================================================================
// 연결 풀 관리
// ============================================================================

/** 활성 MCP 서버 연결 캐시 */
const activeConnections = new Map<string, McpConnection>();

/** 설정 DB에서 MCP 서버 설정을 불러옵니다. */
export function getMcpServersConfig(): Record<string, McpServerConfig> {
  const raw = settingRepository.get("mcp_servers");
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, McpServerConfig>; }
  catch (_e) { return {}; }
}

/** MCP 서버 설정을 저장하고, 제거된 서버의 연결을 종료합니다. */
export function saveMcpServersConfig(config: Record<string, McpServerConfig>): void {
  settingRepository.set("mcp_servers", JSON.stringify(config, null, 2));
  for (const [name, conn] of activeConnections.entries()) {
    if (!config[name]) {
      conn.stop();
      activeConnections.delete(name);
    }
  }
}

/** 이름으로 MCP 연결을 가져오거나 새로 생성합니다. */
function getConnection(name: string): McpConnection {
  const configs = getMcpServersConfig();
  const config = configs[name];
  if (!config) throw new Error(`MCP Server '${name}' is not configured.`);

  let conn = activeConnections.get(name);
  if (!conn) {
    conn = new McpConnection(name, config);
    activeConnections.set(name, conn);
  }
  return conn;
}

/** 모든 MCP 서버의 도구 목록을 조회합니다. */
export async function listAllMcpTools(): Promise<Record<string, McpTool[]>> {
  const configs = getMcpServersConfig();
  const results: Record<string, McpTool[]> = {};
  for (const name of Object.keys(configs)) {
    try {
      results[name] = await getConnection(name).listTools();
    } catch (err: unknown) {
      console.error(`Failed to list tools for MCP server '${name}':`, (err as Error).message);
      results[name] = [];
    }
  }
  return results;
}

/** 특정 MCP 서버의 도구를 호출합니다. */
export async function callMcpTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  return await getConnection(serverName).callTool(toolName, args);
}

/** 모든 활성 MCP 서버 연결을 종료합니다. */
export async function stopAllMcpServers(): Promise<void> {
  for (const conn of activeConnections.values()) await conn.stop();
  activeConnections.clear();
}

/* 애플리케이션 종료 시 모든 MCP 프로세스 정리 */
process.on("exit", () => {
  for (const conn of activeConnections.values()) {
    try { conn.stop(); } catch (_e) { /* 무시 */ }
  }
});
