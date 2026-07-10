/**
 * @module config/constants
 * @description LiteAI 프로젝트 전역 상수 및 환경 설정 모듈
 *
 * 코드베이스 전반에 산재하던 하드코딩된 값들을 한곳에 모아 관리합니다.
 * 서버 포트, 세션 만료 시간, 모델 프리셋, 차단 키워드 등
 * 변경 가능성이 있는 모든 설정값을 상수로 정의하여
 * 유지보수성과 일관성을 보장합니다.
 */

import { join } from "path";
import type { ProviderName } from "../types";

// ============================================================================
// 서버 설정 상수
// ============================================================================

/** HTTP 서버 리스닝 포트 (기본값: 3000) */
export const SERVER_PORT = 3000;

/**
 * 서버 유휴 타임아웃 (초 단위)
 *
 * Bun 서버의 기본 유휴 타임아웃은 10초이지만, LLM 스트리밍 응답은
 * 모델 크기와 네트워크 상태에 따라 수 분이 소요될 수 있으므로
 * 허용 가능한 최대값(255초)으로 설정합니다.
 */
export const SERVER_IDLE_TIMEOUT = 255;

// ============================================================================
// 인증 및 세션 설정 상수
// ============================================================================

/**
 * 세션 만료 시간 (밀리초 단위, 7일)
 *
 * 사용자가 로그인하면 7일간 유효한 세션 토큰이 발급됩니다.
 * 이 기간이 지나면 자동으로 세션이 만료되어 재로그인이 필요합니다.
 */
export const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 사용자명 최소 길이 제한
 * 관리자 계정 생성 시 사용자명이 이 길이 이상이어야 합니다.
 */
export const USERNAME_MIN_LENGTH = 3;

/**
 * 비밀번호 최소 길이 제한
 * 관리자 계정 생성 시 비밀번호가 이 길이 이상이어야 합니다.
 */
export const PASSWORD_MIN_LENGTH = 6;

// ============================================================================
// 에이전트 설정 상수
// ============================================================================

/**
 * 에이전트 최대 실행 스텝 수
 *
 * 에이전트가 무한 루프에 빠지는 것을 방지하기 위해
 * 하나의 태스크에서 수행할 수 있는 최대 도구 호출 횟수를 제한합니다.
 */
export const AGENT_MAX_STEPS = 10;

// ============================================================================
// 검색 설정 상수
// ============================================================================

/**
 * 웹 검색 최대 결과 수
 *
 * 각 검색 프로바이더에서 반환하는 결과를 이 수만큼 제한합니다.
 * 너무 많은 검색 결과는 LLM 컨텍스트 윈도우를 낭비하므로
 * 상위 5개의 가장 관련성 높은 결과만 사용합니다.
 */
export const SEARCH_MAX_RESULTS = 5;

// ============================================================================
// 파일 시스템 및 데이터베이스 경로 상수
// ============================================================================

/**
 * SQLite 데이터베이스 파일 경로
 *
 * 환경변수 DATABASE_PATH가 설정되어 있으면 해당 경로를 사용하고,
 * 미설정 시 현재 작업 디렉토리의 liteai.db 파일을 사용합니다.
 * Docker 환경에서는 /app/data/liteai.db로 설정됩니다.
 */
export const DATABASE_PATH =
  process.env.DATABASE_PATH || join(process.cwd(), "liteai.db");

/**
 * 사용자 워크스페이스 디렉토리 경로
 *
 * 사용자 파일이 저장되는 샌드박스 디렉토리입니다.
 * 환경변수 WORKSPACE_PATH가 설정되어 있으면 해당 경로를 사용하고,
 * 미설정 시 현재 작업 디렉토리의 liteai_workspace 폴더를 사용합니다.
 */
export const WORKSPACE_PATH =
  process.env.WORKSPACE_PATH || "liteai_workspace";

// ============================================================================
// LLM 프로바이더 기본 설정 상수
// ============================================================================

/** Ollama 서버 기본 접속 URL (로컬 인스턴스) */
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * 각 프로바이더의 API 엔드포인트 URL 매핑
 *
 * 프로바이더별 기본 API URL을 한곳에서 관리합니다.
 * Ollama와 Cloudflare는 동적 URL(사용자 설정 기반)이므로 여기에 포함하지 않습니다.
 */
export const PROVIDER_API_ENDPOINTS: Record<string, string> = {
  /** Groq Cloud API (OpenAI 호환) */
  groq: "https://api.groq.com/openai/v1/chat/completions",
  /** Cerebras AI API (OpenAI 호환) */
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  /** OpenRouter 통합 API (OpenAI 호환) */
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

/**
 * 각 프로바이더의 모델 목록 조회 API 엔드포인트
 *
 * 설정 화면에서 사용 가능한 모델 목록을 동적으로 불러올 때 사용합니다.
 */
export const PROVIDER_MODEL_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/models",
  cerebras: "https://api.cerebras.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

// ============================================================================
// 모델 프리셋 (폴백용 기본 모델 목록)
// ============================================================================

/**
 * 프로바이더별 기본 모델 프리셋 목록
 *
 * API를 통해 동적으로 모델 목록을 조회할 수 없는 경우(API 키 미설정, 네트워크 오류 등)
 * 이 프리셋 목록을 폴백으로 사용합니다.
 * 프론트엔드의 modelPresets와 동일하게 유지해야 합니다.
 */
export const MODEL_PRESETS: Record<ProviderName, string[]> = {
  ollama: [
    "llama3",
    "llama3.1",
    "llama3.2",
    "llama3.3",
    "gemma2",
    "mistral",
    "qwen2.5",
    "deepseek-r1",
  ],
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ],
  openrouter: [
    "google/gemini-3.5-flash",
    "google/gemini-3.5-pro",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner",
  ],
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
    "deepseek-r1-distill-llama-70b",
  ],
  cerebras: [
    "llama3.3-70b",
    "llama3.1-8b",
    "llama3.1-70b",
  ],
  cloudflare: [
    "@cf/meta/llama-3.3-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/meta/llama-3-8b-instruct",
    "@cf/mistral/mistral-7b-instruct-v0.1",
    "@cf/qwen/qwen1.5-7b-chat",
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-1.5b",
  ],
};

// ============================================================================
// 보안 관련 상수
// ============================================================================

/**
 * 에이전트 명령어 실행 시 차단되는 키워드 목록
 *
 * 이 키워드가 포함된 셸 명령어는 실행이 거부됩니다.
 * 시스템 수준 명령어(sudo, shutdown 등), 네트워크 도구(nc, netcat 등),
 * 파일 권한 변경 명령어(chown, chmod 등)를 차단하여
 * 에이전트가 시스템을 손상시키는 것을 방지합니다.
 */
export const BLOCKED_COMMAND_KEYWORDS: string[] = [
  "sudo",
  "shutdown",
  "reboot",
  "poweroff",
  "init",
  "systemctl",
  "service",
  "mkfs",
  "dd",
  "nc",
  "netcat",
  "ncat",
  "passwd",
  "shadow",
  "chown",
  "chmod",
];

/**
 * 에이전트 명령어 실행 시 접근이 차단되는 시스템 경로 패턴
 *
 * 디렉토리 트래버설("..")이나 민감한 시스템 디렉토리(/etc/, /var/, /opt/)에
 * 접근하려는 명령어를 차단합니다.
 */
export const BLOCKED_PATH_PATTERNS: string[] = ["..", "/etc/", "/var/", "/opt/"];

/**
 * 인증이 필요 없는 공개 API 경로 목록
 *
 * 이 경로들은 인증 미들웨어를 통과하지 않고 직접 접근할 수 있습니다.
 * 로그인, 회원가입, 인증 상태 확인 등 인증 전에 필요한 엔드포인트입니다.
 */
export const PUBLIC_API_PATHS: string[] = [
  "/api/auth/status",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
];
