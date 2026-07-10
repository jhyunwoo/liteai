/**
 * @module utils/security
 * @description 보안 관련 유틸리티 모듈
 *
 * 파일 시스템 경로 검증, 셸 명령어 안전성 검사, 워크스페이스 샌드박싱 등
 * 보안에 관련된 모든 유틸리티 함수를 제공합니다.
 *
 * 이 모듈의 함수들은 에이전트의 명령어 실행과 파일 시스템 접근 시
 * 악의적이거나 위험한 작업을 사전에 차단하여 시스템을 보호합니다.
 *
 * 보안 원칙:
 * - 모든 파일 접근은 워크스페이스 디렉토리 내부로 제한 (샌드박싱)
 * - 디렉토리 트래버설 공격(..) 차단
 * - 시스템 수준 명령어 실행 차단
 * - 파괴적 명령어(rm with wildcards) 차단
 */

import { resolve, sep } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import {
  WORKSPACE_PATH,
  BLOCKED_COMMAND_KEYWORDS,
  BLOCKED_PATH_PATTERNS,
} from "../config/constants";

// ============================================================================
// 워크스페이스 경로 관리 함수
// ============================================================================

/**
 * 워크스페이스 루트 디렉토리의 절대 경로를 반환합니다.
 *
 * WORKSPACE_PATH 환경변수 또는 기본값("liteai_workspace")을
 * 현재 작업 디렉토리 기준으로 절대 경로로 변환합니다.
 *
 * @returns 워크스페이스 루트 디렉토리의 절대 경로
 */
export function getWorkspaceDir(): string {
  return resolve(process.cwd(), WORKSPACE_PATH);
}

/**
 * 워크스페이스 디렉토리가 존재하는지 확인하고, 없으면 생성합니다.
 *
 * 애플리케이션 최초 실행 시 또는 파일 작업 전에 호출하여
 * 워크스페이스 디렉토리의 존재를 보장합니다.
 *
 * @throws {Error} 디렉토리 생성에 실패한 경우
 */
export async function ensureWorkspaceExists(): Promise<void> {
  const workspaceDir = getWorkspaceDir();
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
  }
}

// ============================================================================
// 경로 보안 검증 함수
// ============================================================================

/**
 * 상대 경로를 워크스페이스 내부의 안전한 절대 경로로 변환합니다.
 *
 * 디렉토리 트래버설 공격("../../../etc/passwd" 등)을 방지하기 위해
 * 변환된 절대 경로가 반드시 워크스페이스 디렉토리 내부에 위치하는지 검증합니다.
 *
 * 검증 방식:
 * 1. 입력된 상대 경로를 워크스페이스 기준으로 resolve
 * 2. resolve된 경로가 워크스페이스 디렉토리와 동일하거나 그 하위인지 확인
 * 3. 워크스페이스 외부를 가리키면 즉시 에러를 발생시켜 접근 차단
 *
 * @param relativePath - 워크스페이스 기준 상대 경로 (예: "src/index.ts")
 * @returns 검증된 절대 경로
 * @throws {Error} 경로가 워크스페이스 외부를 가리키는 경우
 *
 * @example
 * resolveSafePath("src/index.ts");       // ✅ "/app/liteai_workspace/src/index.ts"
 * resolveSafePath("../etc/passwd");       // ❌ Error: 워크스페이스 외부 접근 차단
 * resolveSafePath("/etc/passwd");         // ❌ Error: 절대 경로 접근 차단
 */
export function resolveSafePath(relativePath: string): string {
  const workspaceDir = getWorkspaceDir();
  const resolved = resolve(workspaceDir, relativePath);

  /*
   * 경로 비교 시 디렉토리 구분자(/)를 포함하여 비교합니다.
   * 이는 "workspace2" 같은 유사한 이름의 디렉토리에 대한
   * 우회 공격을 방지하기 위함입니다.
   *
   * 예: workspaceDir = "/app/liteai_workspace"
   *     "/app/liteai_workspace2/secret" → 차단됨 (접두사만 일치, 구분자 불일치)
   */
  const safePrefix = workspaceDir.endsWith(sep)
    ? workspaceDir
    : workspaceDir + sep;

  if (resolved !== workspaceDir && !resolved.startsWith(safePrefix)) {
    throw new Error(
      "Access denied: path is outside the workspace directory."
    );
  }

  return resolved;
}

// ============================================================================
// 명령어 보안 검증 함수
// ============================================================================

/**
 * 셸 명령어에 차단된 시스템 키워드가 포함되어 있는지 검사합니다.
 *
 * 에이전트가 실행하려는 명령어에 sudo, shutdown, reboot 등
 * 시스템에 위험을 초래할 수 있는 키워드가 포함되어 있으면
 * 즉시 에러를 발생시켜 실행을 차단합니다.
 *
 * 단어 경계(\b)를 사용한 정규표현식으로 검사하므로,
 * "sudoku" 같은 무관한 단어는 차단되지 않습니다.
 *
 * @param cmd - 검사할 셸 명령어 문자열
 * @throws {Error} 차단된 키워드가 발견된 경우
 */
export function validateCommandSafety(cmd: string): void {
  const trimmedCmd = cmd.trim().toLowerCase();

  for (const keyword of BLOCKED_COMMAND_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(trimmedCmd)) {
      throw new Error(
        `Security blocked: execution of command containing '${keyword}' is prohibited.`
      );
    }
  }
}

/**
 * 셸 명령어에 디렉토리 트래버설이나 민감한 시스템 경로 접근이 포함되어 있는지 검사합니다.
 *
 * ".." 패턴이나 /etc/, /var/, /opt/ 등 시스템 핵심 디렉토리에
 * 접근하려는 시도를 차단합니다.
 *
 * @param cmd - 검사할 셸 명령어 문자열
 * @throws {Error} 위험한 경로 패턴이 발견된 경우
 */
export function validatePathSafety(cmd: string): void {
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (cmd.includes(pattern)) {
      throw new Error(
        "Security blocked: directory traversal or system paths in command are prohibited."
      );
    }
  }
}

/**
 * 파괴적인 rm 명령어를 검사하여 차단합니다.
 *
 * rm 명령어가 와일드카드(*)나 절대 경로(/)를 포함하는 경우
 * 의도하지 않은 대량 파일 삭제를 방지하기 위해 실행을 차단합니다.
 *
 * 허용되는 경우: `rm specific-file.txt` (특정 파일 하나만 삭제)
 * 차단되는 경우: `rm -rf /`, `rm *.log`, `rm /home/user/file`
 *
 * @param cmd - 검사할 셸 명령어 문자열
 * @throws {Error} 파괴적 rm 명령어가 감지된 경우
 */
export function validateDestructiveCommand(cmd: string): void {
  const trimmedCmd = cmd.trim().toLowerCase();

  if (trimmedCmd.includes("rm ")) {
    if (trimmedCmd.includes("/") || trimmedCmd.includes("*")) {
      throw new Error(
        "Security blocked: destructive 'rm' commands with wildcards or absolute paths are prohibited."
      );
    }
  }
}

/**
 * 셸 명령어에 대한 모든 보안 검증을 일괄 수행합니다.
 *
 * 에이전트의 run_command 도구에서 호출되며,
 * 키워드 검사, 경로 검사, 파괴적 명령어 검사를 순차적으로 수행합니다.
 *
 * @param cmd - 검사할 셸 명령어 문자열
 * @throws {Error} 보안 검증에 실패한 경우
 */
export function validateCommand(cmd: string): void {
  validateCommandSafety(cmd);
  validatePathSafety(cmd);
  validateDestructiveCommand(cmd);
}
