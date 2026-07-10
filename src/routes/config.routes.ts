/**
 * @module routes/config.routes
 * @description 시스템 설정 및 MCP 설정 API 라우트
 */

import { Hono } from "hono";
import { settingRepository } from "../database";
import { getMcpServersConfig, saveMcpServersConfig } from "../services/mcp.service";
import { handleRouteError } from "../utils/error-handler";

export const configRoutes = new Hono();

/** GET / - 전체 설정 조회 */
configRoutes.get("/", (c) => {
  try { return c.json(settingRepository.listAll()); }
  catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});

/** POST / - 설정 일괄 저장 */
configRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json() as Record<string, string>;
    for (const [key, val] of Object.entries(body)) settingRepository.set(key, String(val));
    return c.json({ success: true });
  } catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});

/** GET /mcp - MCP 서버 설정 조회 */
configRoutes.get("/mcp", (c) => c.json(getMcpServersConfig()));

/** POST /mcp - MCP 서버 설정 저장 */
configRoutes.post("/mcp", async (c) => {
  try {
    saveMcpServersConfig(await c.req.json());
    return c.json({ success: true });
  } catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});
