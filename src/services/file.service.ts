/**
 * @module services/file.service
 * @description 파일 시스템 서비스 모듈
 *
 * 워크스페이스 내 파일 및 디렉토리에 대한 CRUD 작업을 제공합니다.
 * 모든 파일 경로는 보안 유틸리티를 통해 워크스페이스 내부로 제한됩니다.
 */

import { readdir, readFile, writeFile, rm, stat, mkdir } from "fs/promises";
import { join, relative, resolve } from "path";
import { existsSync } from "fs";
import { resolveSafePath, getWorkspaceDir, ensureWorkspaceExists } from "../utils/security";
import type { FileItem } from "../types";

/**
 * 지정된 하위 디렉토리의 파일/폴더 목록을 조회합니다.
 * 디렉토리 우선, 이름 알파벳 순으로 정렬됩니다.
 *
 * @param subDir - 워크스페이스 기준 하위 디렉토리 경로 (기본: 루트)
 * @returns 파일/폴더 정보 배열
 */
export async function listFiles(subDir: string = ""): Promise<FileItem[]> {
  await ensureWorkspaceExists();
  const targetDir = resolveSafePath(subDir);
  const workspaceDir = getWorkspaceDir();

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });

    const itemPromises = entries.map(async (entry) => {
      const fullPath = join(targetDir, entry.name);
      const relativePath = relative(workspaceDir, fullPath);

      if (entry.isDirectory()) {
        return { name: entry.name, relativePath, isDir: true } as FileItem;
      } else {
        const stats = await stat(fullPath);
        return {
          name: entry.name,
          relativePath,
          isDir: false,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
        } as FileItem;
      }
    });

    const items = await Promise.all(itemPromises);

    /* 디렉토리 우선, 이름 알파벳순 정렬 */
    return items.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** 파일 내용을 읽어 문자열로 반환합니다. */
export async function readWorkspaceFile(relativePath: string): Promise<string> {
  const filePath = resolveSafePath(relativePath);
  return await readFile(filePath, "utf-8");
}

/** 파일에 내용을 쓰고, 부모 디렉토리가 없으면 자동 생성합니다. */
export async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const filePath = resolveSafePath(relativePath);
  const parentDir = resolve(filePath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }
  await writeFile(filePath, content, "utf-8");
}

/** 파일 또는 디렉토리를 재귀적으로 삭제합니다. */
export async function deleteWorkspaceFile(relativePath: string): Promise<void> {
  const filePath = resolveSafePath(relativePath);
  await rm(filePath, { recursive: true, force: true });
}

/** 디렉토리를 재귀적으로 생성합니다. */
export async function createWorkspaceDirectory(relativePath: string): Promise<void> {
  const dirPath = resolveSafePath(relativePath);
  await mkdir(dirPath, { recursive: true });
}
