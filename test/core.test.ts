import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { directory, loadConfig } from "../src/config.js";
import { chunks, label } from "../src/telegram.js";

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

test("formats short Telegram labels and splits Unicode safely", () => {
  const session = { name: "A".repeat(90), cwd: "/tmp/project", firstMessage: "ignored" };
  assert.equal(label(session as Parameters<typeof label>[0]).length, 58);
  assert.deepEqual(chunks("🦊🦊🦊", 2), ["🦊🦊", "🦊"]);
});
