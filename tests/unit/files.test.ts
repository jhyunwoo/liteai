import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync } from "fs";
import { rm } from "fs/promises";

const testWorkspaceDir = join(process.cwd(), "tests/unit/test-workspace");
process.env.WORKSPACE_PATH = testWorkspaceDir;

// Import files module after setting WORKSPACE_PATH
import * as files from "../../src/files";

describe("Files Sandbox Unit Tests", () => {
  beforeAll(async () => {
    await files.ensureWorkspaceExists();
  });

  afterAll(async () => {
    if (existsSync(testWorkspaceDir)) {
      await rm(testWorkspaceDir, { recursive: true, force: true });
    }
  });

  describe("resolveSafePath", () => {
    it("should resolve relative path correctly within workspace", () => {
      const resolved = files.resolveSafePath("sub/file.txt");
      expect(resolved).toBe(join(testWorkspaceDir, "sub/file.txt"));
    });

    it("should allow root workspace directory resolution", () => {
      const resolved = files.resolveSafePath("");
      expect(resolved).toBe(testWorkspaceDir);
    });

    it("should throw error for paths outside workspace (Traversal)", () => {
      expect(() => files.resolveSafePath("../outside.txt")).toThrow("Access denied");
      expect(() => files.resolveSafePath("/etc/passwd")).toThrow("Access denied");
      expect(() => files.resolveSafePath("..")).toThrow("Access denied");
    });

    it("should throw error for partial path traversal attempts", () => {
      // workspaceDir is test-workspace, attempts to access test-workspace-secret
      expect(() => files.resolveSafePath("../test-workspace-secret")).toThrow("Access denied");
    });
  });

  describe("File System CRUD Operations", () => {
    it("should write and read files in workspace", async () => {
      const path = "doc.md";
      const content = "# Hello Bun";

      await files.writeWorkspaceFile(path, content);
      expect(existsSync(join(testWorkspaceDir, path))).toBe(true);

      const read = await files.readWorkspaceFile(path);
      expect(read).toBe(content);
    });

    it("should create directory structure and list files", async () => {
      await files.createWorkspaceDirectory("src/utils");
      await files.writeWorkspaceFile("src/utils/math.js", "export const add = (a, b) => a + b;");
      await files.writeWorkspaceFile("src/main.js", "import './utils/math.js';");

      const items = await files.listFiles("src");
      expect(items.length).toBe(2);
      
      const utilsFolder = items.find(i => i.name === "utils");
      expect(utilsFolder).toBeDefined();
      expect(utilsFolder?.isDir).toBe(true);
      expect(utilsFolder?.relativePath).toBe("src/utils");

      const mainFile = items.find(i => i.name === "main.js");
      expect(mainFile).toBeDefined();
      expect(mainFile?.isDir).toBe(false);
      expect(mainFile?.relativePath).toBe("src/main.js");
    });

    it("should delete files and directories recursively", async () => {
      await files.deleteWorkspaceFile("src");
      expect(existsSync(join(testWorkspaceDir, "src"))).toBe(false);

      const items = await files.listFiles();
      expect(items.find(i => i.name === "src")).toBeUndefined();
    });
  });
});
