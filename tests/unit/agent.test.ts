import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

const dbFile = join(process.cwd(), "tests/unit/test-agent-db.db");
process.env.DATABASE_PATH = dbFile;

import { settingRepository, agentTaskRepository } from "../../src/database";
import { runAgentTask } from "../../src/services/agent.service";

describe("AI Agent Unit & Security Tests", () => {
  let originalFetch: any;

  beforeAll(() => {
    originalFetch = global.fetch;
    settingRepository.set("active_provider", "ollama");
    settingRepository.set("active_model", "llama3");
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (existsSync(dbFile)) {
      unlinkSync(dbFile);
    }
  });

  it("should block unsafe commands and log security error in task logs", async () => {
    const taskId = "test-agent-task-unsafe";
    const description = "Delete root files";

    // Mock LLM response to call run_command with a dangerous command
    global.fetch = async (url: any) => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: `<thought>I will execute a command</thought><call name="run_command">{"cmd": "sudo rm -rf /"}</call>`
          }
        }]
      }));
    };

    // runAgentTask will call run_command which will trigger our guard and write the error in logs.
    await runAgentTask(taskId, description);

    // Wait a brief moment
    await new Promise(resolve => setTimeout(resolve, 50));

    const task = agentTaskRepository.getById(taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe("failed");
    expect(task?.logs).toContain("Security blocked: execution of command containing 'sudo' is prohibited.");
  });

  it("should block directory traversal commands", async () => {
    const taskId = "test-agent-task-traversal";
    const description = "Read shadow files";

    global.fetch = async (url: any) => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: `<thought>I will execute traversal</thought><call name="run_command">{"cmd": "cat ../../../some_folder/file.txt"}</call>`
          }
        }]
      }));
    };

    await runAgentTask(taskId, description);
    
    await new Promise(resolve => setTimeout(resolve, 50));

    const task = agentTaskRepository.getById(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.logs).toContain("Security blocked: directory traversal or system paths in command are prohibited.");
  });

  it("should succeed when Agent finishes the task cleanly", async () => {
    const taskId = "test-agent-task-success";
    const description = "Check if workspace is initialized";

    // Mock LLM to return finish command
    global.fetch = async (url: any) => {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: `<thought>I will finish the task</thought><finish>Task completed successfully</finish>`
          }
        }]
      }));
    };

    await runAgentTask(taskId, description);
    
    await new Promise(resolve => setTimeout(resolve, 50));

    const task = agentTaskRepository.getById(taskId);
    expect(task?.status).toBe("success");
    expect(task?.logs).toContain("[Agent Finished] Task completed successfully");
  });
});
