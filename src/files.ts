import { mkdir, readdir, readFile, writeFile, rm, stat } from "fs/promises";
import { join, resolve, relative } from "path";
import { existsSync } from "fs";

const workspaceDir = resolve(process.cwd(), "liteai_workspace");

export async function ensureWorkspaceExists(): Promise<void> {
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
  }
}

// Security function to prevent path traversal
export function resolveSafePath(relativePath: string): string {
  const resolved = resolve(workspaceDir, relativePath);
  
  if (!resolved.startsWith(workspaceDir)) {
    throw new Error("Access denied: path is outside the workspace directory.");
  }
  return resolved;
}

export interface FileItem {
  name: string;
  relativePath: string;
  isDir: boolean;
  size?: number;
  updatedAt?: string;
}

export async function listFiles(subDir: string = ""): Promise<FileItem[]> {
  await ensureWorkspaceExists();
  const targetDir = resolveSafePath(subDir);
  
  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const items: FileItem[] = [];
    
    for (const entry of entries) {
      const fullPath = join(targetDir, entry.name);
      const relativePath = relative(workspaceDir, fullPath);
      
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          relativePath,
          isDir: true,
        });
      } else {
        const stats = await stat(fullPath);
        items.push({
          name: entry.name,
          relativePath,
          isDir: false,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
        });
      }
    }
    
    // Sort directories first, then files alphabetically
    return items.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function readWorkspaceFile(relativePath: string): Promise<string> {
  const filePath = resolveSafePath(relativePath);
  return await readFile(filePath, "utf-8");
}

export async function writeWorkspaceFile(
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = resolveSafePath(relativePath);
  // Ensure the parent directory exists
  const parentDir = resolve(filePath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }
  await writeFile(filePath, content, "utf-8");
}

export async function deleteWorkspaceFile(relativePath: string): Promise<void> {
  const filePath = resolveSafePath(relativePath);
  await rm(filePath, { recursive: true, force: true });
}

export async function createWorkspaceDirectory(relativePath: string): Promise<void> {
  const dirPath = resolveSafePath(relativePath);
  await mkdir(dirPath, { recursive: true });
}
