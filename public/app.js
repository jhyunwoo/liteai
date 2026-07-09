// Data Usage State & Network Interceptor
let sessionBytes = 0;
let totalBytes = parseInt(localStorage.getItem("liteai_total_bytes") || "0", 10);

function updateDataUsageDisplay() {
  const sessionEl = document.getElementById("session-data-usage");
  const totalEl = document.getElementById("total-data-usage");
  if (sessionEl) sessionEl.innerText = formatBytes(sessionBytes);
  if (totalEl) totalEl.innerText = formatBytes(totalBytes);
}

function addBytes(bytes) {
  if (isNaN(bytes) || bytes <= 0) return;
  sessionBytes += bytes;
  totalBytes += bytes;
  localStorage.setItem("liteai_total_bytes", totalBytes.toString());
  updateDataUsageDisplay();
}

// Monkey-patch window.fetch to track data usage globally
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
  uploadBytes += 200; // estimated headers overhead
  addBytes(uploadBytes);

  try {
    const response = await originalFetch(resource, options);
    const clonedResponse = response.clone();
    const contentType = response.headers.get("content-type") || "";
    const isStream = contentType.includes("text/event-stream") || 
                     contentType.includes("application/octet-stream") ||
                     (typeof resource === "string" && resource.includes("/api/chat"));

    if (isStream) {
      const originalBody = response.body;
      if (originalBody) {
        const reader = originalBody.getReader();
        const newStream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  break;
                }
                if (value) {
                  addBytes(value.byteLength);
                  controller.enqueue(value);
                }
              }
            } catch (e) {
              controller.error(e);
            }
          }
        });
        const customResponse = new Response(newStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        Object.defineProperty(customResponse, "url", { value: response.url });
        return customResponse;
      }
    } else {
      clonedResponse.text().then((text) => {
        const downloadBytes = new TextEncoder().encode(text).length;
        addBytes(downloadBytes);
      }).catch(() => {});
    }

    return response;
  } catch (err) {
    throw err;
  }
};

// Application State
let currentConversationId = null;
let activeEditorFile = null;
let editorInstance = null;
let currentProvider = "ollama";
let currentModel = "llama3";
let activeAgentTaskId = null;
let agentPollInterval = null;

// DOM Elements
const sidebarTabs = document.querySelectorAll(".nav-tab");
const tabPanes = document.querySelectorAll(".tab-content");
const viewPanels = document.querySelectorAll(".view-panel");

const chatList = document.getElementById("chat-list");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatForm = document.getElementById("chat-form");
const sendBtn = document.getElementById("send-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const deleteChatBtn = document.getElementById("delete-chat-btn");
const chatTitle = document.getElementById("chat-title");
const chatModelInfo = document.getElementById("chat-model-info");

const fileTree = document.getElementById("file-tree");
const refreshFilesBtn = document.getElementById("refresh-files-btn");
const newFileBtn = document.getElementById("new-file-btn");
const newFolderBtn = document.getElementById("new-folder-btn");

const editorFilename = document.getElementById("editor-filename");
const editorFilepath = document.getElementById("editor-filepath");
const editorSaveBtn = document.getElementById("editor-save-btn");
const editorCloseBtn = document.getElementById("editor-close-btn");
const editorLoading = document.getElementById("editor-loading");

const agentTaskInput = document.getElementById("agent-task-input");
const startAgentBtn = document.getElementById("start-agent-btn");
const agentActiveTask = document.getElementById("agent-active-task");
const agentTaskStatus = document.getElementById("agent-task-status");
const agentTaskLogs = document.getElementById("agent-task-logs");
const refreshAgentBtn = document.getElementById("refresh-agent-btn");
const taskList = document.getElementById("task-list");
const newAgentTaskBtn = document.getElementById("new-agent-task-btn");

const saveConfigBtn = document.getElementById("save-config-btn");
const configStatusMsg = document.getElementById("config-status-msg");
const settingProvider = document.getElementById("setting-provider");
const settingModel = document.getElementById("setting-model");
const settingSystemPrompt = document.getElementById("setting-system-prompt");
const settingOllamaUrl = document.getElementById("setting-ollama-url");
const settingOllamaKey = document.getElementById("setting-ollama-key");
const settingGroqKey = document.getElementById("setting-groq-key");
const settingCerebrasKey = document.getElementById("setting-cerebras-key");
const settingCloudflareAccount = document.getElementById("setting-cloudflare-account");
const settingCloudflareToken = document.getElementById("setting-cloudflare-token");
const settingGeminiKey = document.getElementById("setting-gemini-key");
const settingGeminiSearch = document.getElementById("setting-gemini-search");
const settingOpenRouterKey = document.getElementById("setting-openrouter-key");
const settingSearchProvider = document.getElementById("setting-search-provider");
const settingBraveKey = document.getElementById("setting-brave-key");
const settingSearxngUrl = document.getElementById("setting-searxng-url");
const settingMcpServers = document.getElementById("setting-mcp-servers");

const currentProviderBadge = document.getElementById("current-provider-badge");
const currentModelBadge = document.getElementById("current-model-badge");

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupChatHandlers();
  setupFileHandlers();
  setupConfigHandlers();
  setupAgentHandlers();

  // Reset button event listener
  document.getElementById("reset-data-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    sessionBytes = 0;
    totalBytes = 0;
    localStorage.setItem("liteai_total_bytes", "0");
    updateDataUsageDisplay();
  });
  updateDataUsageDisplay();

  // Load initial settings, conversations, and files
  await loadConfig();
  await loadConversations();
  await loadFiles();
  await loadAgentTasks();
});

// Dynamic Loader Helpers
function loadMarked(callback) {
  if (window.marked) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
  script.onload = () => {
    window.marked.setOptions({
      gfm: true,
      breaks: true,
    });
    callback();
  };
  document.head.appendChild(script);
}

function loadMonaco(callback) {
  if (window.monaco) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js";
  script.onload = () => {
    require.config({
      paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" },
    });
    require(["vs/editor/editor.main"], () => {
      callback();
    });
  };
  document.head.appendChild(script);
}

// Tab Switching Routing
function setupTabs() {
  sidebarTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      sidebarTabs.forEach((t) => t.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      tab.classList.add("active");
      const targetTab = tab.getAttribute("data-tab");
      document.getElementById(`tab-${targetTab}`).classList.add("active");

      // Switch active main view if it maps directly (like config/agent)
      if (targetTab === "settings-pane") {
        switchView("view-settings");
      } else if (targetTab === "agent-pane") {
        switchView("view-agent");
      } else if (targetTab === "chat-pane") {
        switchView("view-chat");
      }
    });
  });
}

function switchView(viewId) {
  viewPanels.forEach((panel) => panel.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");
}

// 1. CHAT MODULE LOGIC
function setupChatHandlers() {
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentConversationId) return;

    chatInput.value = "";
    chatInput.style.height = "auto";
    appendMessage("user", text);

    // Disable inputs while processing
    chatInput.disabled = true;
    sendBtn.disabled = true;

    // Create assistant bubble
    const assistantBubble = appendMessage("assistant", "생각 중...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: currentConversationId,
          message: text,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      // Read readable stream response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamText = "";
      assistantBubble.innerHTML = ""; // Clear loader text

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamText += decoder.decode(value, { stream: true });
        // Format markdown dynamically
        renderMarkdownBubble(assistantBubble, streamText);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } catch (err) {
      console.error(err);
      assistantBubble.innerHTML = `<span style="color: var(--color-danger)">오류: ${err.message}</span>`;
    } finally {
      chatInput.disabled = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  });

  // Handle enter key on input
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // Resize input heights as content wraps
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${chatInput.scrollHeight}px`;
  });

  newChatBtn.addEventListener("click", async () => {
    const title = prompt("대화방 제목을 입력하세요 (공란 가능):") || "새 대화";
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          provider: currentProvider,
          model: currentModel,
          systemPrompt: settingSystemPrompt.value.trim() || null,
        }),
      });

      const newConv = await response.json();
      await loadConversations();
      selectConversation(newConv.id);
    } catch (err) {
      alert("대화방 생성에 실패했습니다: " + err.message);
    }
  });

  deleteChatBtn.addEventListener("click", async () => {
    if (!currentConversationId || !confirm("정말로 이 대화를 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/conversations/${currentConversationId}`, { method: "DELETE" });
      currentConversationId = null;
      chatTitle.innerText = "LiteAI 워크스페이스";
      chatModelInfo.innerText = "새 대화를 개설하거나 기존 대화를 선택해 주세요.";
      chatMessages.innerHTML = `
        <div class="welcome-screen">
          <h3>저대역폭 모던 AI 채팅 서비스</h3>
          <p>모든 메시지는 로컬 Bun SQLite 데이터베이스에 직접 저장됩니다. 텍스트 버퍼 전송을 최소화하고, Markdown 및 Code Editor 등 무거운 모듈은 클라이언트가 요청하는 즉시 CDN을 통해 비동기식으로 가져옵니다.</p>
        </div>`;
      deleteChatBtn.style.display = "none";
      chatInput.disabled = true;
      sendBtn.disabled = true;
      await loadConversations();
    } catch (err) {
      alert("대화 삭제에 실패했습니다: " + err.message);
    }
  });

  // Welcome Screen click handler
  document.getElementById("quick-start-btn")?.addEventListener("click", () => {
    newChatBtn.click();
  });
}

async function loadConversations() {
  try {
    const response = await fetch("/api/conversations");
    const data = await response.json();
    chatList.innerHTML = "";

    if (data.length === 0) {
      chatList.innerHTML = `<li class="loading-placeholder">개설된 대화방이 없습니다.</li>`;
      return;
    }

    data.forEach((conv) => {
      const li = document.createElement("li");
      li.className = conv.id === currentConversationId ? "active" : "";
      li.innerHTML = `
        <div style="font-weight: 600;">${escapeHtml(conv.title)}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">${conv.provider}/${conv.model}</div>
      `;
      li.addEventListener("click", () => {
        selectConversation(conv.id);
        switchView("view-chat");
        // Highlight active sidebar item
        document.querySelectorAll("#chat-list li").forEach((el) => el.classList.remove("active"));
        li.classList.add("active");
      });
      chatList.appendChild(li);
    });
  } catch (err) {
    chatList.innerHTML = `<li class="loading-placeholder" style="color: var(--color-danger)">목록 조회 실패</li>`;
  }
}

async function selectConversation(id) {
  currentConversationId = id;
  chatMessages.innerHTML = `<div class="loading-placeholder">대화 기록을 로딩 중...</div>`;
  deleteChatBtn.style.display = "block";
  chatInput.disabled = false;
  sendBtn.disabled = false;

  try {
    const response = await fetch(`/api/conversations/${id}`);
    const conv = await response.json();

    chatTitle.innerText = conv.title;
    chatModelInfo.innerText = `동작 플랫폼: ${conv.provider} / 모델: ${conv.model}`;

    chatMessages.innerHTML = "";
    if (conv.messages.length === 0) {
      chatMessages.innerHTML = `<div class="loading-placeholder">메시지를 입력하여 대화를 시작해 보세요.</div>`;
    } else {
      conv.messages.forEach((msg) => {
        appendMessage(msg.role, msg.content);
      });
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    chatMessages.innerHTML = `<div class="loading-placeholder" style="color: var(--color-danger)">대화 기록 로드 실패</div>`;
  }
}

function appendMessage(role, content) {
  const bubble = document.createElement("div");
  bubble.className = `message-bubble ${role}`;
  
  if (role === "assistant") {
    renderMarkdownBubble(bubble, content);
  } else {
    bubble.innerText = content;
  }
  
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function renderMarkdownBubble(element, markdownText) {
  loadMarked(() => {
    if (window.marked) {
      element.innerHTML = window.marked.parse(markdownText);
    } else {
      element.innerText = markdownText;
    }
  });
}

// 2. FILES MODULE LOGIC
function setupFileHandlers() {
  refreshFilesBtn.addEventListener("click", loadFiles);

  newFileBtn.addEventListener("click", async () => {
    const name = prompt("생성할 파일 경로를 입력하세요 (예: index.html 또는 src/helper.js):");
    if (!name) return;
    try {
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: name, content: "" }),
      });
      await loadFiles();
      openFileInEditor(name);
    } catch (err) {
      alert("파일 생성에 실패했습니다: " + err.message);
    }
  });

  newFolderBtn.addEventListener("click", async () => {
    const name = prompt("생성할 폴더 경로를 입력하세요 (예: src 또는 utils/helpers):");
    if (!name) return;
    try {
      await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: name }),
      });
      await loadFiles();
    } catch (err) {
      alert("폴더 생성에 실패했습니다: " + err.message);
    }
  });

  editorCloseBtn.addEventListener("click", () => {
    switchView("view-chat");
    activeEditorFile = null;
  });

  editorSaveBtn.addEventListener("click", async () => {
    if (!activeEditorFile || !editorInstance) return;
    editorSaveBtn.disabled = true;
    editorSaveBtn.innerText = "저장 중...";

    try {
      const content = editorInstance.getValue();
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: activeEditorFile,
          content,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      editorSaveBtn.innerText = "저장 완료!";
      setTimeout(() => {
        editorSaveBtn.innerText = "변경사항 저장";
        editorSaveBtn.disabled = false;
      }, 1500);
    } catch (err) {
      alert("저장 실패: " + err.message);
      editorSaveBtn.innerText = "변경사항 저장";
      editorSaveBtn.disabled = false;
    }
  });
}

async function loadFiles() {
  try {
    const response = await fetch("/api/files");
    const data = await response.json();
    fileTree.innerHTML = "";

    if (data.length === 0) {
      fileTree.innerHTML = `<li class="loading-placeholder">워크스페이스가 비어 있습니다.</li>`;
      return;
    }

    data.forEach((item) => {
      const li = document.createElement("li");
      li.className = `file-node ${item.isDir ? "folder" : "file"}`;
      
      const icon = item.isDir ? "📁" : "📄";
      const sizeStr = item.size !== undefined ? ` (${formatBytes(item.size)})` : "";
      
      li.innerHTML = `
        <span>${icon} ${escapeHtml(item.relativePath)}${sizeStr}</span>
        <button class="file-delete-btn" title="파일 삭제">🗑️</button>
      `;

      // Handle Node click
      li.addEventListener("click", (e) => {
        if (e.target.classList.contains("file-delete-btn")) {
          e.stopPropagation();
          deleteFile(item.relativePath);
          return;
        }

        if (!item.isDir) {
          openFileInEditor(item.relativePath);
        }
      });

      fileTree.appendChild(li);
    });
  } catch (err) {
    fileTree.innerHTML = `<li class="loading-placeholder" style="color: var(--color-danger)">동기화 실패</li>`;
  }
}

async function deleteFile(path) {
  if (!confirm(`정말로 ${path} 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await response.text());
    await loadFiles();
    if (activeEditorFile === path) {
      switchView("view-chat");
      activeEditorFile = null;
    }
  } catch (err) {
    alert("삭제에 실패했습니다: " + err.message);
  }
}

function openFileInEditor(path) {
  activeEditorFile = path;
  editorFilename.innerText = path.split("/").pop();
  editorFilepath.innerText = `workspace/${path}`;
  switchView("view-editor");
  editorLoading.style.display = "flex";

  loadMonaco(async () => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(await res.text());
      const content = await res.text();

      editorLoading.style.display = "none";

      const fileExtension = path.split(".").pop().toLowerCase();
      let language = "plaintext";
      if (["js", "ts", "json", "html", "css", "md", "py", "sh"].includes(fileExtension)) {
        if (fileExtension === "js") language = "javascript";
        else if (fileExtension === "ts") language = "typescript";
        else if (fileExtension === "md") language = "markdown";
        else if (fileExtension === "py") language = "python";
        else if (fileExtension === "sh") language = "shell";
        else language = fileExtension;
      }

      if (editorInstance) {
        editorInstance.setValue(content);
        monaco.editor.setModelLanguage(editorInstance.getModel(), language);
      } else {
        const container = document.getElementById("editor-container");
        editorInstance = monaco.editor.create(container, {
          value: content,
          language: language,
          theme: "vs",
          automaticLayout: true,
          minimap: { enabled: false },
        });
      }
    } catch (err) {
      alert("파일 내용을 읽어오지 못했습니다: " + err.message);
      switchView("view-chat");
    }
  });
}

// 3. AGENT MODULE LOGIC
function setupAgentHandlers() {
  startAgentBtn.addEventListener("click", async () => {
    const description = agentTaskInput.value.trim();
    if (!description) return;

    startAgentBtn.disabled = true;
    startAgentBtn.innerText = "Spawning agent...";
    agentActiveTask.style.display = "block";
    agentTaskLogs.innerText = "Initializing runtime...";

    try {
      const response = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await response.json();
      
      agentTaskInput.value = "";
      startAgentBtn.disabled = false;
      startAgentBtn.innerText = "Start Execution Loop";
      
      monitorAgentTask(data.taskId);
      await loadAgentTasks();
    } catch (err) {
      alert("Failed to start agent: " + err.message);
      startAgentBtn.disabled = false;
      startAgentBtn.innerText = "Start Execution Loop";
    }
  });

  refreshAgentBtn.addEventListener("click", () => {
    if (activeAgentTaskId) {
      fetchAgentLogs(activeAgentTaskId);
    }
  });

  newAgentTaskBtn.addEventListener("click", () => {
    activeAgentTaskId = null;
    if (agentPollInterval) clearInterval(agentPollInterval);
    agentActiveTask.style.display = "none";
    agentTaskInput.focus();
  });
}

async function loadAgentTasks() {
  try {
    const res = await fetch("/api/agent/tasks");
    const data = await res.json();
    taskList.innerHTML = "";

    if (data.length === 0) {
      taskList.innerHTML = `<li class="loading-placeholder">수행된 에이전트 작업이 없습니다.</li>`;
      return;
    }

    data.forEach((task) => {
      const li = document.createElement("li");
      li.className = task.id === activeAgentTaskId ? "active" : "";
      
      let badgeColor = "var(--text-muted)";
      if (task.status === "success") badgeColor = "var(--color-success)";
      else if (task.status === "failed") badgeColor = "var(--color-danger)";
      else if (task.status === "running") badgeColor = "var(--color-primary)";

      li.innerHTML = `
        <div style="font-weight:600; display:flex; justify-content:space-between;">
          <span>에이전트 작업</span>
          <span style="color:${badgeColor}; font-size:0.75rem; text-transform:uppercase;">${task.status}</span>
        </div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHtml(task.description)}
        </div>
      `;

      li.addEventListener("click", () => {
        monitorAgentTask(task.id);
        switchView("view-agent");
        document.querySelectorAll("#task-list li").forEach((el) => el.classList.remove("active"));
        li.classList.add("active");
      });

      taskList.appendChild(li);
    });
  } catch (err) {}
}

function monitorAgentTask(taskId) {
  activeAgentTaskId = taskId;
  agentActiveTask.style.display = "block";
  
  if (agentPollInterval) clearInterval(agentPollInterval);
  
  fetchAgentLogs(taskId);
  agentPollInterval = setInterval(() => {
    fetchAgentLogs(taskId);
  }, 2000);
}

async function fetchAgentLogs(taskId) {
  try {
    const res = await fetch(`/api/agent/tasks/${taskId}`);
    const task = await res.json();
    
    agentTaskStatus.innerText = task.status;
    agentTaskStatus.className = `badge ${task.status}`;
    agentTaskLogs.innerText = task.logs;
    agentTaskLogs.scrollTop = agentTaskLogs.scrollHeight;

    if (task.status !== "running") {
      if (agentPollInterval) {
        clearInterval(agentPollInterval);
        agentPollInterval = null;
      }
      loadAgentTasks(); // reload to update statuses in list
    }
  } catch (err) {
    console.error("Error fetching agent logs:", err);
  }
}

// 4. CONFIG CONFIGURATION LOGIC
function setupConfigHandlers() {
  saveConfigBtn.addEventListener("click", async () => {
    saveConfigBtn.disabled = true;
    saveConfigBtn.innerText = "설정 저장 중...";
    configStatusMsg.innerText = "";

    const basicConfig = {
      active_provider: settingProvider.value,
      active_model: settingModel.value.trim(),
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
      searxng_url: settingSearxngUrl.value.trim(),
    };

    let mcpConfig = {};
    try {
      mcpConfig = JSON.parse(settingMcpServers.value.trim() || "{}");
    } catch (e) {
      alert("MCP 구성의 JSON 구문 오류: " + e.message);
      saveConfigBtn.disabled = false;
      saveConfigBtn.innerText = "설정 저장 및 업데이트";
      return;
    }

    try {
      // 1. Save general settings
      const res1 = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(basicConfig),
      });
      if (!res1.ok) throw new Error("인증 키 저장에 실패했습니다.");

      // 2. Save MCP config
      const res2 = await fetch("/api/config/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mcpConfig),
      });
      if (!res2.ok) throw new Error("MCP 설정 저장에 실패했습니다.");

      // Update badge states
      currentProvider = basicConfig.active_provider;
      currentModel = basicConfig.active_model;
      currentProviderBadge.innerText = currentProvider;
      currentModelBadge.innerText = currentModel;

      configStatusMsg.innerText = "설정이 저장되었습니다!";
      setTimeout(() => {
        configStatusMsg.innerText = "";
      }, 3000);
    } catch (err) {
      alert("설정 저장에 실패했습니다: " + err.message);
    } finally {
      saveConfigBtn.disabled = false;
      saveConfigBtn.innerText = "설정 저장 및 업데이트";
    }
  });
}

async function loadConfig() {
  try {
    const res1 = await fetch("/api/config");
    const basic = await res1.json();

    settingProvider.value = basic.active_provider || "ollama";
    settingModel.value = basic.active_model || "llama3";
    settingSystemPrompt.value = basic.default_system_prompt || "";
    settingOllamaUrl.value = basic.ollama_url || "http://localhost:11434";
    settingOllamaKey.value = basic.ollama_api_key || "";
    settingGroqKey.value = basic.groq_api_key || "";
    settingCerebrasKey.value = basic.cerebras_api_key || "";
    settingCloudflareAccount.value = basic.cloudflare_account_id || "";
    settingCloudflareToken.value = basic.cloudflare_api_token || "";
    settingGeminiKey.value = basic.gemini_api_key || "";
    settingGeminiSearch.checked = basic.gemini_search_grounding === "true";
    settingOpenRouterKey.value = basic.openrouter_api_key || "";
    settingSearchProvider.value = basic.search_provider || "duckduckgo";
    settingBraveKey.value = basic.brave_search_key || "";
    settingSearxngUrl.value = basic.searxng_url || "";

    currentProvider = settingProvider.value;
    currentModel = settingModel.value;
    currentProviderBadge.innerText = currentProvider;
    currentModelBadge.innerText = currentModel;

    const res2 = await fetch("/api/config/mcp");
    const mcp = await res2.json();
    settingMcpServers.value = JSON.stringify(mcp, null, 2);
  } catch (err) {
    console.error("설정을 불러오지 못했습니다:", err);
  }
}

// Global UI Formatting utilities
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KiB", "MiB", "GiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}
