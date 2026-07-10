/**
 * @module tests/liteai.test
 * @description LiteAI 백엔드 통합 테스트 스위트
 *
 * 리팩토링된 모듈 구조에 맞춰 import 경로를 업데이트하고
 * 리포지토리 패턴의 메서드 호출로 변경하였습니다.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import server from "../src/index";
import {
  db,
  conversationRepository,
  messageRepository,
  settingRepository,
} from "../src/database";
import { resolveSafePath } from "../src/utils/security";
import {
  writeWorkspaceFile,
  readWorkspaceFile,
  listFiles,
  deleteWorkspaceFile,
} from "../src/services/file.service";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";

describe("LiteAI Backend Engine Tests", () => {
  
  describe("Database Operations", () => {
    const testId = "test-conversation-uuid-12345";

    beforeAll(() => {
      conversationRepository.deleteById(testId);
    });

    it("should successfully save a setting", () => {
      settingRepository.set("test_key", "test_value");
      expect(settingRepository.get("test_key")).toBe("test_value");
    });

    it("should create and retrieve a conversation", () => {
      conversationRepository.create(testId, "Test Title", "llama3", "ollama", "system prompt test");
      const conv = conversationRepository.getById(testId);
      
      expect(conv).not.toBeNull();
      expect(conv?.title).toBe("Test Title");
      expect(conv?.model).toBe("llama3");
      expect(conv?.provider).toBe("ollama");
      expect(conv?.system_prompt).toBe("system prompt test");
    });

    it("should list conversations and include the new one", () => {
      const list = conversationRepository.list();
      const match = list.find((c) => c.id === testId);
      expect(match).toBeDefined();
    });

    it("should write and read messages in order", () => {
      const msgId1 = "msg-1";
      const msgId2 = "msg-2";
      messageRepository.create(msgId1, testId, "user", "Hello Assistant");
      messageRepository.create(msgId2, testId, "assistant", "Hello User");

      const msgs = messageRepository.getByConversationId(testId);
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("Hello Assistant");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBe("Hello User");
    });

    it("should successfully cascade delete messages when conversation is deleted", () => {
      conversationRepository.deleteById(testId);
      const conv = conversationRepository.getById(testId);
      expect(conv).toBeNull();
      
      const msgs = messageRepository.getByConversationId(testId);
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
      const res = await server.fetch(new Request("http://localhost/api/auth/%2e%2e/conversations"));
      expect(res.status).toBe(401);
    });
  });
});
