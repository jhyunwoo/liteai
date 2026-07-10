/**
 * @module routes/model.routes
 * @description 모델 목록 조회 API 라우트
 *
 * 프로바이더별 사용 가능한 LLM 모델 목록을 동적으로 조회합니다.
 * Strategy 패턴의 getProvider()를 활용하여 기존의
 * 거대한 if-else 체인을 단 몇 줄로 대체합니다.
 */

import { Hono } from "hono";
import { getProvider } from "../providers";
import { MODEL_PRESETS } from "../config/constants";
import type { ProviderName } from "../types";

export const modelRoutes = new Hono();

/**
 * GET / - 프로바이더별 모델 목록 조회
 *
 * 프로바이더의 listModels() API를 호출하여 실시간 모델 목록을 반환합니다.
 * API 호출이 실패하면 MODEL_PRESETS의 정적 프리셋을 폴백으로 사용합니다.
 */
modelRoutes.get("/", async (c) => {
  const provider = c.req.query("provider") as ProviderName | undefined;
  if (!provider) return c.json({ error: "Provider is required" }, 400);

  try {
    const providerInstance = getProvider(provider);
    const models = await providerInstance.listModels();
    if (models.length > 0) return c.json(models);
  } catch (err: unknown) {
    console.error(`Failed to fetch dynamic models for ${provider}:`, (err as Error).message);
  }

  /* API 조회 실패 시 정적 프리셋으로 폴백 */
  return c.json(MODEL_PRESETS[provider] || []);
});
