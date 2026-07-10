/**
 * @module types
 * @description LiteAI 프로젝트 전역에서 사용되는 공통 타입 정의 모듈
 *
 * 이 모듈은 프로젝트 전체에서 일관된 타입 안전성을 보장하기 위해
 * 모든 도메인(대화, 메시지, 사용자, 설정, 에이전트, 파일 시스템, MCP, LLM 프로바이더)의
 * 인터페이스와 타입 별칭을 중앙 집중적으로 관리합니다.
 *
 * 각 도메인 모듈에서는 이 파일의 타입만 import하여 사용하므로,
 * 타입 변경 시 이 파일만 수정하면 프로젝트 전체에 반영됩니다.
 */

// ============================================================================
// 대화(Conversation) 도메인 타입
// ============================================================================

/**
 * 대화방(Conversation) 엔티티 인터페이스
 *
 * 사용자가 생성한 개별 AI 채팅 대화방을 나타냅니다.
 * 각 대화방은 특정 AI 프로바이더와 모델에 바인딩되며,
 * 선택적으로 시스템 프롬프트를 설정할 수 있습니다.
 */
export interface Conversation {
  /** 대화방 고유 식별자 (UUID v4 형식) */
  id: string;
  /** 대화방 제목 (사용자가 지정하거나 기본값 "New Chat") */
  title: string;
  /** 사용 중인 LLM 모델명 (예: "llama3", "gemini-2.0-flash") */
  model: string;
  /** AI 제공 플랫폼명 (예: "ollama", "gemini", "groq") */
  provider: string;
  /** 대화에 적용되는 시스템 프롬프트 (미설정 시 null) */
  system_prompt: string | null;
  /** 대화방 생성 시각 (ISO 8601 형식) */
  created_at: string;
  /** 대화방 최종 업데이트 시각 (메시지 추가 시 갱신) */
  updated_at: string;
}

/**
 * 채팅 메시지(Message) 엔티티 인터페이스
 *
 * 대화방 내에서 주고받은 개별 메시지를 나타냅니다.
 * 사용자("user") 또는 AI 어시스턴트("assistant")의 메시지가 순서대로 저장됩니다.
 */
export interface Message {
  /** 메시지 고유 식별자 (UUID v4 형식) */
  id: string;
  /** 소속된 대화방 ID (외래 키, CASCADE 삭제) */
  conversation_id: string;
  /** 메시지 발신자 역할 ("user" | "assistant" | "system") */
  role: string;
  /** 메시지 본문 내용 (마크다운 형식 포함 가능) */
  content: string;
  /** 메시지 생성 시각 (ISO 8601 형식) */
  created_at: string;
}

/**
 * LLM API 요청에 사용되는 간소화된 채팅 메시지 인터페이스
 *
 * 데이터베이스의 Message와 달리 ID, 타임스탬프 등 메타데이터 없이
 * LLM API 호출에 필요한 최소한의 정보(역할, 내용)만 포함합니다.
 */
export interface ChatMessage {
  /** 메시지 역할 ("system" | "user" | "assistant") */
  role: string;
  /** 메시지 내용 */
  content: string;
}

// ============================================================================
// 사용자(User) 및 세션(Session) 도메인 타입
// ============================================================================

/**
 * 사용자(User) 엔티티 인터페이스
 *
 * LiteAI 시스템에 등록된 관리자 계정 정보를 나타냅니다.
 * 비밀번호는 Bun.password.hash()로 해시화되어 저장됩니다.
 */
export interface User {
  /** 사용자 고유 아이디 (Primary Key) */
  username: string;
  /** bcrypt 해시화된 비밀번호 */
  password_hash: string;
  /** 계정 생성 시각 (ISO 8601 형식) */
  created_at: string;
}

/**
 * 인증 세션(Session) 엔티티 인터페이스
 *
 * 사용자 로그인 시 생성되는 세션 토큰 정보를 나타냅니다.
 * 세션 토큰은 HTTP-Only 쿠키로 클라이언트에 전달되며,
 * 만료 시각이 지나면 자동으로 무효화됩니다.
 */
export interface Session {
  /** 세션 토큰 (UUID v4, 쿠키 값으로 사용) */
  token: string;
  /** 세션 소유자의 사용자명 */
  username: string;
  /** 세션 만료 시각 (ISO 8601 형식) */
  expires_at: string;
}

// ============================================================================
// 설정(Setting) 도메인 타입
// ============================================================================

/**
 * 시스템 설정(Setting) 엔티티 인터페이스
 *
 * API 키, 기본 모델, 검색 프로바이더 등 시스템 전역 설정을 나타냅니다.
 * key-value 형태로 SQLite settings 테이블에 저장됩니다.
 */
export interface Setting {
  /** 설정 키 (예: "groq_api_key", "active_provider") */
  key: string;
  /** 설정 값 (문자열 형태, 모든 값은 직렬화되어 저장) */
  value: string;
}

// ============================================================================
// 에이전트(Agent) 도메인 타입
// ============================================================================

/**
 * 에이전트 태스크 실행 상태를 나타내는 유니온 타입
 *
 * - "running": 에이전트가 현재 작업을 수행 중
 * - "success": 작업이 성공적으로 완료됨
 * - "failed": 작업 수행 중 오류 발생 또는 최대 스텝 초과
 */
export type AgentTaskStatus = "running" | "success" | "failed";

/**
 * 에이전트 태스크(AgentTask) 엔티티 인터페이스
 *
 * AI 에이전트가 자율적으로 수행하는 작업 단위를 나타냅니다.
 * 에이전트는 파일 읽기/쓰기, 명령어 실행, 웹 검색 등의 도구를 활용하여
 * 사용자가 지시한 작업을 최대 N 스텝 내에서 완수합니다.
 */
export interface AgentTask {
  /** 태스크 고유 식별자 (UUID v4 형식) */
  id: string;
  /** 사용자가 입력한 작업 설명 */
  description: string;
  /** 현재 실행 상태 */
  status: AgentTaskStatus;
  /** 에이전트 실행 로그 (각 스텝의 사고/도구호출/결과 포함) */
  logs: string;
  /** 태스크 생성 시각 (ISO 8601 형식) */
  created_at: string;
}

// ============================================================================
// 파일 시스템(File System) 도메인 타입
// ============================================================================

/**
 * 워크스페이스 파일/디렉토리 항목 인터페이스
 *
 * 워크스페이스 내의 개별 파일 또는 디렉토리 정보를 나타냅니다.
 * 파일 탐색기 UI에서 파일 트리를 렌더링할 때 사용됩니다.
 */
export interface FileItem {
  /** 파일/디렉토리 이름 (경로 미포함) */
  name: string;
  /** 워크스페이스 루트 기준 상대 경로 */
  relativePath: string;
  /** 디렉토리 여부 (true면 폴더, false면 파일) */
  isDir: boolean;
  /** 파일 크기 (바이트 단위, 디렉토리인 경우 undefined) */
  size?: number;
  /** 파일 최종 수정 시각 (ISO 8601 형식, 디렉토리인 경우 undefined) */
  updatedAt?: string;
}

// ============================================================================
// MCP (Model Context Protocol) 도메인 타입
// ============================================================================

/**
 * MCP 서버 설정 인터페이스
 *
 * stdio 기반 MCP 서버 프로세스를 생성하기 위한 설정 정보입니다.
 * 설정 화면에서 JSON 형태로 사용자가 직접 입력합니다.
 *
 * @example
 * {
 *   "command": "npx",
 *   "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "liteai.db"],
 *   "env": { "NODE_ENV": "production" }
 * }
 */
export interface McpServerConfig {
  /** 실행할 명령어 (예: "npx", "node", "python") */
  command: string;
  /** 명령어에 전달할 인자 배열 */
  args: string[];
  /** 프로세스에 주입할 추가 환경변수 (선택) */
  env?: Record<string, string>;
}

/**
 * MCP 도구(Tool) 정보 인터페이스
 *
 * MCP 서버가 제공하는 개별 도구의 메타데이터를 나타냅니다.
 * tools/list JSON-RPC 요청의 응답에서 추출됩니다.
 */
export interface McpTool {
  /** 도구 고유 이름 (MCP 서버 내에서 유일) */
  name: string;
  /** 도구에 대한 설명 (선택) */
  description?: string;
  /** 도구 입력 매개변수의 JSON Schema 정의 */
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// LLM 프로바이더(Provider) 도메인 타입
// ============================================================================

/**
 * 지원하는 LLM 프로바이더 이름의 유니온 타입
 *
 * 새로운 프로바이더를 추가할 때 이 타입에 추가하면
 * 프로젝트 전체에서 타입 체크가 적용됩니다.
 */
export type ProviderName =
  | "ollama"
  | "gemini"
  | "openrouter"
  | "groq"
  | "cerebras"
  | "cloudflare";

/**
 * 지원하는 웹 검색 프로바이더 이름의 유니온 타입
 */
export type SearchProviderName =
  | "duckduckgo"
  | "brave"
  | "serper"
  | "searxng"
  | "ollama";

/**
 * 웹 검색 결과 인터페이스
 *
 * 모든 검색 프로바이더에서 공통으로 반환하는 검색 결과 형식입니다.
 * 검색 결과는 채팅 컨텍스트에 주입되어 AI의 실시간 정보 접근을 지원합니다.
 */
export interface SearchResult {
  /** 검색 결과 제목 */
  title: string;
  /** 검색 결과 원본 URL */
  url: string;
  /** 검색 결과 요약/스니펫 */
  snippet: string;
}

/**
 * LLM API 요청 구성 인터페이스
 *
 * 각 프로바이더가 생성하는 HTTP 요청 설정을 표준화합니다.
 * 프로바이더 클래스에서 요청을 구성할 때 사용됩니다.
 */
export interface LLMRequestConfig {
  /** API 엔드포인트 URL */
  url: string;
  /** HTTP 요청 헤더 (인증 토큰, Content-Type 등 포함) */
  headers: Record<string, string>;
  /** 요청 본문 (JSON 직렬화 대상) */
  body: Record<string, unknown>;
}

/**
 * LLM 비스트리밍 응답 인터페이스
 *
 * 에이전트 모드에서 사용하는 단일 완성 응답 형식입니다.
 * 스트리밍이 아닌 한 번의 요청으로 전체 응답을 받을 때 사용됩니다.
 */
export interface LLMResponse {
  /** LLM이 생성한 텍스트 응답 본문 */
  content: string;
  /** Gemini 검색 그라운딩에서 반환된 출처 정보 (URL → 제목 매핑) */
  groundingSources?: Map<string, string>;
}
