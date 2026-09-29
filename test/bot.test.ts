import assert from "node:assert/strict";
import test from "node:test";
import type { Update } from "grammy/types";
import { makeBot } from "../src/telegram.js";
import type { PiHost } from "../src/pi.js";

const fakePi = {
  cwd: "/tmp", preferredDirectory: "/tmp", sessionFile: undefined,
  model: "not selected", isBusy: false,
  context: () => "Pi context: test snapshot",
  openManaged: async () => {},
} as unknown as PiHost;

function update(user: number, chatType: "private" | "group", text: string): Update {
  return { update_id: user, message: {
    message_id: 1, date: 1, chat: { id: user, type: chatType },
    from: { id: user, is_bot: false, first_name: "test" }, text,
    entities: [{ type: "bot_command", offset: 0, length: text.length }],
  } } as Update;
}

test("only an allowlisted private user can reach Pi commands", async () => {
  const bot = makeBot({
    token: "123:fake", allowedUsers: new Set([123]), defaultCwd: "/tmp",
    managedStateDir: "/tmp/managed-sessions", controlSocket: "/tmp/control.sock", agentrecallBin: "agentrecall",
  }, fakePi);
  bot.botInfo = { id: 900, is_bot: true, first_name: "test", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as typeof bot.botInfo;
  const sent: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage" && "text" in payload) sent.push(String(payload.text));
    return { ok: true, result: { message_id: 1, date: 1, chat: { id: 123, type: "private" } } } as never;
  });
  await bot.handleUpdate(update(777, "private", "/status"));
  await bot.handleUpdate(update(123, "group", "/status"));
  assert.equal(sent.length, 0);
  await bot.handleUpdate(update(123, "private", "/status"));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Session: none/);
  await bot.handleUpdate(update(123, "private", "/context"));
  assert.equal(sent[1], "Pi context: test snapshot");
});
