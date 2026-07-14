// Data Usage State & Network Interceptor
let sessionBytes = 0;
let totalBytes = parseInt(localStorage.getItem("liteai_total_bytes") || "0", 10);

function updateDataUsageDisplay() {
  const sessionEl = document.getElementById("session-data-usage");
  const totalEl = document.getElementById("total-data-usage");
  if (sessionEl) sessionEl.innerText = formatBytes(sessionBytes);
  if (totalEl) totalEl.innerText = formatBytes(totalBytes);
}

function addBytes(bytes: number) {
  if (isNaN(bytes) || bytes <= 0) return;
  sessionBytes += bytes;
  totalBytes += bytes;
  localStorage.setItem("liteai_total_bytes", totalBytes.toString());
  updateDataUsageDisplay();
}

// Track initial page navigation and resource downloads
function trackInitialPerformance() {
  const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  for (const entry of navEntries) {
    const size = entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0;
    addBytes(size);
  }

  const resourceEntries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (const entry of resourceEntries) {
    const size = entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0;
    addBytes(size);
  }
}

// Setup PerformanceObserver to dynamically observe all resource downloads
function setupPerformanceObserver() {
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        const size = (entry as any).transferSize || (entry as any).encodedBodySize || (entry as any).decodedBodySize || 0;
        addBytes(size);
      }
    });
    observer.observe({ entryTypes: ["resource"] });
  } catch (e) {
    console.error("PerformanceObserver not supported or failed to start:", e);
  }
}

// Start tracking immediately
trackInitialPerformance();
setupPerformanceObserver();

// Monkey-patch window.fetch to track UPLOAD data usage and handle auth globally
const originalFetch = window.fetch;
window.fetch = async function (resource, options) {
  let uploadBytes = 0;
  
  if (options && options.body) {
    if (typeof options.body === "string") {
      uploadBytes = new TextEncoder().encode(options.body).length;
    } else if (options.body instanceof Blob) {
      uploadBytes = options.body.size;
    }
  }
  if (uploadBytes > 0 || (options && options.method && options.method !== "GET")) {
    uploadBytes += 200; 
  }
  addBytes(uploadBytes);

  try {
    const response = await originalFetch(resource, options);
    if (response.status === 401) {
      const url = typeof resource === "string" ? resource : (resource as any)?.url || "";
      if (!url.includes("/api/auth/")) {
        showAuthOverlay(false);
      }
    }
    return response;
  } catch (err) {
    throw err;
  }
};

// Application State
let currentConversationId: string | null = null;
let activeEditorFile: string | null = null;
let editorInstance: any = null;
let currentProvider = "ollama";
let currentModel = "llama3";
let activeAgentTaskId: string | null = null;
let agentPollInterval: any = null;
let isSetupMode = false;

// Expose Global App State & Helpers
(window as any).appState = {
  get sessionBytes() { return sessionBytes; },
  set sessionBytes(v) { sessionBytes = v; updateDataUsageDisplay(); },
  get totalBytes() { return totalBytes; },
  set totalBytes(v) { totalBytes = v; updateDataUsageDisplay(); },
  get currentConversationId() { return currentConversationId; },
  set currentConversationId(v) { currentConversationId = v; },
  get activeEditorFile() { return activeEditorFile; },
  set activeEditorFile(v) { activeEditorFile = v; },
  get editorInstance() { return editorInstance; },
  set editorInstance(v) { editorInstance = v; },
  get currentProvider() { return currentProvider; },
  set currentProvider(v) { currentProvider = v; },
  get currentModel() { return currentModel; },
  set currentModel(v) { currentModel = v; },
  get activeAgentTaskId() { return activeAgentTaskId; },
  set activeAgentTaskId(v) { activeAgentTaskId = v; },
  get agentPollInterval() { return agentPollInterval; },
  set agentPollInterval(v) { agentPollInterval = v; },
  get isSetupMode() { return isSetupMode; },
  set isSetupMode(v) { isSetupMode = v; }
};

(window as any).appHelpers = {
  addBytes,
  updateDataUsageDisplay,
  switchView,
  escapeHtml,
  sanitizeHtml,
  formatBytes,
  showAuthOverlay,
  checkAuthStatus,
  loadModule,
  originalFetch
};

// DOM Elements
const sidebarTabs = document.querySelectorAll(".nav-tab");
const tabPanes = document.querySelectorAll(".tab-content");
const viewPanels = document.querySelectorAll(".view-panel");

const logoutBtn = document.getElementById("logout-btn");
const authOverlay = document.getElementById("auth-overlay");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authFormEl = document.getElementById("auth-form-el");
const authUsernameInput = document.getElementById("auth-username") as HTMLInputElement;
const authPasswordInput = document.getElementById("auth-password") as HTMLInputElement;
const authErrorMsg = document.getElementById("auth-error");
const authSubmitBtn = document.getElementById("auth-submit-btn");

// Dynamic Loader Helper
const loadedModules = new Set<string>();
async function loadModule(name: string) {
  if (loadedModules.has(name)) return;
  const manifest = (window as any).assetsManifest || {};
  const fileUrl = manifest[name] || `/assets/${name}.js`;
  
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = fileUrl;
    script.onload = () => {
      loadedModules.add(name);
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load module: ${name}`));
    document.head.appendChild(script);
  });
}

// Tab Switching Routing
function setupTabs() {
  sidebarTabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const targetTab = tab.getAttribute("data-tab");
      
      try {
        if (targetTab === "chat-pane") {
          await loadModule("chat");
          if (typeof (window as any).initChat === "function") (window as any).initChat();
          switchView("view-chat");
        } else if (targetTab === "files-pane") {
          await loadModule("files");
          if (typeof (window as any).initFiles === "function") (window as any).initFiles();
          // files-pane는 view-chat 상태에서 사이드바 내용만 바뀜
          switchView("view-chat");
        } else if (targetTab === "agent-pane") {
          await loadModule("agent");
          if (typeof (window as any).initAgent === "function") (window as any).initAgent();
          switchView("view-agent");
        } else if (targetTab === "settings-pane") {
          await loadModule("settings");
          if (typeof (window as any).initSettings === "function") (window as any).initSettings();
          switchView("view-settings");
        }

        sidebarTabs.forEach((t) => t.classList.remove("active"));
        tabPanes.forEach((p) => p.classList.remove("active"));

        tab.classList.add("active");
        const pane = document.getElementById(`tab-${targetTab}`);
        if (pane) pane.classList.add("active");
      } catch (err) {
        console.error(err);
      }
    });
  });
}

function switchView(viewId: string) {
  viewPanels.forEach((panel) => panel.classList.remove("active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("active");
}

// Global UI Formatting utilities
function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KiB", "MiB", "GiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function escapeHtml(text: string) {
  const map: any = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function sanitizeHtml(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  
  const allowedTags = new Set([
    "a", "p", "br", "pre", "code", "ul", "ol", "li", "span", "div",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "strong", "em", "del",
    "table", "thead", "tbody", "tr", "th", "td", "details", "summary", "img"
  ]);

  const allowedAttributes = new Set(["href", "src", "alt", "title", "class", "style", "target"]);

  function cleanNode(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      if (!allowedTags.has(tagName)) {
        node.parentNode?.removeChild(node);
        return;
      }
      
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        const attrName = attr.name.toLowerCase();
        if (attrName === "href" || attrName === "src") {
          const val = attr.value.trim().toLowerCase();
          if (val.startsWith("javascript:") || val.startsWith("data:")) {
            el.removeAttribute(attr.name);
            continue;
          }
        }
        
        if (attrName.startsWith("on") || !allowedAttributes.has(attrName)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    
    const children = Array.from(node.childNodes);
    for (const child of children) {
      cleanNode(child);
    }
  }
  
  const children = Array.from(doc.body.childNodes);
  for (const child of children) {
    cleanNode(child);
  }
  return doc.body.innerHTML;
}

// --- Authentication UI & State Handlers ---
async function checkAuthStatus() {
  try {
    const res = await originalFetch("/api/auth/status");
    if (!res.ok) throw new Error("Auth status check failed");
    
    const data = await res.json();
    if (data.loggedIn) {
      if (authOverlay) authOverlay.classList.remove("active");
      if (logoutBtn) logoutBtn.style.display = "block";
      return true;
    } else {
      isSetupMode = !!data.setupRequired;
      showAuthOverlay(isSetupMode);
      return false;
    }
  } catch (err) {
    console.error("Auth status check error:", err);
    showAuthOverlay(false);
    return false;
  }
}

function showAuthOverlay(setupMode: boolean) {
  isSetupMode = setupMode;
  if (authOverlay) authOverlay.classList.add("active");
  if (logoutBtn) logoutBtn.style.display = "none";
  if (authErrorMsg) authErrorMsg.style.display = "none";
  if (authUsernameInput) authUsernameInput.value = "";
  if (authPasswordInput) authPasswordInput.value = "";
  
  if (setupMode) {
    if (authTitle) authTitle.innerText = "LiteAI 관리자 설정";
    if (authSubtitle) authSubtitle.innerText = "첫 접속입니다. 관리자 계정을 설정하여 시스템을 시작하세요.";
    if (authSubmitBtn) authSubmitBtn.innerText = "관리자 계정 생성";
  } else {
    if (authTitle) authTitle.innerText = "LiteAI 로그인";
    if (authSubtitle) authSubtitle.innerText = "계정 정보를 입력하여 접근하세요.";
    if (authSubmitBtn) authSubmitBtn.innerText = "로그인";
  }
}

function setupAuthHandlers() {
  if (authFormEl) {
    authFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = authUsernameInput.value.trim();
      const password = authPasswordInput.value;
      
      if (authErrorMsg) authErrorMsg.style.display = "none";
      if (authSubmitBtn) {
        authSubmitBtn.setAttribute("disabled", "true");
        authSubmitBtn.innerText = isSetupMode ? "생성 중..." : "로그인 중...";
      }
      
      const endpoint = isSetupMode ? "/api/auth/setup" : "/api/auth/login";
      try {
        const res = await originalFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "처리 중 오류가 발생했습니다.");
        }
        
        if (authOverlay) authOverlay.classList.remove("active");
        if (logoutBtn) logoutBtn.style.display = "block";
        
        // 로그인 성공 시 기본 탭 모듈 활성화
        await loadModule("chat");
        if (typeof (window as any).initChat === "function") (window as any).initChat();
      } catch (err: any) {
        if (authErrorMsg) {
          authErrorMsg.innerText = err.message;
          authErrorMsg.style.display = "block";
        }
      } finally {
        if (authSubmitBtn) {
          authSubmitBtn.removeAttribute("disabled");
          authSubmitBtn.innerText = isSetupMode ? "관리자 계정 생성" : "로그인";
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (!confirm("정말로 로그아웃 하시겠습니까?")) return;
      try {
        await originalFetch("/api/auth/logout", { method: "POST" });
        
        // Clear app state
        currentConversationId = null;
        activeEditorFile = null;
        activeAgentTaskId = null;
        if (agentPollInterval) clearInterval(agentPollInterval);
        
        const chatMessages = document.getElementById("chat-messages");
        if (chatMessages) {
          chatMessages.innerHTML = `
            <div class="welcome-screen">
              <h3>저대역폭 모던 AI 채팅 서비스</h3>
              <p>모든 메시지는 로컬 Bun SQLite 데이터베이스에 직접 저장됩니다. 텍스트 버퍼 전송을 최소화하고, Markdown 및 Code Editor 등 무거운 모듈은 클라이언트가 요청하는 즉시 CDN을 통해 비동기식으로 가져옵니다.</p>
            </div>`;
        }
        
        const chatTitle = document.getElementById("chat-title");
        if (chatTitle) chatTitle.innerText = "LiteAI 워크스페이스";
        const chatModelInfo = document.getElementById("chat-model-info");
        if (chatModelInfo) chatModelInfo.innerText = "새 대화를 개설하거나 기존 대화를 선택해 주세요.";
        
        const selectorContainer = document.getElementById("chat-selector-container");
        if (selectorContainer) selectorContainer.style.display = "none";
        
        const deleteChatBtn = document.getElementById("delete-chat-btn");
        if (deleteChatBtn) deleteChatBtn.style.display = "none";
        
        const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
        const sendBtn = document.getElementById("send-btn");
        if (chatInput) chatInput.disabled = true;
        if (sendBtn) sendBtn.setAttribute("disabled", "true");
        
        showAuthOverlay(false);
      } catch (err: any) {
        alert("로그아웃에 실패했습니다: " + err.message);
      }
    });
  }
}

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupAuthHandlers();

  // Reset button event listener
  document.getElementById("reset-data-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    sessionBytes = 0;
    totalBytes = 0;
    localStorage.setItem("liteai_total_bytes", "0");
    updateDataUsageDisplay();
  });
  updateDataUsageDisplay();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    // 첫 로드 시 대화 모듈을 활성화합니다.
    await loadModule("chat");
    if (typeof (window as any).initChat === "function") (window as any).initChat();
  }
});
