/**
 * @module database/repositories/user.repository
 * @description 사용자(User) 데이터 접근 리포지토리
 *
 * users 테이블에 대한 CRUD 작업을 캡슐화합니다.
 * 관리자 계정의 생성, 조회, 존재 여부 확인 기능을 제공합니다.
 */

import { db } from "../connection";
import type { User } from "../../types";

/**
 * 사용자 리포지토리 객체
 */
export const userRepository = {
  /**
   * 전체 사용자 수를 반환합니다.
   *
   * 최초 설정(Setup) 단계에서 이미 관리자 계정이 존재하는지
   * 확인하기 위해 사용됩니다. 사용자가 0명이면 Setup 화면을 표시합니다.
   *
   * @returns 등록된 사용자 수
   */
  getCount(): number {
    const query = db.query<{ "COUNT(*)": number }, []>(
      "SELECT COUNT(*) FROM users"
    );
    const result = query.get();
    return result ? result["COUNT(*)"] : 0;
  },

  /**
   * 새로운 사용자(관리자)를 생성합니다.
   *
   * 비밀번호는 Bun.password.hash()로 해시화된 후 이 메서드에 전달됩니다.
   * 평문 비밀번호가 이 레이어에 도달하지 않도록 라우트 핸들러에서 해시화합니다.
   *
   * @param username - 사용자 아이디
   * @param passwordHash - bcrypt 해시화된 비밀번호
   */
  create(username: string, passwordHash: string): void {
    db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash]
    );
  },

  /**
   * 사용자명으로 사용자를 조회합니다.
   *
   * 로그인 시 사용자 존재 여부 확인 및 비밀번호 검증에 사용됩니다.
   *
   * @param username - 조회할 사용자 아이디
   * @returns User 객체, 존재하지 않으면 null
   */
  getByUsername(username: string): User | null {
    const query = db.query<User, [string]>(
      "SELECT * FROM users WHERE username = ?"
    );
    return query.get(username);
  },
};
