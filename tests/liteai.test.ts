import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import server from "../src/index";
import {
  db,
  createConversation,
  getConversation,
  listConversations,
  deleteConversation,
  addMessage,
  getMessages,
  setSetting,
  getSetting,
} from "../src/db";
import {
  resolveSafePath,
  writeWorkspaceFile,
  readWorkspaceFile,
  listFiles,
  deleteWorkspaceFile,
} from "../src/files";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";

describe("LiteAI Backend Engine Tests", () => {
  
  describe("Database Operations", () => {
    const testId = "test-conversation-uuid-12345";

    beforeAll(() => {
      deleteConversation(testId);
    });

    it("should successfully save a setting", () => {
      setSetting("test_key", "test_value");
      expect(getSetting("test_key")).toBe("test_value");
    });

    it("should create and retrieve a conversation", () => {
      createConversation(testId, "Test Title", "llama3", "ollama", "system prompt test");
      const conv = getConversation(testId);
      
      expect(conv).not.toBeNull();
      expect(conv?.title).toBe("Test Title");
      expect(conv?.model).toBe("llama3");
      expect(conv?.provider).toBe("ollama");
      expect(conv?.system_prompt).toBe("system prompt test");
    });

    it("should list conversations and include the new one", () => {
      const list = listConversations();
      const match = list.find((c) => c.id === testId);
      expect(match).toBeDefined();
    });

    it("should write and read messages in order", () => {
      const msgId1 = "msg-1";
      const msgId2 = "msg-2";
      addMessage(msgId1, testId, "user", "Hello Assistant");
      addMessage(msgId2, testId, "assistant", "Hello User");

      const msgs = getMessages(testId);
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("Hello Assistant");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBe("Hello User");
    });

    it("should successfully cascade delete messages when conversation is deleted", () => {
      deleteConversation(testId);
      const conv = getConversation(testId);
      expect(conv).toBeNull();
      
      const msgs = getMessages(testId);
      expect(msgs.length).toBe(0);
    });
  });

  describe("File System Security and Sandbox Operations", () => {
    
    it("should prevent directory traversal and throw error for unsafe paths", () => {
      expect(() => resolveSafePath("../unsafe_file.txt")).toThrow();
      expect(() => resolveSafePath("/etc/passwd")).toThrow();
      expect(() => resolveSafePath("..")).toThrow();
      expect(() => resolveSafePath("../liteai_workspace_test")).toThrow();
    });

    it("should successfully resolve safe paths inside workspace", () => {
      const resolved = resolveSafePath("subfolder/file.js");
      const expected = join(process.cwd(), "liteai_workspace", "subfolder", "file.js");
      expect(resolved).toBe(expected);
    });

    it("should write, list, and read files from local workspace", async () => {
      const relativePath = "tests/test_file.txt";
      const fileContent = "Unit testing file content with Bun!";

      await writeWorkspaceFile(relativePath, fileContent);
      const readContent = await readWorkspaceFile(relativePath);
      expect(readContent).toBe(fileContent);

      const list = await listFiles("tests");
      const match = list.find((f) => f.name === "test_file.txt");
      expect(match).toBeDefined();
      expect(match?.isDir).toBe(false);

      await deleteWorkspaceFile("tests");
      const listAfter = await listFiles("tests");
      expect(listAfter.length).toBe(0);
    });
  });

  describe("API Server Security and Auth Bypass", () => {
    it("should reject access to conversations API without session cookie", async () => {
      const res = await server.fetch(new Request("http://localhost/api/conversations"));
      expect(res.status).toBe(401);
    });

    it("should prevent auth bypass trick (/api/auth/../conversations)", async () => {
      // In JS Request, URL resolves /../ automatically before fetch
      // But we can construct a raw Request to test if the server handles raw paths or decodes.
      // If we query '/api/auth/../conversations', JavaScript Request will resolve it to '/api/conversations'.
      // However, we want to see if we send encoded traversal like '/api/auth/%2e%2e/conversations' or similar:
      const res = await server.fetch(new Request("http://localhost/api/auth/%2e%2e/conversations"));
      // If bypass is successful, it would bypass middleware because path.startsWith('/api/auth/') is true
      // since the path string raw might start with /api/auth/ before normalisation or it might route to /api/conversations.
      // Let's see what happens.
      expect(res.status).toBe(401);
    });
  });
});
