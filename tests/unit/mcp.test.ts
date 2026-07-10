import { beforeAll, afterAll, describe, expect, it, mock } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-mcp-db.db");
process.env.DATABASE_PATH = dbFile;

import * as db from "../../src/database";
import * as mcp from "../../src/services/mcp.service";

describe("MCP Integration Unit Tests", () => {
  let originalSpawn: any;

  beforeAll(() => {
    originalSpawn = Bun.spawn;
    db.db.run("DELETE FROM settings;");
  });

  afterAll(() => {
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
    // Restore Bun.spawn
    (Bun as any).spawn = originalSpawn;
  });

  it("should retrieve empty mcp config initially", () => {
    const config = mcp.getMcpServersConfig();
    expect(config).toEqual({});
  });

  it("should save and retrieve mcp configurations", async () => {
    const sampleConfig = {
      weather: {
        command: "node",
        args: ["weather-server.js"],
        env: { API_KEY: "secret" }
      }
    };

    mcp.saveMcpServersConfig(sampleConfig);
    
    // Wait for async db save
    await new Promise(resolve => setTimeout(resolve, 100));

    const config = mcp.getMcpServersConfig();
    expect(config).toEqual(sampleConfig);
  });

  it("should handle client connection setup and tools listing with Mocked Process", async () => {
    // Mock Bun.spawn for MCP Server communication protocol
    const mockStdoutReader = {
      read: async () => {
        // Return JSON-RPC responses sequentially
        // 1st read: initialize response
        // 2nd read: listTools response
        const encoder = new TextEncoder();
        const initRes = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2024-11-05", capabilities: {} }
        }) + "\n";
        
        const toolsRes = JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "get_weather",
                description: "Get forecast",
                inputSchema: { type: "object", properties: { city: { type: "string" } } }
              }
            ]
          }
        }) + "\n";

        return {
          done: false,
          value: encoder.encode(initRes + toolsRes)
        };
      },
      releaseLock: () => {}
    };

    const mockStdinWriter = {
      write: () => {},
      flush: () => {}
    };

    (Bun as any).spawn = () => {
      return {
        stdout: {
          getReader: () => mockStdoutReader
        },
        stdin: {
          writer: () => mockStdinWriter
        },
        kill: () => {}
      };
    };

    // List tools
    const allTools = await mcp.listAllMcpTools();
    expect(allTools.weather).toBeDefined();
    expect(allTools.weather.length).toBe(1);
    expect(allTools.weather[0].name).toBe("get_weather");

    await mcp.stopAllMcpServers();
  });
});
