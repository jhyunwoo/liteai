/**
 * @module database/repositories/conversation.repository
 * @description 대화방(Conversation) 데이터 접근 리포지토리
 *
 * conversations 테이블에 대한 모든 CRUD 작업을 캡슐화합니다.
 * 리포지토리 패턴을 적용하여 데이터베이스 접근 로직을 비즈니스 로직과 분리하고,
 * SQL 쿼리를 한곳에서 관리함으로써 유지보수성을 높입니다.
 */

import { db } from "../connection";
import type { Conversation } from "../../types";

/**
 * 대화방 리포지토리 객체
 *
 * 대화방 엔티티에 대한 데이터베이스 CRUD 연산을 제공합니다.
 * 모든 메서드는 동기적으로 실행됩니다 (Bun SQLite는 동기 드라이버).
 */
export const conversationRepository = {
  /**
   * 모든 대화방을 최근 업데이트 순으로 조회합니다.
   *
   * 사이드바의 대화 목록을 렌더링할 때 사용됩니다.
   * updated_at 기준 내림차순으로 정렬되므로
   * 가장 최근에 메시지가 추가된 대화방이 상단에 표시됩니다.
   *
   * @returns 전체 대화방 배열 (최근 업데이트 순)
   */
  list(): Conversation[] {
    const query = db.query<Conversation, []>(
      "SELECT * FROM conversations ORDER BY updated_at DESC"
    );
    return query.all();
  },

  /**
   * ID로 특정 대화방을 조회합니다.
   *
   * @param id - 조회할 대화방의 UUID
   * @returns 해당 대화방 객체, 존재하지 않으면 null
   */
  getById(id: string): Conversation | null {
    const query = db.query<Conversation, [string]>(
      "SELECT * FROM conversations WHERE id = ?"
    );
    return query.get(id);
  },

  /**
   * 새로운 대화방을 생성합니다.
   *
   * 사용자가 "새 대화" 버튼을 클릭할 때 호출됩니다.
   * created_at과 updated_at은 SQLite DEFAULT 값으로 자동 설정됩니다.
   *
   * @param id - 대화방 UUID (클라이언트에서 생성)
   * @param title - 대화방 제목
   * @param model - 사용할 LLM 모델명
   * @param provider - AI 제공 플랫폼명
   * @param systemPrompt - 시스템 프롬프트 (null이면 미적용)
   */
  create(
    id: string,
    title: string,
    model: string,
    provider: string,
    systemPrompt: string | null
  ): void {
    db.run(
      "INSERT INTO conversations (id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)",
      [id, title, model, provider, systemPrompt]
    );
  },

  /**
   * 대화방 제목을 변경합니다.
   *
   * updated_at 타임스탬프도 함께 갱신됩니다.
   *
   * @param id - 변경할 대화방의 UUID
   * @param title - 새로운 제목
   */
  updateTitle(id: string, title: string): void {
    db.run(
      "UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [title, id]
    );
  },

  /**
   * 대화방의 프로바이더와 모델 설정을 변경합니다.
   *
   * 대화 중간에 다른 AI 모델로 전환할 때 사용됩니다.
   * updated_at 타임스탬프도 함께 갱신됩니다.
   *
   * @param id - 변경할 대화방의 UUID
   * @param provider - 새로운 프로바이더명
   * @param model - 새로운 모델명
   */
  updateSettings(id: string, provider: string, model: string): void {
    db.run(
      "UPDATE conversations SET provider = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [provider, model, id]
    );
  },

  /**
   * 대화방을 삭제합니다.
   *
   * 외래 키 CASCADE 설정에 의해 해당 대화방에 속한
   * 모든 메시지도 함께 자동 삭제됩니다.
   *
   * @param id - 삭제할 대화방의 UUID
   */
  deleteById(id: string): void {
    db.run("DELETE FROM conversations WHERE id = ?", [id]);
  },
};
