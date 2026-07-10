/**
 * @module utils/error-handler
 * @description 공통 에러 처리 유틸리티 모듈
 *
 * API 라우트 핸들러에서 반복적으로 사용되는 에러 처리 패턴을 표준화합니다.
 * 커스텀 에러 클래스(AppError)를 통해 HTTP 상태 코드와 에러 메시지를
 * 일관된 형식으로 클라이언트에 전달할 수 있습니다.
 *
 * @example
 * // 라우트 핸들러에서 사용 예시
 * throw new NotFoundError("대화방을 찾을 수 없습니다.");
 * throw new ValidationError("모델명은 필수 입력값입니다.");
 */

// ============================================================================
// 커스텀 에러 클래스 정의
// ============================================================================

/**
 * 애플리케이션 기본 에러 클래스
 *
 * HTTP 상태 코드를 포함하는 확장 에러 클래스입니다.
 * 모든 커스텀 에러 클래스의 기본 클래스로 사용되며,
 * 에러 핸들러에서 상태 코드를 추출하여 HTTP 응답에 사용합니다.
 */
export class AppError extends Error {
  /** HTTP 응답 상태 코드 (예: 400, 404, 500) */
  public readonly statusCode: number;

  /**
   * @param message 에러 메시지 (클라이언트에 전달됨)
   * @param statusCode HTTP 상태 코드 (기본값: 500)
   */
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

/**
 * 리소스 미발견 에러 (HTTP 404)
 *
 * 요청한 리소스(대화방, 메시지, 태스크 등)가 데이터베이스에
 * 존재하지 않을 때 발생시킵니다.
 */
export class NotFoundError extends AppError {
  constructor(message: string = "요청한 리소스를 찾을 수 없습니다.") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/**
 * 인증 실패 에러 (HTTP 401)
 *
 * 세션 토큰이 없거나 만료되었을 때, 또는 로그인 자격 증명이
 * 올바르지 않을 때 발생시킵니다.
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "인증이 필요합니다.") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

/**
 * 입력값 유효성 검증 실패 에러 (HTTP 400)
 *
 * 클라이언트가 전송한 요청 본문이나 쿼리 파라미터가
 * 필수 조건을 충족하지 않을 때 발생시킵니다.
 */
export class ValidationError extends AppError {
  constructor(message: string = "입력값이 유효하지 않습니다.") {
    super(message, 400);
    this.name = "ValidationError";
  }
}

// ============================================================================
// 에러 처리 유틸리티 함수
// ============================================================================

/**
 * 라우트 핸들러의 에러를 일관된 형식으로 변환하는 유틸리티 함수
 *
 * try-catch 블록에서 잡힌 에러를 분석하여 적절한 HTTP 상태 코드와
 * 클라이언트에 전달할 에러 메시지를 추출합니다.
 *
 * AppError 인스턴스인 경우 해당 상태 코드를 사용하고,
 * 일반 Error인 경우 500 상태 코드를 기본값으로 사용합니다.
 *
 * @param error - 처리할 에러 객체 (unknown 타입으로 안전하게 처리)
 * @returns HTTP 상태 코드와 에러 메시지를 포함한 객체
 *
 * @example
 * try {
 *   // 비즈니스 로직
 * } catch (err) {
 *   const { message, status } = handleRouteError(err);
 *   return c.json({ error: message }, status);
 * }
 */
export function handleRouteError(error: unknown): {
  message: string;
  status: number;
} {
  /* AppError 및 하위 클래스인 경우: 정의된 상태 코드와 메시지 사용 */
  if (error instanceof AppError) {
    return { message: error.message, status: error.statusCode };
  }

  /* 일반 Error 인스턴스인 경우: 메시지만 추출하고 500 반환 */
  if (error instanceof Error) {
    return { message: error.message, status: 500 };
  }

  /* 예상치 못한 타입의 에러인 경우: 안전한 기본 메시지 반환 */
  return { message: "알 수 없는 서버 오류가 발생했습니다.", status: 500 };
}
