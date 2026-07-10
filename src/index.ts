/**
 * @module index
 * @description LiteAI 서버 진입점
 *
 * Bun 런타임에서 HTTP 서버를 시작하는 최소한의 진입점입니다.
 * 앱 생성 로직은 app.ts에 위임하여 관심사를 분리합니다.
 *
 * Bun은 export default 객체의 port, fetch 속성을 사용하여
 * 자동으로 HTTP 서버를 시작합니다.
 */

import { createApp } from "./app";
import { SERVER_PORT, SERVER_IDLE_TIMEOUT } from "./config/constants";

/** Hono 앱 인스턴스 생성 */
const app = createApp();

/**
 * Bun HTTP 서버 설정
 *
 * - port: 서버 리스닝 포트
 * - idleTimeout: LLM 스트리밍 응답의 장시간 연결을 위해 최대값 사용
 * - fetch: Hono의 fetch 핸들러 연결
 */
export default {
  port: SERVER_PORT,
  idleTimeout: SERVER_IDLE_TIMEOUT,
  fetch: app.fetch,
};
