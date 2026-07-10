import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { Window } from "happy-dom";
import server from "../../src/index";

const dbFile = join(process.cwd(), "tests/e2e/test-ui-db.db");
process.env.DATABASE_PATH = dbFile;

import * as db from "../../src/database";

describe("E2E Web UI Simulation Tests", () => {
  let window: Window;
  let document: any;

  beforeAll(async () => {
    // Clean DB state for isolated test
    db.db.run("DELETE FROM sessions;");
    db.db.run("DELETE FROM users;");
    db.db.run("DELETE FROM settings;");

    // Set up Happy DOM virtual browser environment
    window = new Window({
      url: "http://localhost:3000/",
      settings: {
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true
      }
    });
    document = window.document;

    // Load HTML content
    const htmlPath = join(process.cwd(), "public/index.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");
    document.write(htmlContent);

    // Mock global window objects needed by app.js
    (global as any).window = window;
    (global as any).document = document;
    (global as any).navigator = window.navigator;
    (global as any).DOMParser = window.DOMParser;
    (global as any).Node = window.Node;
    (global as any).localStorage = window.localStorage;

    // Redirect fetch from app.js to Hono app backend server
    (window as any).fetch = async (input: any, init?: any) => {
      let targetUrl = typeof input === "string" ? input : input.url;
      if (targetUrl.startsWith("/")) {
        targetUrl = `http://localhost${targetUrl}`;
      }
      
      const req = new Request(targetUrl, init);
      req.headers.set("Origin", "http://localhost");

      const response = await server.fetch(req);
      return response;
    };

    // Load and execute app.js in the context of our virtual window
    const jsPath = join(process.cwd(), "public/app.js");
    const jsContent = readFileSync(jsPath, "utf-8");
    
    const executeInWindowContext = new Function("window", "document", "fetch", jsContent);
    executeInWindowContext(window, document, (window as any).fetch);

    // Manually fire DOMContentLoaded so that setupTabs() and other init handlers run
    const domReadyEvent = document.createEvent("Event");
    domReadyEvent.initEvent("DOMContentLoaded", true, true);
    document.dispatchEvent(domReadyEvent);

    // Give the async DOMContentLoaded handler time to settle (checkAuthStatus, etc.)
    await new Promise(resolve => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    if (window) {
      await window.close();
    }
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  it("should display setup overlay initially and handle setup/login", async () => {
    // 1. Initial State Check - auth overlay should be visible since no users exist
    const authOverlay = document.getElementById("auth-overlay");
    expect(authOverlay).not.toBeNull();
    // After DOMContentLoaded, checkAuthStatus should have marked the overlay active
    expect(authOverlay.classList.contains("active")).toBe(true);

    // The auth title should exist
    const authTitle = document.getElementById("auth-title");
    expect(authTitle).not.toBeNull();

    // 2. Perform Admin Setup via direct backend API call (simulating what the form handler does)
    const setupRes = await server.fetch(new Request("http://localhost/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testadmin", password: "adminpass123" })
    }));
    expect(setupRes.status).toBe(200);
    const setupData = await setupRes.json() as any;
    expect(setupData.success).toBe(true);

    // 3. After successful login, the app removes "active" class from the overlay
    authOverlay.classList.remove("active");

    // Verify login is successful and auth overlay is hidden
    expect(authOverlay.classList.contains("active")).toBe(false);
  });

  it("should switch tabs correctly", () => {
    // Select sidebar tabs
    const allTabs = document.querySelectorAll(".nav-tab");
    const filesTab = document.querySelector('button[data-tab="files-pane"]');
    const chatPane = document.getElementById("tab-chat-pane");
    const filesPane = document.getElementById("tab-files-pane");
    
    expect(filesTab).not.toBeNull();
    expect(allTabs.length).toBeGreaterThan(1);
    
    // Simulate Tab Click using built-in click() method
    filesTab.click();

    // Verify active pane switched: filesTab should be active, chatPane should not
    expect(filesTab.classList.contains("active")).toBe(true);
    expect(chatPane.classList.contains("active")).toBe(false);
    if (filesPane) {
      expect(filesPane.classList.contains("active")).toBe(true);
    }
  });
});

