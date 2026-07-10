/**
 * @module database
 * @description 데이터베이스 모듈 배럴(barrel) 내보내기
 *
 * 이 모듈은 데이터베이스 연결 객체와 모든 도메인별 리포지토리를
 * 단일 진입점에서 내보내는 배럴 파일입니다.
 *
 * 다른 모듈에서 데이터베이스 기능을 사용할 때
 * 개별 리포지토리 파일을 직접 import하는 대신
 * 이 배럴 파일을 통해 접근할 수 있습니다.
 *
 * @example
 * // ✅ 권장: 배럴 import
 * import { conversationRepository, messageRepository } from '../database';
 *
 * // ⚠️ 비권장: 직접 import (동작하지만 경로가 깊어짐)
 * import { conversationRepository } from '../database/repositories/conversation.repository';
 */

/* 데이터베이스 연결 객체 (Proxy 기반 지연 초기화) */
export { db } from "./connection";

/* 도메인별 리포지토리 */
export { conversationRepository } from "./repositories/conversation.repository";
export { messageRepository } from "./repositories/message.repository";
export { settingRepository } from "./repositories/setting.repository";
export { userRepository } from "./repositories/user.repository";
export { sessionRepository } from "./repositories/session.repository";
export { agentTaskRepository } from "./repositories/agent-task.repository";
