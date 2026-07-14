// 1. CHAT MODULE LOGIC
const state = (window as any).appState;
const helpers = (window as any).appHelpers;

let chatInitialized = false;

// Model presets dictionary for quick dropdown lookup in Chat selector
const chatModelPresets: any = {
  ollama: ["llama3", "llama3.1", "llama3.2", "llama3.3", "gemma2", "mistral", "qwen2.5", "deepseek-r1"],
  gemini: ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash", "gemini-1.5-pro"],
  openrouter: ["google/gemini-3.5-flash", "google/gemini-3.5-pro", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it", "deepseek-r1-distill-llama-70b"],
  cerebras: ["llama3.3-70b", "llama3.1-8b", "llama3.1-70b"],
  cloudflare: ["@cf/meta/llama-3.3-70b-instruct", "@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3-8b-instruct", "@cf/mistral/mistral-7b-instruct-v0.1", "@cf/qwen/qwen1.5-7b-chat", "@cf/deepseek-ai/deepseek-r1-distill-qwen-1.5b"]
};

// Dynamic dropdown loader
async function updateChatModelDatalist(provider: string, selectId: string) {
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
    const models = chatModelPresets[provider] || [];
    models.forEach((model: string) => {
      const option = document.createElement("option");
      option.value = model;
      option.innerText = model;
      selectEl.appendChild(option);
    });
  }
}

// Global marked dynamic loader
function loadMarked(callback: () => void) {
  if ((window as any).marked) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "/libs/marked.min.js";
  script.onload = () => {
    (window as any).marked.setOptions({
      gfm: true,
      breaks: true,
    });
    callback();
  };
  document.head.appendChild(script);
}

const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const chatMessages = document.getElementById("chat-messages") as HTMLDivElement;
const newChatBtn = document.getElementById("new-chat-btn") as HTMLButtonElement;
const deleteChatBtn = document.getElementById("delete-chat-btn") as HTMLButtonElement;
const chatTitle = document.getElementById("chat-title") as HTMLHeadingElement;
const chatModelInfo = document.getElementById("chat-model-info") as HTMLParagraphElement;
const chatList = document.getElementById("chat-list") as HTMLUListElement;

function setupChatHandlers() {
  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !state.currentConversationId) return;

      chatInput.value = "";
      chatInput.style.height = "auto";
      appendMessage("user", text);

      chatInput.disabled = true;
      if (sendBtn) sendBtn.disabled = true;

      const assistantBubble = appendMessage("assistant", "생각 중...");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: state.currentConversationId,
            message: text,
            webSearch: (document.getElementById("chat-web-search-toggle") as HTMLInputElement)?.checked || false,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let streamText = "";
        assistantBubble.innerHTML = ""; // Clear loader text

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamText += decoder.decode(value, { stream: true });
          renderMarkdownBubble(assistantBubble, streamText);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      } catch (err: any) {
        console.error(err);
        assistantBubble.innerHTML = `<span style="color: var(--color-danger)">오류: ${err.message}</span>`;
      } finally {
        chatInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        chatInput.focus();
      }
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event("submit"));
      }
    });

    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = `${chatInput.scrollHeight}px`;
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", async () => {
      const title = prompt("대화방 제목을 입력하세요 (공란 가능):") || "새 대화";
      try {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            provider: state.currentProvider,
            model: state.currentModel,
            systemPrompt: (document.getElementById("setting-system-prompt") as HTMLTextAreaElement)?.value.trim() || null,
          }),
        });

        const newConv = await response.json();
        await loadConversations();
        selectConversation(newConv.id);
      } catch (err: any) {
        alert("대화방 생성에 실패했습니다: " + err.message);
      }
    });
  }

  if (deleteChatBtn) {
    deleteChatBtn.addEventListener("click", async () => {
      if (!state.currentConversationId || !confirm("정말로 이 대화를 삭제하시겠습니까?")) return;
      try {
        await fetch(`/api/conversations/${state.currentConversationId}`, { method: "DELETE" });
        state.currentConversationId = null;
        chatTitle.innerText = "LiteAI 워크스페이스";
        chatModelInfo.innerText = "새 대화를 개설하거나 기존 대화를 선택해 주세요.";
        const selectorContainer = document.getElementById("chat-selector-container");
        if (selectorContainer) selectorContainer.style.display = "none";
        chatMessages.innerHTML = `
          <div class="welcome-screen">
            <h3>저대역폭 모던 AI 채팅 서비스</h3>
            <p>모든 메시지는 로컬 Bun SQLite 데이터베이스에 직접 저장됩니다. 텍스트 버퍼 전송을 최소화하고, Markdown 및 Code Editor 등 무거운 모듈은 클라이언트가 요청하는 즉시 CDN을 통해 비동기식으로 가져옵니다.</p>
          </div>`;
        deleteChatBtn.style.display = "none";
        chatInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        await loadConversations();
      } catch (err: any) {
        alert("대화 삭제에 실패했습니다: " + err.message);
      }
    });
  }

  document.getElementById("quick-start-btn")?.addEventListener("click", () => {
    if (newChatBtn) newChatBtn.click();
  });

  if (chatMessages) {
    chatMessages.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest("a");
      if (link) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
  }
}

async function loadConversations() {
  if (!chatList) return;
  try {
    const response = await fetch("/api/conversations");
    const data = await response.json();
    chatList.innerHTML = "";

    if (data.length === 0) {
      chatList.innerHTML = `<li class="loading-placeholder">개설된 대화방이 없습니다.</li>`;
      return;
    }

    data.forEach((conv: any) => {
      const li = document.createElement("li");
      li.className = conv.id === state.currentConversationId ? "active" : "";
      li.innerHTML = `
        <div style="font-weight: 600;">${helpers.escapeHtml(conv.title)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">${conv.provider}/${conv.model}</div>
      `;
      li.addEventListener("click", () => {
        selectConversation(conv.id);
        helpers.switchView("view-chat");
        document.querySelectorAll("#chat-list li").forEach((el) => el.classList.remove("active"));
        li.classList.add("active");
      });
      chatList.appendChild(li);
    });
  } catch (err) {
    chatList.innerHTML = `<li class="loading-placeholder" style="color: var(--color-danger)">목록 조회 실패</li>`;
  }
}

async function selectConversation(id: string) {
  state.currentConversationId = id;
  if (chatMessages) chatMessages.innerHTML = `<div class="loading-placeholder">대화 기록을 로딩 중...</div>`;
  if (deleteChatBtn) deleteChatBtn.style.display = "block";
  if (chatInput) chatInput.disabled = false;
  if (sendBtn) sendBtn.disabled = false;

  try {
    const response = await fetch(`/api/conversations/${id}`);
    const conv = await response.json();

    if (chatTitle) chatTitle.innerText = conv.title;
    if (chatModelInfo) chatModelInfo.innerText = `동작 플랫폼: ${conv.provider} / 모델: ${conv.model}`;

    const selectorContainer = document.getElementById("chat-selector-container");
    const chatProviderSelect = document.getElementById("chat-provider-select") as HTMLSelectElement;
    const chatModelSelect = document.getElementById("chat-model-select") as HTMLSelectElement;
    const chatModelCustom = document.getElementById("chat-model-custom") as HTMLInputElement;
    const chatModelCustomToggle = document.getElementById("chat-model-custom-toggle") as HTMLInputElement;

    if (selectorContainer) {
      selectorContainer.style.display = "flex";
    }
    if (chatProviderSelect) {
      chatProviderSelect.value = conv.provider;
      await updateChatModelDatalist(conv.provider, "chat-model-select");
    }

    const presets = chatModelPresets[conv.provider] || [];
    const isCustom = !presets.includes(conv.model);

    if (chatModelCustomToggle) {
      chatModelCustomToggle.checked = isCustom;
    }
    if (chatModelSelect) {
      chatModelSelect.style.display = isCustom ? "none" : "block";
      if (!isCustom) chatModelSelect.value = conv.model;
    }
    if (chatModelCustom) {
      chatModelCustom.style.display = isCustom ? "block" : "none";
      chatModelCustom.value = conv.model;
    }

    if (chatMessages) {
      chatMessages.innerHTML = "";
      if (conv.messages.length === 0) {
        chatMessages.innerHTML = `<div class="loading-placeholder">메시지를 입력하여 대화를 시작해 보세요.</div>`;
      } else {
        conv.messages.forEach((msg: any) => {
          appendMessage(msg.role, msg.content);
        });
      }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (err) {
    if (chatMessages) chatMessages.innerHTML = `<div class="loading-placeholder" style="color: var(--color-danger)">대화 기록 로드 실패</div>`;
  }
}

function appendMessage(role: string, content: string) {
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  
  if (role === "assistant") {
    renderMarkdownBubble(bubble, content);
  } else {
    bubble.innerText = content;
  }
  
  if (chatMessages) {
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  return bubble;
}

function renderMarkdownBubble(element: HTMLElement, markdownText: string) {
  loadMarked(() => {
    if ((window as any).marked) {
      const parsedHtml = (window as any).marked.parse(markdownText);
      element.innerHTML = helpers.sanitizeHtml(parsedHtml);
    } else {
      element.innerText = markdownText;
    }
  });
}

// Provider & Custom Toggle setup for chat model change toolbar
function setupModelChangeToolbar() {
  const chatProviderSelect = document.getElementById("chat-provider-select") as HTMLSelectElement;
  const chatModelSelect = document.getElementById("chat-model-select") as HTMLSelectElement;
  const chatModelCustom = document.getElementById("chat-model-custom") as HTMLInputElement;
  const chatModelCustomToggle = document.getElementById("chat-model-custom-toggle") as HTMLInputElement;
  const chatModelUpdateBtn = document.getElementById("chat-model-update-btn") as HTMLButtonElement;

  if (chatProviderSelect) {
    chatProviderSelect.addEventListener("change", async () => {
      await updateChatModelDatalist(chatProviderSelect.value, "chat-model-select");
      const presets = chatModelPresets[chatProviderSelect.value] || [];
      if (presets.length > 0 && chatModelSelect) {
        chatModelSelect.value = presets[0];
      }
    });
  }

  if (chatModelCustomToggle) {
    chatModelCustomToggle.addEventListener("change", () => {
      const isCustom = chatModelCustomToggle.checked;
      if (chatModelSelect) chatModelSelect.style.display = isCustom ? "none" : "block";
      if (chatModelCustom) chatModelCustom.style.display = isCustom ? "block" : "none";
    });
  }

  if (chatModelUpdateBtn) {
    chatModelUpdateBtn.addEventListener("click", async () => {
      if (!state.currentConversationId) return;
      const provider = chatProviderSelect.value;
      const model = chatModelCustomToggle.checked
        ? chatModelCustom.value.trim()
        : (chatModelSelect ? chatModelSelect.value : "");

      if (!model) {
        alert("모델명을 선택하거나 직접 입력해 주세요.");
        return;
      }

      chatModelUpdateBtn.disabled = true;
      chatModelUpdateBtn.innerText = "변경 중...";
      try {
        const response = await fetch(`/api/conversations/${state.currentConversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, model }),
        });
        if (!response.ok) throw new Error(await response.text());
        
        if (chatModelInfo) chatModelInfo.innerText = `동작 플랫폼: ${provider} / 모델: ${model}`;
        await loadConversations();
        alert("대화 모델 정보가 정상적으로 변경되었습니다!");
      } catch (err: any) {
        alert("모델 변경에 실패했습니다: " + err.message);
      } finally {
        chatModelUpdateBtn.disabled = false;
        chatModelUpdateBtn.innerText = "변경 적용";
      }
    });
  }
}

// Expose Chat initialization function
(window as any).initChat = function() {
  if (chatInitialized) return;
  chatInitialized = true;
  setupChatHandlers();
  setupModelChangeToolbar();
  loadConversations();
};
