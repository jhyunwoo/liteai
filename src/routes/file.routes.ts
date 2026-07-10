/**
 * @module routes/file.routes
 * @description 파일 시스템 API 라우트
 *
 * 워크스페이스 내 파일/디렉토리의 CRUD 작업을 제공합니다.
 */

import { Hono } from "hono";
import { listFiles, readWorkspaceFile, writeWorkspaceFile, deleteWorkspaceFile, createWorkspaceDirectory } from "../services/file.service";
import { handleRouteError } from "../utils/error-handler";

export const fileRoutes = new Hono();

/** GET / - 파일/디렉토리 목록 조회 */
fileRoutes.get("/", async (c) => {
  try {
    return c.json(await listFiles(c.req.query("path") || ""));
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST / - 파일 생성/수정 */
fileRoutes.post("/", async (c) => {
  try {
    const { path, content } = await c.req.json();
    if (!path) return c.json({ error: "Path is required" }, 400);
    await writeWorkspaceFile(path, content || "");
    return c.json({ success: true });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST /mkdir - 디렉토리 생성 */
fileRoutes.post("/mkdir", async (c) => {
  try {
    const { path } = await c.req.json();
    if (!path) return c.json({ error: "Path is required" }, 400);
    await createWorkspaceDirectory(path);
    return c.json({ success: true });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** DELETE / - 파일/디렉토리 삭제 */
fileRoutes.delete("/", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Path is required" }, 400);
  try {
    await deleteWorkspaceFile(path);
    return c.json({ success: true });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** GET /read - 파일 내용 읽기 */
fileRoutes.get("/read", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Path is required" }, 400);
  try {
    return c.text(await readWorkspaceFile(path));
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});
