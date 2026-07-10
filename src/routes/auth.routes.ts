/**
 * @module routes/auth.routes
 * @description 인증 관련 API 라우트
 *
 * 사용자 인증(로그인, 로그아웃), 관리자 초기 설정,
 * 인증 상태 확인 엔드포인트를 제공합니다.
 */

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { userRepository, sessionRepository } from "../database";
import { SESSION_EXPIRY_MS, USERNAME_MIN_LENGTH, PASSWORD_MIN_LENGTH } from "../config/constants";
import { handleRouteError } from "../utils/error-handler";

export const authRoutes = new Hono();

/** GET /status - 현재 인증 상태 확인 */
authRoutes.get("/status", (c) => {
  try {
    const usersCount = userRepository.getCount();
    if (usersCount === 0) return c.json({ loggedIn: false, setupRequired: true });

    const sessionToken = getCookie(c, "session_token");
    if (!sessionToken) return c.json({ loggedIn: false, setupRequired: false });

    const session = sessionRepository.getByToken(sessionToken);
    if (!session) return c.json({ loggedIn: false, setupRequired: false });

    return c.json({ loggedIn: true, username: session.username, setupRequired: false });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST /setup - 최초 관리자 계정 생성 */
authRoutes.post("/setup", async (c) => {
  try {
    if (userRepository.getCount() > 0) {
      return c.json({ error: "Administrator account already exists" }, 400);
    }
    const { username, password } = await c.req.json();
    if (!username || !password || username.trim().length < USERNAME_MIN_LENGTH || password.length < PASSWORD_MIN_LENGTH) {
      return c.json({ error: `Username must be at least ${USERNAME_MIN_LENGTH} chars and password at least ${PASSWORD_MIN_LENGTH} chars.` }, 400);
    }

    const passwordHash = await Bun.password.hash(password);
    userRepository.create(username.trim(), passwordHash);

    /* 설정 완료 후 자동 로그인 */
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
    sessionRepository.create(token, username.trim(), expiresAt);

    setCookie(c, "session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
      sameSite: "Lax",
    });

    return c.json({ success: true, username: username.trim() });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST /login - 사용자 로그인 */
authRoutes.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password) return c.json({ error: "Username and password are required" }, 400);

    const user = userRepository.getByUsername(username.trim());
    if (!user) return c.json({ error: "Invalid username or password" }, 401);

    const isMatch = await Bun.password.verify(password, user.password_hash);
    if (!isMatch) return c.json({ error: "Invalid username or password" }, 401);

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
    sessionRepository.create(token, username.trim(), expiresAt);

    setCookie(c, "session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
      sameSite: "Lax",
    });

    return c.json({ success: true, username: user.username });
  } catch (err) {
    const { message, status } = handleRouteError(err);
    return c.json({ error: message }, status as 500);
  }
});

/** POST /logout - 로그아웃 */
authRoutes.post("/logout", (c) => {
  const sessionToken = getCookie(c, "session_token");
  if (sessionToken) sessionRepository.deleteByToken(sessionToken);
  deleteCookie(c, "session_token");
  return c.json({ success: true });
});
