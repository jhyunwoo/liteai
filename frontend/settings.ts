// 4. CONFIG CONFIGURATION LOGIC
const state = (window as any).appState;
const helpers = (window as any).appHelpers;

let settingsInitialized = false;

// Model presets dictionary for quick dropdown lookup
const settingsModelPresets: any = {
  ollama: ["llama3", "llama3.1", "llama3.2", "llama3.3", "gemma2", "mistral", "qwen2.5", "deepseek-r1"],
  gemini: ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash", "gemini-1.5-pro"],
  openrouter: ["google/gemini-3.5-flash", "google/gemini-3.5-pro", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it", "deepseek-r1-distill-llama-70b"],
  cerebras: ["llama3.3-70b", "llama3.1-8b", "llama3.1-70b"],
  cloudflare: ["@cf/meta/llama-3.3-70b-instruct", "@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3-8b-instruct", "@cf/mistral/mistral-7b-instruct-v0.1", "@cf/qwen/qwen1.5-7b-chat", "@cf/deepseek-ai/deepseek-r1-distill-qwen-1.5b"]
};

const saveConfigBtn = document.getElementById("save-config-btn") as HTMLButtonElement;
const configStatusMsg = document.getElementById("config-status-msg") as HTMLSpanElement;
const settingProvider = document.getElementById("setting-provider") as HTMLSelectElement;
const settingModelSelect = document.getElementById("setting-model-select") as HTMLSelectElement;
const settingModelCustom = document.getElementById("setting-model-custom") as HTMLInputElement;
const settingModelCustomToggle = document.getElementById("setting-model-custom-toggle") as HTMLInputElement;
const settingSystemPrompt = document.getElementById("setting-system-prompt") as HTMLTextAreaElement;
const settingOllamaUrl = document.getElementById("setting-ollama-url") as HTMLInputElement;
const settingOllamaKey = document.getElementById("setting-ollama-key") as HTMLInputElement;
const settingGroqKey = document.getElementById("setting-groq-key") as HTMLInputElement;
const settingCerebrasKey = document.getElementById("setting-cerebras-key") as HTMLInputElement;
const settingCloudflareAccount = document.getElementById("setting-cloudflare-account") as HTMLInputElement;
const settingCloudflareToken = document.getElementById("setting-cloudflare-token") as HTMLInputElement;
const settingGeminiKey = document.getElementById("setting-gemini-key") as HTMLInputElement;
const settingGeminiSearch = document.getElementById("setting-gemini-search") as HTMLInputElement;
const settingOpenRouterKey = document.getElementById("setting-openrouter-key") as HTMLInputElement;
const settingSearchProvider = document.getElementById("setting-search-provider") as HTMLSelectElement;
const settingBraveKey = document.getElementById("setting-brave-key") as HTMLInputElement;
const settingSerperKey = document.getElementById("setting-serper-key") as HTMLInputElement;
const settingSearxngUrl = document.getElementById("setting-searxng-url") as HTMLInputElement;
const settingMcpServers = document.getElementById("setting-mcp-servers") as HTMLTextAreaElement;

const currentProviderBadge = document.getElementById("current-provider-badge") as HTMLSpanElement;
const currentModelBadge = document.getElementById("current-model-badge") as HTMLSpanElement;

async function updateSettingsModelDatalist(provider: string, selectId: string) {
  const selectEl = document.getElementById(selectId) as HTMLSelectElement;
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">모델 불러오는 중...</option>`;
  
  try {
    const res = await helpers.originalFetch(`/api/models?provider=${provider}`);
    if (!res.ok) throw new Error("API failed");
    const models = await res.json();
    
    selectEl.innerHTML = "";
    if (models.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.innerText = "사용 가능한 모델 없음";
      selectEl.appendChild(option);
      return;
    }
    
    models.forEach((model: string) => {
      const option = document.createElement("option");
      option.value = model;
      option.innerText = model;
      selectEl.appendChild(option);
    });
  } catch (err) {
    selectEl.innerHTML = "";
    const models = settingsModelPresets[provider] || [];
    models.forEach((model: string) => {
      const option = document.createElement("option");
      option.value = model;
      option.innerText = model;
      selectEl.appendChild(option);
    });
  }
}

function setupConfigHandlers() {
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener("click", async () => {
      saveConfigBtn.disabled = true;
      saveConfigBtn.innerText = "설정 저장 중...";
      if (configStatusMsg) configStatusMsg.innerText = "";

      const activeModelVal = settingModelCustomToggle.checked
        ? settingModelCustom.value.trim()
        : settingModelSelect.value;

      const basicConfig = {
        active_provider: settingProvider.value,
        active_model: activeModelVal,
        default_system_prompt: settingSystemPrompt.value.trim(),
        ollama_url: settingOllamaUrl.value.trim(),
        ollama_api_key: settingOllamaKey.value.trim(),
        groq_api_key: settingGroqKey.value.trim(),
        cerebras_api_key: settingCerebrasKey.value.trim(),
        cloudflare_account_id: settingCloudflareAccount.value.trim(),
        cloudflare_api_token: settingCloudflareToken.value.trim(),
        gemini_api_key: settingGeminiKey.value.trim(),
        gemini_search_grounding: settingGeminiSearch.checked ? "true" : "false",
        openrouter_api_key: settingOpenRouterKey.value.trim(),
        search_provider: settingSearchProvider.value,
        brave_search_key: settingBraveKey.value.trim(),
        serper_api_key: settingSerperKey.value.trim(),
        searxng_url: settingSearxngUrl.value.trim(),
      };

      let mcpConfig = {};
      try {
        mcpConfig = JSON.parse(settingMcpServers.value.trim() || "{}");
      } catch (e: any) {
        alert("MCP 구성의 JSON 구문 오류: " + e.message);
        saveConfigBtn.disabled = false;
        saveConfigBtn.innerText = "설정 저장 및 업데이트";
        return;
      }

      try {
        const res1 = await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basicConfig),
        });
        if (!res1.ok) throw new Error("인증 키 저장에 실패했습니다.");

        const res2 = await fetch("/api/config/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mcpConfig),
        });
        if (!res2.ok) throw new Error("MCP 설정 저장에 실패했습니다.");

        state.currentProvider = basicConfig.active_provider;
        state.currentModel = basicConfig.active_model;
        if (currentProviderBadge) currentProviderBadge.innerText = state.currentProvider;
        if (currentModelBadge) currentModelBadge.innerText = state.currentModel;

        if (configStatusMsg) configStatusMsg.innerText = "설정이 저장되었습니다!";
        setTimeout(() => {
          if (configStatusMsg) configStatusMsg.innerText = "";
        }, 3000);
      } catch (err: any) {
        alert("설정 저장에 실패했습니다: " + err.message);
      } finally {
        saveConfigBtn.disabled = false;
        saveConfigBtn.innerText = "설정 저장 및 업데이트";
      }
    });
  }

  if (settingProvider) {
    settingProvider.addEventListener("change", async () => {
      await updateSettingsModelDatalist(settingProvider.value, "setting-model-select");
      const presets = settingsModelPresets[settingProvider.value] || [];
      if (presets.length > 0 && settingModelSelect) {
        settingModelSelect.value = presets[0];
      }
    });
  }

  if (settingModelCustomToggle) {
    settingModelCustomToggle.addEventListener("change", () => {
      const isCustom = settingModelCustomToggle.checked;
      if (settingModelSelect) settingModelSelect.style.display = isCustom ? "none" : "block";
      if (settingModelCustom) settingModelCustom.style.display = isCustom ? "block" : "none";
    });
  }
}

async function loadConfig() {
  try {
    const [res1, res2] = await Promise.all([
      fetch("/api/config"),
      fetch("/api/config/mcp")
    ]);
    const basic = await res1.json();
    const mcp = await res2.json();

    const activeProvider = basic.active_provider || "ollama";
    const activeModel = basic.active_model || "llama3";

    if (settingProvider) settingProvider.value = activeProvider;
    
    await updateSettingsModelDatalist(activeProvider, "setting-model-select");
    const presets = settingsModelPresets[activeProvider] || [];
    const isCustom = !presets.includes(activeModel);

    if (settingModelCustomToggle) settingModelCustomToggle.checked = isCustom;
    if (settingModelSelect) {
      settingModelSelect.style.display = isCustom ? "none" : "block";
      if (!isCustom) settingModelSelect.value = activeModel;
    }
    if (settingModelCustom) {
      settingModelCustom.style.display = isCustom ? "block" : "none";
      settingModelCustom.value = activeModel;
    }

    if (settingSystemPrompt) settingSystemPrompt.value = basic.default_system_prompt || "";
    if (settingOllamaUrl) settingOllamaUrl.value = basic.ollama_url || "http://localhost:11434";
    if (settingOllamaKey) settingOllamaKey.value = basic.ollama_api_key || "";
    if (settingGroqKey) settingGroqKey.value = basic.groq_api_key || "";
    if (settingCerebrasKey) settingCerebrasKey.value = basic.cerebras_api_key || "";
    if (settingCloudflareAccount) settingCloudflareAccount.value = basic.cloudflare_account_id || "";
    if (settingCloudflareToken) settingCloudflareToken.value = basic.cloudflare_api_token || "";
    if (settingGeminiKey) settingGeminiKey.value = basic.gemini_api_key || "";
    if (settingGeminiSearch) settingGeminiSearch.checked = basic.gemini_search_grounding === "true";
    if (settingOpenRouterKey) settingOpenRouterKey.value = basic.openrouter_api_key || "";
    if (settingSearchProvider) settingSearchProvider.value = basic.search_provider || "duckduckgo";
    if (settingBraveKey) settingBraveKey.value = basic.brave_search_key || "";
    if (settingSerperKey) settingSerperKey.value = basic.serper_api_key || "";
    if (settingSearxngUrl) settingSearxngUrl.value = basic.searxng_url || "";

    state.currentProvider = activeProvider;
    state.currentModel = activeModel;
    if (currentProviderBadge) currentProviderBadge.innerText = state.currentProvider;
    if (currentModelBadge) currentModelBadge.innerText = state.currentModel;

    if (settingMcpServers) settingMcpServers.value = JSON.stringify(mcp, null, 2);
  } catch (err) {
    console.error("설정을 불러오지 못했습니다:", err);
  }
}

// Expose Settings initialization function
(window as any).initSettings = function() {
  if (settingsInitialized) return;
  settingsInitialized = true;
  setupConfigHandlers();
  loadConfig();
};
