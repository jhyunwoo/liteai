import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import server from "../../src/index";

const dbFile = join(process.cwd(), "tests/integration/test-api-db.db");
const workspaceDir = join(process.cwd(), "tests/integration/test-workspace");
process.env.DATABASE_PATH = dbFile;
process.env.WORKSPACE_PATH = workspaceDir;

import * as db from "../../src/database";
import { rm } from "fs/promises";

describe("API Server Integration Tests", () => {
  let sessionToken = "";

  beforeAll(async () => {
    // Clean DB state for isolated test
    db.db.run("DELETE FROM sessions;");
    db.db.run("DELETE FROM users;");
    db.db.run("DELETE FROM conversations;");
    db.db.run("DELETE FROM messages;");
    db.db.run("DELETE FROM settings;");
    db.db.run("DELETE FROM agent_tasks;");
  });

  afterAll(async () => {
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
    if (existsSync(workspaceDir)) {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  describe("Public Setup Flow", () => {
    it("should allow first-time admin setup", async () => {
      const res = await server.fetch(new Request("http://localhost/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "password123" })
      }));
      
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.username).toBe("admin");

      // Verify cookie
      const cookieHeader = res.headers.get("Set-Cookie");
      expect(cookieHeader).not.toBeNull();
      expect(cookieHeader).toContain("session_token=");
      
      const tokenMatch = /session_token=([^;]+)/.exec(cookieHeader || "");
      if (tokenMatch) {
        sessionToken = tokenMatch[1];
      }
    });

    it("should block subsequent admin setup attempts", async () => {
      const res = await server.fetch(new Request("http://localhost/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "hack", password: "password123" })
      }));
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("already exists");
    });
  });

  describe("Auth Verification Middleware", () => {
    it("should reject requests without a session cookie", async () => {
      const res = await server.fetch(new Request("http://localhost/api/conversations"));
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toContain("Session token missing");
    });

    it("should reject requests with invalid/expired cookies", async () => {
      const res = await server.fetch(new Request("http://localhost/api/conversations", {
        headers: { "Cookie": "session_token=invalid-token" }
      }));
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toContain("expired or invalid");
    });

    it("should allow request with valid session token cookie", async () => {
      const res = await server.fetch(new Request("http://localhost/api/conversations", {
        headers: { "Cookie": `session_token=${sessionToken}` }
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe("File API and Path Traversal Verification", () => {
    it("should successfully write file via POST", async () => {
      const res = await server.fetch(new Request("http://localhost/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `session_token=${sessionToken}`,
          "Origin": "http://localhost"
        },
        body: JSON.stringify({ path: "app.ts", content: "console.log('liteai');" })
      }));
      expect(res.status).toBe(200);
    });

    it("should block writing file outside workspace using Traversal path", async () => {
      const res = await server.fetch(new Request("http://localhost/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `session_token=${sessionToken}`,
          "Origin": "http://localhost"
        },
        body: JSON.stringify({ path: "../traversal.ts", content: "console.log('hacked');" })
      }));
      expect(res.status).toBe(500); // Throws Resolve Safe Path Traversal Error
      const data = await res.json() as any;
      expect(data.error).toContain("Access denied");
    });
  });
});
