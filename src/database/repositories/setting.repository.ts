/**
 * @module database/repositories/setting.repository
 * @description 시스템 설정(Setting) 데이터 접근 리포지토리
 *
 * settings 테이블에 대한 CRUD 작업을 캡슐화합니다.
 * API 키, 기본 모델, 검색 프로바이더 등 시스템 전역 설정을
 * key-value 형태로 관리합니다.
 *
 * INSERT OR REPLACE를 사용하여 설정 값의 생성과 업데이트를
 * 단일 쿼리로 처리합니다 (UPSERT 패턴).
 */

import { db } from "../connection";
import type { Setting } from "../../types";

/**
 * 설정 리포지토리 객체
 *
 * 시스템 설정의 조회, 저장, 전체 목록 연산을 제공합니다.
 */
export const settingRepository = {
  /**
   * 특정 설정 키의 값을 조회합니다.
   *
   * 프로바이더 API 키, 기본 모델명 등 개별 설정값을 읽을 때 사용됩니다.
   * 키가 존재하지 않으면 null을 반환하므로, 호출부에서 기본값 처리가 필요합니다.
   *
   * @param key - 조회할 설정 키 (예: "groq_api_key", "active_provider")
   * @returns 설정 값 문자열, 키가 없으면 null
   *
   * @example
   * const apiKey = settingRepository.get("groq_api_key");
   * const ollamaUrl = settingRepository.get("ollama_url") || DEFAULT_OLLAMA_URL;
   */
  get(key: string): string | null {
    const query = db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?"
    );
    const result = query.get(key);
    return result ? result.value : null;
  },

  /**
   * 설정 값을 저장합니다 (UPSERT).
   *
   * 키가 이미 존재하면 값을 업데이트하고,
   * 존재하지 않으면 새로 생성합니다.
   * INSERT OR REPLACE 구문을 사용하여 단일 쿼리로 처리합니다.
   *
   * @param key - 설정 키
   * @param value - 설정 값 (문자열)
   */
  set(key: string, value: string): void {
    db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [key, value]
    );
  },

  /**
   * 모든 설정을 key-value 객체로 조회합니다.
   *
   * 설정 화면에서 전체 설정을 한 번에 로드할 때 사용됩니다.
   * 배열 형태의 쿼리 결과를 Record<string, string> 형태로 변환하여
   * 키로 직접 접근할 수 있도록 합니다.
   *
   * @returns 전체 설정 객체 (키-값 매핑)
   */
  listAll(): Record<string, string> {
    const query = db.query<Setting, []>("SELECT * FROM settings");
    const settings: Record<string, string> = {};
    for (const s of query.all()) {
      settings[s.key] = s.value;
    }
    return settings;
  },
};
