import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { directory, loadConfig } from "../src/config.js";
import { formatContext } from "../src/context.js";
import { COMMANDS, chunks, label } from "../src/telegram.js";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

test("fails closed without numeric allowed user IDs or a token", () => {
  assert.throws(() => loadConfig({ TELEGRAM_BOT_TOKEN: "test:token" }), /TELEGRAM_ALLOWED_USERS/);
  assert.throws(() => loadConfig({ TELEGRAM_ALLOWED_USERS: "123" }), /TELEGRAM_BOT_TOKEN/);
  assert.throws(() => loadConfig({ TELEGRAM_BOT_TOKEN: "test:token", TELEGRAM_ALLOWED_USERS: "abc" }), /numeric/);
});

test("only absolute existing directories can be used for Pi", () => {
  const cwd = mkdtempSync(join(tmpdir(), "telegram-pi-"));
  try {
    assert.equal(directory(cwd), cwd);
    assert.throws(() => directory("relative"), /absolute/);
    assert.throws(() => directory(join(cwd, "missing")));
  } finally { rmSync(cwd, { recursive: true }); }
});

test("Telegram menu only advertises supported Pi commands", () => {
  const commands = COMMANDS.map(({ command }) => command);
  assert.equal(new Set(commands).size, commands.length);
  assert.deepEqual(commands, ["start", "sessions", "search", "use", "new", "cwd", "model", "status", "context", "cancel", "help"]);
});

test("context counts only active summaries but reports all compactions", () => {
  const session = {
    getContextUsage: () => ({ tokens: 1000, contextWindow: 2000, percent: 50 }),
    sessionManager: {
      buildSessionProjection: () => ({ messages: [
        { role: "system", content: "abcd", sections: { skills: "skill", rules: "rule" } },
        { role: "compactionSummary", summary: "a".repeat(40) },
        { role: "user", content: "b".repeat(40) },
      ] }),
      getBranch: () => [{ type: "compaction" }, { type: "compaction" }],
    },
    systemPrompt: "fallback",
    getActiveToolNames: () => [],
    getAllTools: () => [],
  } as unknown as AgentSession;
  const output = formatContext(session);
  assert.match(output, /Compaction summary: ~10 \(2 compactions on this branch\)/);
  assert.match(output, /Conversation: ~10/);
  assert.match(output, /Pi context: 1.0k \/ 2.0k \(50.0%\)/);
});

test("formats short Telegram labels and splits Unicode safely", () => {
  const session = { name: "A".repeat(90), cwd: "/tmp/project", firstMessage: "ignored" };
  assert.equal(label(session as Parameters<typeof label>[0]).length, 58);
  assert.deepEqual(chunks("🦊🦊🦊", 2), ["🦊🦊", "🦊"]);
});
