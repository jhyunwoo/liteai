import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-liteai.db");
process.env.DATABASE_PATH = dbFile;

// Import db module after setting DATABASE_PATH
import * as db from "../../src/db";

describe("Database Unit Tests", () => {
  beforeAll(() => {
    db.db.run("DELETE FROM sessions;");
    db.db.run("DELETE FROM users;");
    db.db.run("DELETE FROM conversations;");
    db.db.run("DELETE FROM settings;");
    db.db.run("DELETE FROM agent_tasks;");
  });

  afterAll(() => {
    // Cleanup test database
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  describe("User Operations", () => {
    it("should count users and create new users", () => {
      const initialCount = db.getUsersCount();
      expect(initialCount).toBe(0);

      db.createUser("admin", "hashed_password");
      expect(db.getUsersCount()).toBe(1);

      const user = db.getUser("admin");
      expect(user).not.toBeNull();
      expect(user?.username).toBe("admin");
      expect(user?.password_hash).toBe("hashed_password");

      const nonExistent = db.getUser("non_existent");
      expect(nonExistent).toBeNull();
    });
  });

  describe("Session Operations", () => {
    it("should manage user sessions including expiration", () => {
      const token = "test-token-xyz";
      const expiresAt = new Date(Date.now() + 1000 * 60); // 1 min in future
      db.createSession(token, "admin", expiresAt);

      const session = db.getSession(token);
      expect(session).not.toBeNull();
      expect(session?.username).toBe("admin");

      // Test expired session
      const expiredToken = "expired-token";
      const pastExpires = new Date(Date.now() - 1000); // 1 sec in past
      db.createSession(expiredToken, "admin", pastExpires);

      const expiredSession = db.getSession(expiredToken);
      expect(expiredSession).toBeNull(); // Should be auto-deleted

      // Test manual deletion
      db.deleteSession(token);
      expect(db.getSession(token)).toBeNull();
    });
  });

  describe("Conversation and Message Operations", () => {
    const convId = "conv-123";

    it("should handle conversation lifecycle", () => {
      db.createConversation(convId, "Test Conv", "model-x", "provider-y", "system-prompt-z");
      
      const conv = db.getConversation(convId);
      expect(conv).not.toBeNull();
      expect(conv?.title).toBe("Test Conv");
      expect(conv?.model).toBe("model-x");
      expect(conv?.provider).toBe("provider-y");
      expect(conv?.system_prompt).toBe("system-prompt-z");

      // List conversations
      const list = db.listConversations();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some(c => c.id === convId)).toBe(true);

      // Update title
      db.updateConversationTitle(convId, "Updated Conv");
      expect(db.getConversation(convId)?.title).toBe("Updated Conv");

      // Update settings
      db.updateConversationSettings(convId, "new-provider", "new-model");
      const updated = db.getConversation(convId);
      expect(updated?.provider).toBe("new-provider");
      expect(updated?.model).toBe("new-model");
    });

    it("should handle messages and cascade delete them", () => {
      db.addMessage("msg-1", convId, "user", "Hello World");
      db.addMessage("msg-2", convId, "assistant", "Hi there");

      const messages = db.getMessages(convId);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello World");

      // Delete conversation should cascade delete messages
      db.deleteConversation(convId);
      expect(db.getConversation(convId)).toBeNull();
      expect(db.getMessages(convId).length).toBe(0);
    });
  });

  describe("Settings Operations", () => {
    it("should get, set, and list settings", () => {
      db.setSetting("theme", "dark");
      db.setSetting("language", "ko");

      expect(db.getSetting("theme")).toBe("dark");
      expect(db.getSetting("language")).toBe("ko");

      const all = db.listSettings();
      expect(all["theme"]).toBe("dark");
      expect(all["language"]).toBe("ko");
    });
  });

  describe("Agent Tasks Operations", () => {
    const taskId = "task-abc";

    it("should handle agent task logs and status", () => {
      db.createAgentTask(taskId, "Analyze codebase", "pending", "Task initialized");
      
      const task = db.getAgentTask(taskId);
      expect(task).not.toBeNull();
      expect(task?.description).toBe("Analyze codebase");
      expect(task?.status).toBe("pending");
      expect(task?.logs).toBe("Task initialized");

      db.updateAgentTask(taskId, "running", "Task initialized\nRunning analyzing");
      const updated = db.getAgentTask(taskId);
      expect(updated?.status).toBe("running");
      expect(updated?.logs).toContain("Running analyzing");

      const allTasks = db.listAgentTasks();
      expect(allTasks.length).toBeGreaterThanOrEqual(1);
      expect(allTasks.some(t => t.id === taskId)).toBe(true);
    });
  });
});
