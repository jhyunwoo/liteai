import { Database } from "bun:sqlite";
import { join } from "path";

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), "liteai.db");
const db = new Database(dbPath);

// Enable foreign keys
db.run("PRAGMA foreign_keys = ON;");

// Initialize DB schema
db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    system_prompt TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    logs TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export interface Conversation {
  id: string;
  title: string;
  model: string;
  provider: string;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface AgentTask {
  id: string;
  description: string;
  status: string;
  logs: string;
  created_at: string;
}

// Conversations Helper functions
export function listConversations(): Conversation[] {
  const query = db.query<Conversation, []>(
    "SELECT * FROM conversations ORDER BY updated_at DESC"
  );
  return query.all();
}

export function getConversation(id: string): Conversation | null {
  const query = db.query<Conversation, [string]>(
    "SELECT * FROM conversations WHERE id = ?"
  );
  return query.get(id);
}

export function createConversation(
  id: string,
  title: string,
  model: string,
  provider: string,
  systemPrompt: string | null
): void {
  db.run(
    "INSERT INTO conversations (id, title, model, provider, system_prompt) VALUES (?, ?, ?, ?, ?)",
    [id, title, model, provider, systemPrompt]
  );
}

export function updateConversationTitle(id: string, title: string): void {
  db.run(
    "UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [title, id]
  );
}

export function updateConversationSettings(id: string, provider: string, model: string): void {
  db.run(
    "UPDATE conversations SET provider = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [provider, model, id]
  );
}

export function deleteConversation(id: string): void {
  db.run("DELETE FROM conversations WHERE id = ?", [id]);
}

// Messages Helper functions
export function getMessages(conversationId: string): Message[] {
  const query = db.query<Message, [string]>(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  );
  return query.all(conversationId);
}

export function addMessage(
  id: string,
  conversationId: string,
  role: string,
  content: string
): void {
  db.run(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
    [id, conversationId, role, content]
  );
  db.run(
    "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [conversationId]
  );
}

// Settings Helper functions
export function getSetting(key: string): string | null {
  const query = db.query<{ value: string }, [string]>(
    "SELECT value FROM settings WHERE key = ?"
  );
  const res = query.get(key);
  return res ? res.value : null;
}

export function setSetting(key: string, value: string): void {
  db.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [key, value]
  );
}

export function listSettings(): Record<string, string> {
  const query = db.query<Setting, []>("SELECT * FROM settings");
  const settings: Record<string, string> = {};
  for (const s of query.all()) {
    settings[s.key] = s.value;
  }
  return settings;
}

// Agent Tasks Helper functions
export function listAgentTasks(): AgentTask[] {
  const query = db.query<AgentTask, []>(
    "SELECT * FROM agent_tasks ORDER BY created_at DESC"
  );
  return query.all();
}

export function getAgentTask(id: string): AgentTask | null {
  const query = db.query<AgentTask, [string]>(
    "SELECT * FROM agent_tasks WHERE id = ?"
  );
  return query.get(id);
}

export function createAgentTask(
  id: string,
  description: string,
  status: string,
  logs: string
): void {
  db.run(
    "INSERT INTO agent_tasks (id, description, status, logs) VALUES (?, ?, ?, ?)",
    [id, description, status, logs]
  );
}

export function updateAgentTask(
  id: string,
  status: string,
  logs: string
): void {
  db.run(
    "UPDATE agent_tasks SET status = ?, logs = ? WHERE id = ?",
    [status, logs, id]
  );
}

// User and Session helper functions
export interface User {
  username: string;
  password_hash: string;
  created_at: string;
}

export interface Session {
  token: string;
  username: string;
  expires_at: string;
}

export function getUsersCount(): number {
  const query = db.query<{"COUNT(*)": number}, []>("SELECT COUNT(*) FROM users");
  const res = query.get();
  return res ? res["COUNT(*)"] : 0;
}

export function createUser(username: string, passwordHash: string): void {
  db.run(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    [username, passwordHash]
  );
}

export function getUser(username: string): User | null {
  const query = db.query<User, [string]>("SELECT * FROM users WHERE username = ?");
  return query.get(username);
}

export function createSession(token: string, username: string, expiresAt: Date): void {
  db.run(
    "INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)",
    [token, username, expiresAt.toISOString()]
  );
}

export function getSession(token: string): Session | null {
  const query = db.query<Session, [string]>("SELECT * FROM sessions WHERE token = ?");
  const session = query.get(token);
  if (!session) return null;
  
  // Check if session has expired
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  
  return session;
}

export function deleteSession(token: string): void {
  db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

export { db };
