(function () {
// 3. AGENT MODULE LOGIC
const state = (window as any).appState;
const helpers = (window as any).appHelpers;

let agentInitialized = false;

const agentTaskInput = document.getElementById("agent-task-input") as HTMLTextAreaElement;
const startAgentBtn = document.getElementById("start-agent-btn") as HTMLButtonElement;
const agentActiveTask = document.getElementById("agent-active-task") as HTMLDivElement;
const agentTaskStatus = document.getElementById("agent-task-status") as HTMLSpanElement;
const agentTaskLogs = document.getElementById("agent-task-logs") as HTMLPreElement;
const refreshAgentBtn = document.getElementById("refresh-agent-btn") as HTMLButtonElement;
const taskList = document.getElementById("task-list") as HTMLUListElement;
const newAgentTaskBtn = document.getElementById("new-agent-task-btn") as HTMLButtonElement;

function setupAgentHandlers() {
  if (startAgentBtn) {
    startAgentBtn.addEventListener("click", async () => {
      const description = agentTaskInput.value.trim();
      if (!description) return;

      startAgentBtn.disabled = true;
      startAgentBtn.innerText = "Spawning agent...";
      if (agentActiveTask) agentActiveTask.style.display = "block";
      if (agentTaskLogs) agentTaskLogs.innerText = "Initializing runtime...";

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
      } catch (err: any) {
        alert("Failed to start agent: " + err.message);
        startAgentBtn.disabled = false;
        startAgentBtn.innerText = "Start Execution Loop";
      }
    });
  }

  if (refreshAgentBtn) {
    refreshAgentBtn.addEventListener("click", () => {
      if (state.activeAgentTaskId) {
        fetchAgentLogs(state.activeAgentTaskId);
      }
    });
  }

  if (newAgentTaskBtn) {
    newAgentTaskBtn.addEventListener("click", () => {
      state.activeAgentTaskId = null;
      if (state.agentPollInterval) clearInterval(state.agentPollInterval);
      if (agentActiveTask) agentActiveTask.style.display = "none";
      if (agentTaskInput) agentTaskInput.focus();
    });
  }
}

async function loadAgentTasks() {
  if (!taskList) return;
  try {
    const res = await fetch("/api/agent/tasks");
    const data = await res.json();
    taskList.innerHTML = "";

    if (data.length === 0) {
      taskList.innerHTML = `<li class="loading-placeholder">수행된 에이전트 작업이 없습니다.</li>`;
      return;
    }

    data.forEach((task: any) => {
      const li = document.createElement("li");
      li.className = task.id === state.activeAgentTaskId ? "active" : "";
      
      let badgeColor = "var(--text-muted)";
      if (task.status === "success") badgeColor = "var(--color-success)";
      else if (task.status === "failed") badgeColor = "var(--color-error)";
      else if (task.status === "running") badgeColor = "var(--color-primary)";

      li.innerHTML = `
        <div style="font-weight:600; display:flex; justify-content:space-between;">
          <span>에이전트 작업</span>
          <span style="color:${badgeColor}; font-size:0.75rem; text-transform:uppercase;">${task.status}</span>
        </div>
        <div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px; overflow:hidden; text-overflow:ellipsis;">
          ${helpers.escapeHtml(task.description)}
        </div>
      `;

      li.addEventListener("click", () => {
        monitorAgentTask(task.id);
        helpers.switchView("view-agent");
        document.querySelectorAll("#task-list li").forEach((el) => el.classList.remove("active"));
        li.classList.add("active");
      });

      taskList.appendChild(li);
    });
  } catch (err) {}
}

function monitorAgentTask(taskId: string) {
  state.activeAgentTaskId = taskId;
  if (agentActiveTask) agentActiveTask.style.display = "block";
  
  if (state.agentPollInterval) clearInterval(state.agentPollInterval);
  
  fetchAgentLogs(taskId);
  state.agentPollInterval = setInterval(() => {
    fetchAgentLogs(taskId);
  }, 2000);
}

async function fetchAgentLogs(taskId: string) {
  try {
    const res = await fetch(`/api/agent/tasks/${taskId}`);
    const task = await res.json();
    
    if (agentTaskStatus) {
      agentTaskStatus.innerText = task.status;
      agentTaskStatus.className = `badge ${task.status}`;
    }
    if (agentTaskLogs) {
      agentTaskLogs.innerText = task.logs;
      agentTaskLogs.scrollTop = agentTaskLogs.scrollHeight;
    }

    if (task.status !== "running") {
      if (state.agentPollInterval) {
        clearInterval(state.agentPollInterval);
        state.agentPollInterval = null;
      }
      loadAgentTasks(); // reload to update statuses in list
    }
  } catch (err) {
    console.error("Error fetching agent logs:", err);
  }
}

// Expose Agent initialization function
(window as any).initAgent = function() {
  if (agentInitialized) return;
  agentInitialized = true;
  setupAgentHandlers();
  loadAgentTasks();
  
  // 만약 탭 클릭 시점에 이미 돌고 있는 작업이 있다면 모니터링 재개
  if (state.activeAgentTaskId) {
    monitorAgentTask(state.activeAgentTaskId);
  }
};
})();
