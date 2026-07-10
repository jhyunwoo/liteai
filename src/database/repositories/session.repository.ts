/**
 * @module database/repositories/session.repository
 * @description 인증 세션(Session) 데이터 접근 리포지토리
 *
 * sessions 테이블에 대한 CRUD 작업을 캡슐화합니다.
 * 세션 생성, 토큰 기반 조회(만료 검증 포함), 삭제 기능을 제공합니다.
 *
 * 세션 만료 정책:
 * - 세션 조회 시 만료 시각(expires_at)을 자동으로 검증
 * - 만료된 세션은 조회 시점에 자동으로 삭제 (lazy cleanup)
 * - 이를 통해 별도의 만료 세션 정리 배치 작업 없이도
 *   데이터베이스가 깨끗하게 유지됩니다.
 */

import { db } from "../connection";
import type { Session } from "../../types";

/**
 * 세션 리포지토리 객체
 */
export const sessionRepository = {
  /**
   * 새로운 인증 세션을 생성합니다.
   *
   * 로그인 성공 또는 관리자 초기 설정 완료 후 호출됩니다.
   * 세션 토큰은 HTTP-Only 쿠키로 클라이언트에 전달됩니다.
   *
   * @param token - 세션 토큰 (crypto.randomUUID()으로 생성)
   * @param username - 세션 소유자 사용자명
   * @param expiresAt - 세션 만료 시각 (Date 객체)
   */
  create(token: string, username: string, expiresAt: Date): void {
    db.run(
      "INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)",
      [token, username, expiresAt.toISOString()]
    );
  },

  /**
   * 세션 토큰으로 유효한 세션을 조회합니다.
   *
   * 인증 미들웨어에서 매 API 요청마다 호출되어
   * 사용자의 인증 상태를 검증합니다.
   *
   * 만료된 세션이 발견되면:
   * 1. 해당 세션 레코드를 데이터베이스에서 즉시 삭제 (lazy cleanup)
   * 2. null을 반환하여 인증 실패로 처리
   *
   * @param token - 검증할 세션 토큰 (쿠키에서 추출)
   * @returns 유효한 Session 객체, 토큰이 없거나 만료된 경우 null
   */
  getByToken(token: string): Session | null {
    const query = db.query<Session, [string]>(
      "SELECT * FROM sessions WHERE token = ?"
    );
    const session = query.get(token);

    if (!session) return null;

    /* 세션 만료 시각 검증: 현재 시각보다 과거이면 만료된 것으로 판단 */
    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.deleteByToken(token);
      return null;
    }

    return session;
  },

  /**
   * 세션 토큰으로 세션을 삭제합니다.
   *
   * 사용자가 로그아웃하거나, 만료된 세션을 정리할 때 호출됩니다.
   *
   * @param token - 삭제할 세션의 토큰
   */
  deleteByToken(token: string): void {
    db.run("DELETE FROM sessions WHERE token = ?", [token]);
  },
};
