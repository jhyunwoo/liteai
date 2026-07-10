/**
 * @module app
 * @description Hono 애플리케이션 인스턴스 생성 및 미들웨어 등록
 *
 * 이 모듈은 Hono 앱을 생성하고 전역 미들웨어(CSRF, 압축, 정적 파일, 인증)와
 * 모든 API 라우트를 등록합니다.
 *
 * 서버 진입점(index.ts)과 분리하여 테스트에서 앱 인스턴스를 독립적으로 생성할 수 있습니다.
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { csrf } from "hono/csrf";
import { authMiddleware } from "./middleware/auth.middleware";
import { registerRoutes } from "./routes";

/**
 * Hono 앱 인스턴스를 생성하고 초기화합니다.
 *
 * @returns 완전히 구성된 Hono 앱 인스턴스
 */
export function createApp(): Hono {
  const app = new Hono();

  /* CSRF 보호 활성화 (테스트 환경에서는 비활성) */
  if (process.env.NODE_ENV !== "test") {
    app.use(csrf());
  }

  /* 모든 응답에 Gzip/Deflate 압축 적용 */
  app.use("*", compress());

  /* public/ 디렉토리의 정적 파일 서빙 */
  app.use("/*", serveStatic({ root: "./public" }));

  /* /api/* 경로에 세션 기반 인증 미들웨어 적용 */
  app.use("/api/*", authMiddleware);

  /* 모든 도메인별 API 라우트 등록 */
  registerRoutes(app);

  return app;
}
