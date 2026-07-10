/**
 * @module middleware/auth.middleware
 * @description 인증 미들웨어
 *
 * 모든 /api/* 요청에 대해 세션 토큰 기반 인증을 수행합니다.
 * 인증이 필요 없는 공개 경로(로그인, 회원가입 등)는 자동으로 통과시킵니다.
 */

import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { sessionRepository } from "../database";
import { PUBLIC_API_PATHS } from "../config/constants";

/**
 * 세션 토큰 기반 인증 미들웨어
 *
 * 동작 흐름:
 * 1. 요청 경로가 PUBLIC_API_PATHS에 포함되면 인증 없이 통과
 * 2. 쿠키에서 session_token 추출
 * 3. 토큰이 없거나 유효하지 않으면 401 Unauthorized 반환
 * 4. 유효한 세션이면 컨텍스트에 username 설정 후 다음 핸들러 호출
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;

  /* 공개 API 경로는 인증을 건너뜁니다 */
  if (PUBLIC_API_PATHS.includes(path)) {
    await next();
    return;
  }

  /* 쿠키에서 세션 토큰 추출 */
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) {
    return c.json({ error: "Unauthorized: Session token missing" }, 401);
  }

  /* 세션 유효성 검증 (만료된 세션은 자동 삭제) */
  const session = sessionRepository.getByToken(sessionToken);
  if (!session) {
    return c.json({ error: "Unauthorized: Session expired or invalid" }, 401);
  }

  /* 인증된 사용자 정보를 컨텍스트에 저장 */
  c.set("username", session.username);
  await next();
});
