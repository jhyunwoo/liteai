import { getSetting } from "./db";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

class McpConnection {
  private process: any = null;
  private readerPromise: Promise<void> | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private initialized = false;

  constructor(public name: string, private config: McpServerConfig) {}

  async start() {
    if (this.process) return;

    const env = { ...process.env, ...(this.config.env || {}) };
    
    this.process = Bun.spawn({
      cmd: [this.config.command, ...this.config.args],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit", // forward errors to host console for easier debugging
      env,
    });

    this.readerPromise = this.readLoop();
    await this.initialize();
  }

  private async initialize() {
    // 1. Send 'initialize' request
    const initRes = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "liteai-client",
        version: "1.0.0",
      },
    });

    // 2. Send 'notifications/initialized'
    this.sendNotification("notifications/initialized", {});
    this.initialized = true;
  }

  private async readLoop() {
    const reader = this.process.stdout.getReader();
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
            const msg = JSON.parse(trimmed);
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

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRequests.set(id, { resolve, reject });
      
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      const writer = this.process.stdin.writer();
      writer.write(payload + "\n");
      writer.flush();
    });
  }

  private sendNotification(method: string, params: any) {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });
    const writer = this.process.stdin.writer();
    writer.write(payload + "\n");
    writer.flush();
  }

  async listTools(): Promise<McpTool[]> {
    await this.start();
    const result = await this.sendRequest("tools/list", {});
    return result.tools || [];
  }

  async callTool(name: string, args: any): Promise<any> {
    await this.start();
    return await this.sendRequest("tools/call", {
      name,
      arguments: args,
    });
  }

  async stop() {
    if (!this.process) return;
    try {
      this.process.kill();
    } catch (e) {}
    this.process = null;
    this.initialized = false;
    this.pendingRequests.clear();
  }
}

// Global registry of running MCP servers
const activeConnections = new Map<string, McpConnection>();

export function getMcpServersConfig(): Record<string, McpServerConfig> {
  const raw = getSetting("mcp_servers");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

export function saveMcpServersConfig(config: Record<string, McpServerConfig>) {
  // Save to DB settings
  const raw = JSON.stringify(config, null, 2);
  import("./db").then(({ setSetting }) => {
    setSetting("mcp_servers", raw);
  });
  
  // Stop servers that were removed or changed
  for (const [name, conn] of activeConnections.entries()) {
    if (!config[name]) {
      conn.stop();
      activeConnections.delete(name);
    }
  }
}

function getConnection(name: string): McpConnection {
  const configs = getMcpServersConfig();
  const config = configs[name];
  if (!config) {
    throw new Error(`MCP Server '${name}' is not configured.`);
  }

  let conn = activeConnections.get(name);
  if (!conn) {
    conn = new McpConnection(name, config);
    activeConnections.set(name, conn);
  }
  return conn;
}

export async function listAllMcpTools(): Promise<Record<string, McpTool[]>> {
  const configs = getMcpServersConfig();
  const results: Record<string, McpTool[]> = {};

  for (const name of Object.keys(configs)) {
    try {
      const conn = getConnection(name);
      results[name] = await conn.listTools();
    } catch (err: any) {
      console.error(`Failed to list tools for MCP server '${name}':`, err.message);
      results[name] = [];
    }
  }
  return results;
}

export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: any
): Promise<any> {
  const conn = getConnection(serverName);
  return await conn.callTool(toolName, args);
}

export async function stopAllMcpServers(): Promise<void> {
  for (const conn of activeConnections.values()) {
    await conn.stop();
  }
  activeConnections.clear();
}

// Clean up processes on application shutdown
process.on("exit", () => {
  for (const conn of activeConnections.values()) {
    try {
      conn.stop();
    } catch (e) {}
  }
});
