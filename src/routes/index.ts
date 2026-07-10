/**
 * @module routes
 * @description API 라우트 등록 모듈
 *
 * 모든 도메인별 라우트를 Hono 앱 인스턴스에 등록합니다.
 * 각 라우트 모듈은 자체 Hono 인스턴스를 사용하며,
 * 이 함수에서 API 경로 접두사와 함께 메인 앱에 마운트됩니다.
 */

import type { Hono } from "hono";
import { authRoutes } from "./auth.routes";
import { conversationRoutes } from "./conversation.routes";
import { chatRoutes } from "./chat.routes";
import { fileRoutes } from "./file.routes";
import { configRoutes } from "./config.routes";
import { modelRoutes } from "./model.routes";
import { mcpRoutes } from "./mcp.routes";
import { agentRoutes } from "./agent.routes";

/**
 * 모든 API 라우트를 앱에 등록합니다.
 *
 * @param app - Hono 앱 인스턴스
 */
export function registerRoutes(app: Hono): void {
  app.route("/api/auth", authRoutes);
  app.route("/api/conversations", conversationRoutes);
  app.route("/api/chat", chatRoutes);
  app.route("/api/files", fileRoutes);
  app.route("/api/config", configRoutes);
  app.route("/api/models", modelRoutes);
  app.route("/api/mcp", mcpRoutes);
  app.route("/api/agent", agentRoutes);
}
