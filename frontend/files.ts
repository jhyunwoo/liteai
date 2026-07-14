// 2. FILES MODULE LOGIC
const state = (window as any).appState;
const helpers = (window as any).appHelpers;

let filesInitialized = false;

// Global Monaco Editor dynamic loader
function loadMonaco(callback: () => void) {
  if ((window as any).monaco) {
    callback();
    return;
  }
  const script = document.createElement("script");
  script.src = "/libs/require.min.js";
  script.onload = () => {
    (window as any).require.config({
      paths: { vs: "/libs/vs" },
    });
    (window as any).require(["vs/editor/editor.main"], () => {
      callback();
    });
  };
  document.head.appendChild(script);
}

const fileTree = document.getElementById("file-tree") as HTMLUListElement;
const refreshFilesBtn = document.getElementById("refresh-files-btn") as HTMLButtonElement;
const newFileBtn = document.getElementById("new-file-btn") as HTMLButtonElement;
const newFolderBtn = document.getElementById("new-folder-btn") as HTMLButtonElement;
const editorFilename = document.getElementById("editor-filename") as HTMLHeadingElement;
const editorFilepath = document.getElementById("editor-filepath") as HTMLParagraphElement;
const editorSaveBtn = document.getElementById("editor-save-btn") as HTMLButtonElement;
const editorCloseBtn = document.getElementById("editor-close-btn") as HTMLButtonElement;
const editorLoading = document.getElementById("editor-loading") as HTMLDivElement;

function setupFileHandlers() {
  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener("click", loadFiles);
  }

  if (newFileBtn) {
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
      } catch (err: any) {
        alert("파일 생성에 실패했습니다: " + err.message);
      }
    });
  }

  if (newFolderBtn) {
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
      } catch (err: any) {
        alert("폴더 생성에 실패했습니다: " + err.message);
      }
    });
  }

  if (editorCloseBtn) {
    editorCloseBtn.addEventListener("click", () => {
      helpers.switchView("view-chat");
      state.activeEditorFile = null;
    });
  }

  if (editorSaveBtn) {
    editorSaveBtn.addEventListener("click", async () => {
      if (!state.activeEditorFile || !state.editorInstance) return;
      editorSaveBtn.disabled = true;
      editorSaveBtn.innerText = "저장 중...";

      try {
        const content = state.editorInstance.getValue();
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: state.activeEditorFile,
            content,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        editorSaveBtn.innerText = "저장 완료!";
        setTimeout(() => {
          editorSaveBtn.innerText = "변경사항 저장";
          editorSaveBtn.disabled = false;
        }, 1500);
      } catch (err: any) {
        alert("저장 실패: " + err.message);
        editorSaveBtn.innerText = "변경사항 저장";
        editorSaveBtn.disabled = false;
      }
    });
  }
}

async function loadFiles() {
  if (!fileTree) return;
  try {
    const response = await fetch("/api/files");
    const data = await response.json();
    fileTree.innerHTML = "";

    if (data.length === 0) {
      fileTree.innerHTML = `<li class="loading-placeholder">워크스페이스가 비어 있습니다.</li>`;
      return;
    }

    data.forEach((item: any) => {
      const li = document.createElement("li");
      li.className = `file-node ${item.isDir ? "folder" : "file"}`;
      
      const icon = item.isDir ? "📁" : "📄";
      const sizeStr = item.size !== undefined ? ` (${helpers.formatBytes(item.size)})` : "";
      
      li.innerHTML = `
        <span>${icon} ${helpers.escapeHtml(item.relativePath)}${sizeStr}</span>
        <button class="file-delete-btn" title="파일 삭제">🗑️</button>
      `;

      li.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("file-delete-btn")) {
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

async function deleteFile(path: string) {
  if (!confirm(`정말로 ${path} 파일을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
  try {
    const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(await response.text());
    await loadFiles();
    if (state.activeEditorFile === path) {
      helpers.switchView("view-chat");
      state.activeEditorFile = null;
    }
  } catch (err: any) {
    alert("삭제에 실패했습니다: " + err.message);
  }
}

function openFileInEditor(path: string) {
  state.activeEditorFile = path;
  if (editorFilename) editorFilename.innerText = path.split("/").pop() || "";
  if (editorFilepath) editorFilepath.innerText = `workspace/${path}`;
  helpers.switchView("view-editor");
  if (editorLoading) editorLoading.style.display = "flex";

  loadMonaco(async () => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(await res.text());
      const content = await res.text();

      if (editorLoading) editorLoading.style.display = "none";

      const fileExtension = path.split(".").pop()?.toLowerCase() || "";
      let language = "plaintext";
      if (["js", "ts", "json", "html", "css", "md", "py", "sh"].includes(fileExtension)) {
        if (fileExtension === "js") language = "javascript";
        else if (fileExtension === "ts") language = "typescript";
        else if (fileExtension === "md") language = "markdown";
        else if (fileExtension === "py") language = "python";
        else if (fileExtension === "sh") language = "shell";
        else language = fileExtension;
      }

      const monaco = (window as any).monaco;
      if (state.editorInstance) {
        state.editorInstance.setValue(content);
        monaco.editor.setModelLanguage(state.editorInstance.getModel(), language);
      } else {
        const container = document.getElementById("editor-container");
        state.editorInstance = monaco.editor.create(container, {
          value: content,
          language: language,
          theme: "vs",
          automaticLayout: true,
          minimap: { enabled: false },
        });
      }
    } catch (err: any) {
      alert("파일 내용을 읽어오지 못했습니다: " + err.message);
      helpers.switchView("view-chat");
    }
  });
}

// Expose Files initialization function
(window as any).initFiles = function() {
  if (filesInitialized) return;
  filesInitialized = true;
  setupFileHandlers();
  loadFiles();
};
