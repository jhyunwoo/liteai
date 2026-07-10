import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-liteai.db");
process.env.DATABASE_PATH = dbFile;

// Import db modules after setting DATABASE_PATH
import {
  db,
  userRepository,
  sessionRepository,
  conversationRepository,
  messageRepository,
  settingRepository,
  agentTaskRepository
} from "../../src/database";

describe("Database Unit Tests", () => {
  beforeAll(() => {
    db.run("DELETE FROM sessions;");
    db.run("DELETE FROM users;");
    db.run("DELETE FROM conversations;");
    db.run("DELETE FROM settings;");
    db.run("DELETE FROM agent_tasks;");
  });

  afterAll(() => {
    // Cleanup test database
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  describe("User Operations", () => {
    it("should count users and create new users", () => {
      const initialCount = userRepository.getCount();
      expect(initialCount).toBe(0);

      userRepository.create("admin", "hashed_password");
      expect(userRepository.getCount()).toBe(1);

      const user = userRepository.getByUsername("admin");
      expect(user).not.toBeNull();
      expect(user?.username).toBe("admin");
      expect(user?.password_hash).toBe("hashed_password");

      const nonExistent = userRepository.getByUsername("non_existent");
      expect(nonExistent).toBeNull();
    });
  });

  describe("Session Operations", () => {
    it("should manage user sessions including expiration", () => {
      const token = "test-token-xyz";
      const expiresAt = new Date(Date.now() + 1000 * 60); // 1 min in future
      sessionRepository.create(token, "admin", expiresAt);

      const session = sessionRepository.getByToken(token);
      expect(session).not.toBeNull();
      expect(session?.username).toBe("admin");

      // Test expired session
      const expiredToken = "expired-token";
      const pastExpires = new Date(Date.now() - 1000); // 1 sec in past
      sessionRepository.create(expiredToken, "admin", pastExpires);

      const expiredSession = sessionRepository.getByToken(expiredToken);
      expect(expiredSession).toBeNull(); // Should be auto-deleted

      // Test manual deletion
      sessionRepository.deleteByToken(token);
      expect(sessionRepository.getByToken(token)).toBeNull();
    });
  });

  describe("Conversation and Message Operations", () => {
    const convId = "conv-123";

    it("should handle conversation lifecycle", () => {
      conversationRepository.create(convId, "Test Conv", "model-x", "provider-y", "system-prompt-z");
      
      const conv = conversationRepository.getById(convId);
      expect(conv).not.toBeNull();
      expect(conv?.title).toBe("Test Conv");
      expect(conv?.model).toBe("model-x");
      expect(conv?.provider).toBe("provider-y");
      expect(conv?.system_prompt).toBe("system-prompt-z");

      // List conversations
      const list = conversationRepository.list();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some(c => c.id === convId)).toBe(true);

      // Update title
      conversationRepository.updateTitle(convId, "Updated Conv");
      expect(conversationRepository.getById(convId)?.title).toBe("Updated Conv");

      // Update settings
      conversationRepository.updateSettings(convId, "new-provider", "new-model");
      const updated = conversationRepository.getById(convId);
      expect(updated?.provider).toBe("new-provider");
      expect(updated?.model).toBe("new-model");
    });

    it("should handle messages and cascade delete them", () => {
      messageRepository.create("msg-1", convId, "user", "Hello World");
      messageRepository.create("msg-2", convId, "assistant", "Hi there");

      const messages = messageRepository.getByConversationId(convId);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello World");

      // Delete conversation should cascade delete messages
      conversationRepository.deleteById(convId);
      expect(conversationRepository.getById(convId)).toBeNull();
      expect(messageRepository.getByConversationId(convId).length).toBe(0);
    });
  });

  describe("Settings Operations", () => {
    it("should get, set, and list settings", () => {
      settingRepository.set("theme", "dark");
      settingRepository.set("language", "ko");

      expect(settingRepository.get("theme")).toBe("dark");
      expect(settingRepository.get("language")).toBe("ko");

      const all = settingRepository.listAll();
      expect(all["theme"]).toBe("dark");
      expect(all["language"]).toBe("ko");
    });
  });

  describe("Agent Tasks Operations", () => {
    const taskId = "task-abc";

    it("should handle agent task logs and status", () => {
      agentTaskRepository.create(taskId, "Analyze codebase", "pending", "Task initialized");
      
      const task = agentTaskRepository.getById(taskId);
      expect(task).not.toBeNull();
      expect(task?.description).toBe("Analyze codebase");
      expect(task?.status).toBe("pending");
      expect(task?.logs).toBe("Task initialized");

      agentTaskRepository.update(taskId, "running", "Task initialized\nRunning analyzing");
      const updated = agentTaskRepository.getById(taskId);
      expect(updated?.status).toBe("running");
      expect(updated?.logs).toContain("Running analyzing");

      const allTasks = agentTaskRepository.list();
      expect(allTasks.length).toBeGreaterThanOrEqual(1);
      expect(allTasks.some(t => t.id === taskId)).toBe(true);
    });
  });
});
