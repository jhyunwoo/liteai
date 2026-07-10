/**
 * @module routes/mcp.routes
 * @description MCP 도구 API 라우트
 */
import { Hono } from "hono";
import { listAllMcpTools, callMcpTool } from "../services/mcp.service";
import { handleRouteError } from "../utils/error-handler";

export const mcpRoutes = new Hono();

/** GET /tools - 모든 MCP 서버의 도구 목록 조회 */
mcpRoutes.get("/tools", async (c) => {
  try { return c.json(await listAllMcpTools()); }
  catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});

/** POST /call - MCP 도구 호출 */
mcpRoutes.post("/call", async (c) => {
  try {
    const { serverName, toolName, args } = await c.req.json();
    return c.json(await callMcpTool(serverName, toolName, args));
  } catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});
