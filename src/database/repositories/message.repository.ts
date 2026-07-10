/**
 * @module database/repositories/message.repository
 * @description 채팅 메시지(Message) 데이터 접근 리포지토리
 *
 * messages 테이블에 대한 CRUD 작업을 캡슐화합니다.
 * 메시지 생성 시 소속 대화방의 updated_at 타임스탬프를 자동으로 갱신하여
 * 대화 목록의 정렬 순서가 최신 활동 기준으로 유지되도록 합니다.
 */

import { db } from "../connection";
import type { Message } from "../../types";

/**
 * 메시지 리포지토리 객체
 *
 * 대화 내 메시지에 대한 조회 및 생성 연산을 제공합니다.
 */
export const messageRepository = {
  /**
   * 특정 대화방에 속한 모든 메시지를 시간순으로 조회합니다.
   *
   * 채팅 화면에서 대화 기록을 표시할 때 사용됩니다.
   * created_at 오름차순으로 정렬되어 가장 오래된 메시지가 먼저 표시됩니다.
   *
   * @param conversationId - 조회할 대화방의 UUID
   * @returns 해당 대화방의 메시지 배열 (시간순)
   */
  getByConversationId(conversationId: string): Message[] {
    const query = db.query<Message, [string]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    );
    return query.all(conversationId);
  },

  /**
   * 새로운 메시지를 생성하고 소속 대화방의 타임스탬프를 갱신합니다.
   *
   * 사용자 메시지 전송 또는 AI 응답 저장 시 호출됩니다.
   * 메시지 삽입과 동시에 대화방의 updated_at을 현재 시각으로 갱신하여
   * 대화 목록에서 최근 활동 대화가 상단에 표시되도록 합니다.
   *
   * @param id - 메시지 UUID (서버에서 crypto.randomUUID()으로 생성)
   * @param conversationId - 소속 대화방의 UUID
   * @param role - 발신자 역할 ("user" | "assistant")
   * @param content - 메시지 본문 내용
   */
  create(
    id: string,
    conversationId: string,
    role: string,
    content: string
  ): void {
    /* 메시지 레코드 삽입 */
    db.run(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
      [id, conversationId, role, content]
    );

    /* 소속 대화방의 최종 수정 시각 갱신 (대화 목록 정렬에 활용) */
    db.run(
      "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [conversationId]
    );
  },
};
