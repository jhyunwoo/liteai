/**
 * @module database/repositories/agent-task.repository
 * @description 에이전트 태스크(AgentTask) 데이터 접근 리포지토리
 *
 * agent_tasks 테이블에 대한 CRUD 작업을 캡슐화합니다.
 * 에이전트 작업의 생성, 상태/로그 업데이트, 조회 기능을 제공합니다.
 */

import { db } from "../connection";
import type { AgentTask } from "../../types";

/**
 * 에이전트 태스크 리포지토리 객체
 */
export const agentTaskRepository = {
  /**
   * 모든 에이전트 태스크를 최근 생성순으로 조회합니다.
   *
   * 에이전트 사이드바의 작업 목록을 렌더링할 때 사용됩니다.
   *
   * @returns 전체 태스크 배열 (최근 생성 순)
   */
  list(): AgentTask[] {
    const query = db.query<AgentTask, []>(
      "SELECT * FROM agent_tasks ORDER BY created_at DESC"
    );
    return query.all();
  },

  /**
   * ID로 특정 에이전트 태스크를 조회합니다.
   *
   * 태스크 상세 조회 및 에이전트 실행 중 로그 갱신 전 확인에 사용됩니다.
   *
   * @param id - 조회할 태스크의 UUID
   * @returns 해당 태스크 객체, 존재하지 않으면 null
   */
  getById(id: string): AgentTask | null {
    const query = db.query<AgentTask, [string]>(
      "SELECT * FROM agent_tasks WHERE id = ?"
    );
    return query.get(id);
  },

  /**
   * 새로운 에이전트 태스크를 생성합니다.
   *
   * 사용자가 에이전트 작업 실행을 요청할 때 호출됩니다.
   * 초기 상태는 "running"이며, 초기 로그와 함께 저장됩니다.
   *
   * @param id - 태스크 UUID (서버에서 crypto.randomUUID()으로 생성)
   * @param description - 사용자가 입력한 작업 설명
   * @param status - 초기 실행 상태 (보통 "running")
   * @param logs - 초기 로그 텍스트
   */
  create(
    id: string,
    description: string,
    status: string,
    logs: string
  ): void {
    db.run(
      "INSERT INTO agent_tasks (id, description, status, logs) VALUES (?, ?, ?, ?)",
      [id, description, status, logs]
    );
  },

  /**
   * 에이전트 태스크의 상태와 로그를 업데이트합니다.
   *
   * 에이전트 실행 루프의 각 스텝마다 호출되어
   * 최신 로그와 실행 상태를 데이터베이스에 반영합니다.
   * 프론트엔드에서 폴링으로 이 데이터를 조회하여 실시간 로그를 표시합니다.
   *
   * @param id - 업데이트할 태스크의 UUID
   * @param status - 새로운 실행 상태 ("running" | "success" | "failed")
   * @param logs - 누적된 실행 로그 텍스트
   */
  update(id: string, status: string, logs: string): void {
    db.run(
      "UPDATE agent_tasks SET status = ?, logs = ? WHERE id = ?",
      [status, logs, id]
    );
  },
};
