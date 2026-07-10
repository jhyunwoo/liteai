/**
 * @module database/connection
 * @description SQLite 데이터베이스 연결 및 스키마 관리 모듈
 *
 * Bun의 내장 SQLite 드라이버를 사용하여 데이터베이스 연결을 관리합니다.
 * 싱글톤 패턴과 Proxy를 활용하여 지연 초기화(Lazy Initialization)를 구현하며,
 * 데이터베이스 경로 변경 시 자동으로 재연결합니다.
 *
 * 스키마 관리:
 * - 최초 연결 시 모든 테이블을 CREATE IF NOT EXISTS로 자동 생성
 * - 외래 키 제약 조건 활성화 (CASCADE 삭제 지원)
 *
 * 테이블 구조:
 * - conversations: AI 채팅 대화방
 * - messages: 대화 내 메시지 (대화방에 종속, CASCADE)
 * - settings: 시스템 설정 (key-value)
 * - users: 관리자 계정
 * - sessions: 인증 세션 (사용자에 종속, CASCADE)
 * - agent_tasks: 에이전트 작업 실행 기록
 */

import { Database } from "bun:sqlite";
import { DATABASE_PATH } from "../config/constants";

// ============================================================================
// 데이터베이스 싱글톤 인스턴스 관리
// ============================================================================

/**
 * 현재 활성화된 데이터베이스 인스턴스
 * 최초 접근 시 getDb()를 통해 생성되며, 이후 동일한 인스턴스를 재사용합니다.
 */
let dbInstance: Database | null = null;

/**
 * 현재 연결된 데이터베이스 파일 경로
 * 환경변수 변경으로 경로가 달라지면 기존 연결을 닫고 새로 연결합니다.
 */
let currentDbPath = "";

/**
 * 데이터베이스 인스턴스를 반환하는 내부 함수 (지연 초기화)
 *
 * 아직 연결이 없거나, 데이터베이스 파일 경로가 변경된 경우
 * 새로운 연결을 생성하고 스키마를 초기화합니다.
 *
 * 이 함수는 직접 호출하지 않고, 아래의 `db` Proxy를 통해
 * 자동으로 호출됩니다.
 *
 * @returns 활성화된 Database 인스턴스
 */
function getDb(): Database {
  const envDbPath = DATABASE_PATH;

  /*
   * 기존 연결이 없거나, 데이터베이스 경로가 변경된 경우에만 재연결합니다.
   * 이는 환경변수를 통해 런타임에 DB 경로를 변경할 수 있는 유연성을 제공합니다.
   * (예: 테스트 환경에서 임시 DB 사용)
   */
  if (!dbInstance || envDbPath !== currentDbPath) {
    /* 기존 연결이 있으면 안전하게 닫기 */
    if (dbInstance) {
      try {
        dbInstance.close();
      } catch (_e) {
        /* 이미 닫힌 연결의 close() 에러는 무시 */
      }
    }

    currentDbPath = envDbPath;
    dbInstance = new Database(currentDbPath);

    /* 외래 키 제약 조건 활성화 (SQLite 기본값은 비활성) */
    dbInstance.run("PRAGMA foreign_keys = ON;");

    /* 모든 테이블 스키마 초기화 */
    initializeSchema(dbInstance);
  }

  return dbInstance;
}

// ============================================================================
// 스키마 초기화
// ============================================================================

/**
 * 데이터베이스 스키마를 초기화합니다.
 *
 * CREATE TABLE IF NOT EXISTS를 사용하므로 이미 테이블이 존재하면
 * 아무 작업도 수행하지 않습니다. 마이그레이션이 필요한 경우
 * 이 함수에 ALTER TABLE 문을 추가할 수 있습니다.
 *
 * @param database - 스키마를 초기화할 Database 인스턴스
 */
function initializeSchema(database: Database): void {
  /**
   * 대화방 테이블
   * - id: UUID v4 형식의 기본 키
   * - title: 사용자가 지정한 대화방 제목
   * - model: 사용 중인 LLM 모델명
   * - provider: AI 제공 플랫폼명
   * - system_prompt: 대화에 적용할 시스템 프롬프트 (선택)
   * - created_at, updated_at: 자동 생성되는 타임스탬프
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      system_prompt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /**
   * 메시지 테이블
   * - conversation_id: 소속 대화방 (외래 키, CASCADE 삭제)
   * - role: 발신자 역할 ("user" | "assistant" | "system")
   * - content: 메시지 본문
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  /**
   * 시스템 설정 테이블
   * - key: 설정 키 (고유, Primary Key)
   * - value: 설정 값 (문자열)
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  /**
   * 사용자 계정 테이블
   * - username: 사용자 아이디 (고유, Primary Key)
   * - password_hash: bcrypt 해시화된 비밀번호
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /**
   * 인증 세션 테이블
   * - token: 세션 토큰 (UUID v4, Primary Key)
   * - username: 세션 소유자 (외래 키, CASCADE 삭제)
   * - expires_at: 세션 만료 시각
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  /**
   * 에이전트 작업 테이블
   * - id: 태스크 고유 ID (UUID v4, Primary Key)
   * - description: 사용자가 입력한 작업 설명
   * - status: 실행 상태 ("running" | "success" | "failed")
   * - logs: 에이전트 실행 로그 (텍스트)
   */
  database.run(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      logs TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ============================================================================
// Proxy 기반 데이터베이스 접근 객체
// ============================================================================

/**
 * Proxy 패턴을 사용한 데이터베이스 접근 객체
 *
 * 이 Proxy 객체는 Database 인터페이스를 투명하게 위임(delegate)합니다.
 * 속성이나 메서드에 접근할 때마다 getDb()가 호출되어
 * 지연 초기화된 실제 Database 인스턴스의 해당 멤버를 반환합니다.
 *
 * 이 패턴의 장점:
 * 1. 모듈 로드 시점에 DB 연결이 생성되지 않음 (지연 초기화)
 * 2. 환경변수 변경 시 자동으로 새 연결 생성 (테스트 유연성)
 * 3. 호출부에서는 일반 Database 객체처럼 사용 가능 (투명성)
 *
 * @example
 * // 일반 Database 객체처럼 사용
 * const query = db.query<Conversation, []>("SELECT * FROM conversations");
 * db.run("INSERT INTO settings ...", [key, value]);
 */
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const activeDb = getDb();
    const val = Reflect.get(activeDb, prop, receiver);
    if (typeof val === "function") {
      return val.bind(activeDb);
    }
    return val;
  },
});
