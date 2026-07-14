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
import { compress } from "hono/compress";
import { csrf } from "hono/csrf";
import { authMiddleware } from "./middleware/auth.middleware";
import { registerRoutes } from "./routes";

/**
 * 정적 파일 MIME 타입 매핑 헬퍼
 */
const getMimeType = (path: string): string => {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
};

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

  /* public/ 디렉토리의 정적 파일 사전 압축 서빙 및 Immutable 캐싱 미들웨어 */
  app.use("/*", async (c, next) => {
    const urlPath = c.req.path;
    const cleanPath = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
    const filePath = `./public${cleanPath}`;

    // 해당 정적 파일의 기본 버전이 존재하는지 검증
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return next();
    }

    const acceptEncoding = c.req.header("Accept-Encoding") || "";

    // 해시가 동반된 assets 경로는 1년 캐싱 (Immutable), 그 외(index.html 등)는 no-cache
    if (urlPath.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      c.header("Cache-Control", "no-cache");
    }

    // 1. Brotli 사전 압축 지원 검사
    if (acceptEncoding.includes("br")) {
      const brFile = Bun.file(`${filePath}.br`);
      if (await brFile.exists()) {
        c.header("Content-Encoding", "br");
        c.header("Content-Type", getMimeType(filePath));
        return c.body(brFile);
      }
    }

    // 2. Gzip 사전 압축 지원 검사
    if (acceptEncoding.includes("gzip")) {
      const gzFile = Bun.file(`${filePath}.gz`);
      if (await gzFile.exists()) {
        c.header("Content-Encoding", "gzip");
        c.header("Content-Type", getMimeType(filePath));
        return c.body(gzFile);
      }
    }

    // 3. 압축 미지원 클라이언트 일반 서빙
    c.header("Content-Type", getMimeType(filePath));
    return c.body(file);
  });

  /* /api/* 경로에 세션 기반 인증 미들웨어 적용 */
  app.use("/api/*", authMiddleware);

  /* 모든 도메인별 API 라우트 등록 */
  registerRoutes(app);

  return app;
}
