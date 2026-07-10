/**
 * @module routes/agent.routes
 * @description 에이전트 태스크 API 라우트
 */
import { Hono } from "hono";
import { agentTaskRepository } from "../database";
import { runAgentTask } from "../services/agent.service";
import { handleRouteError } from "../utils/error-handler";

export const agentRoutes = new Hono();

/** GET /tasks - 에이전트 태스크 목록 조회 */
agentRoutes.get("/tasks", (c) => {
  try { return c.json(agentTaskRepository.list()); }
  catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});

/** GET /tasks/:id - 특정 태스크 상세 조회 */
agentRoutes.get("/tasks/:id", (c) => {
  try {
    const task = agentTaskRepository.getById(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  } catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});

/** POST /tasks - 에이전트 태스크 생성 및 비동기 실행 */
agentRoutes.post("/tasks", async (c) => {
  try {
    const { description } = await c.req.json();
    if (!description) return c.json({ error: "Description is required" }, 400);

    const id = crypto.randomUUID();
    runAgentTask(id, description).catch((e) => console.error(`Agent task ${id} failed:`, e));
    return c.json({ taskId: id }, 202);
  } catch (err) { const { message, status } = handleRouteError(err); return c.json({ error: message }, status as 500); }
});
