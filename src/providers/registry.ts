/**
 * @module providers/registry
 * @description LLM 프로바이더 레지스트리 (팩토리 패턴)
 *
 * 프로바이더 이름으로 해당 LLMProvider 인스턴스를 반환하는 팩토리 함수를 제공합니다.
 * 싱글톤 패턴으로 각 프로바이더 인스턴스를 캐싱하여 불필요한 객체 생성을 방지합니다.
 *
 * 새로운 프로바이더를 추가하려면:
 * 1. providers/ 디렉토리에 새 프로바이더 클래스 생성
 * 2. 이 파일의 PROVIDER_MAP에 매핑 추가
 * 3. types/index.ts의 ProviderName 타입에 이름 추가
 */

import type { ProviderName } from "../types";
import type { LLMProvider } from "./base.provider";
import { OllamaProvider } from "./ollama.provider";
import { GeminiProvider } from "./gemini.provider";
import { GroqProvider } from "./groq.provider";
import { CerebrasProvider } from "./cerebras.provider";
import { CloudflareProvider } from "./cloudflare.provider";
import { OpenRouterProvider } from "./openrouter.provider";

/**
 * 프로바이더 이름 → 생성자 매핑 테이블
 *
 * 각 프로바이더의 클래스 생성자를 등록하여
 * 이름 기반으로 인스턴스를 동적 생성할 수 있도록 합니다.
 */
const PROVIDER_MAP: Record<ProviderName, new () => LLMProvider> = {
  ollama: OllamaProvider,
  gemini: GeminiProvider,
  groq: GroqProvider,
  cerebras: CerebrasProvider,
  cloudflare: CloudflareProvider,
  openrouter: OpenRouterProvider,
};

/**
 * 생성된 프로바이더 인스턴스 캐시 (싱글톤)
 *
 * 동일한 프로바이더에 대한 반복 호출 시
 * 매번 새 인스턴스를 생성하지 않고 캐시된 인스턴스를 반환합니다.
 */
const providerInstances = new Map<ProviderName, LLMProvider>();

/**
 * 프로바이더 이름으로 LLMProvider 인스턴스를 반환합니다.
 *
 * 최초 호출 시 프로바이더 인스턴스를 생성하고 캐시하며,
 * 이후 호출에서는 캐시된 인스턴스를 반환합니다 (싱글톤 패턴).
 *
 * @param name - 프로바이더 이름 (ProviderName 타입)
 * @returns 해당 프로바이더의 LLMProvider 인스턴스
 * @throws {Error} 지원하지 않는 프로바이더 이름인 경우
 *
 * @example
 * const provider = getProvider("gemini");
 * const stream = await provider.streamChat("gemini-2.0-flash", messages, systemPrompt);
 */
export function getProvider(name: ProviderName): LLMProvider {
  let instance = providerInstances.get(name);
  if (!instance) {
    const ProviderClass = PROVIDER_MAP[name];
    if (!ProviderClass) {
      throw new Error(`Unsupported provider: ${name}`);
    }
    instance = new ProviderClass();
    providerInstances.set(name, instance);
  }
  return instance;
}
