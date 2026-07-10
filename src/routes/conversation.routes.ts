/**
 * @module routes/conversation.routes
 * @description 대화방(Conversation) CRUD API 라우트
 */

import { Hono } from "hono";
import { conversationRepository, messageRepository } from "../database";
import { handleRouteError } from "../utils/error-handler";

export const conversationRoutes = new Hono();

/** GET / - 전체 대화방 목록 조회 */
conversationRoutes.get("/", (c) => {
  try {
    return c.json(conversationRepository.list());
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** GET /:id - 특정 대화방 상세 조회 (메시지 포함) */
conversationRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  try {
    const conv = conversationRepository.getById(id);
    if (!conv) return c.json({ error: "Conversation not found" }, 404);
    const messages = messageRepository.getByConversationId(id);
    return c.json({ ...conv, messages });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST / - 새 대화방 생성 */
conversationRoutes.post("/", async (c) => {
  try {
    const { title, model, provider, systemPrompt } = await c.req.json();
    const id = crypto.randomUUID();
    conversationRepository.create(id, title || "New Chat", model, provider, systemPrompt || null);
    return c.json(conversationRepository.getById(id), 201);
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** DELETE /:id - 대화방 삭제 (메시지 CASCADE 삭제) */
conversationRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  try {
    conversationRepository.deleteById(id);
    return c.json({ success: true });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** PATCH /:id - 대화방 정보 수정 (제목, 프로바이더/모델) */
conversationRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const { title, provider, model } = await c.req.json();
    const conv = conversationRepository.getById(id);
    if (!conv) return c.json({ error: "Conversation not found" }, 404);
    if (title !== undefined) conversationRepository.updateTitle(id, title);
    if (provider !== undefined && model !== undefined) conversationRepository.updateSettings(id, provider, model);
    return c.json({ success: true });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});
