import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startSessionControl, type SessionPromptRequest } from "../src/control.js";

async function request(socketPath: string, payload: unknown): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("error", reject);
    socket.on("end", () => {
      try { resolve(JSON.parse(response)); }
      catch (error) { reject(error); }
    });
    socket.on("connect", () => socket.end(JSON.stringify(payload) + "\n"));
  });
}

test("control socket accepts a valid managed-session prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-pi-control-"));
  const socketPath = join(directory, "control.sock");
  let received: SessionPromptRequest | undefined;
  let resolveHandled!: () => void;
  const handled = new Promise<void>((resolve) => { resolveHandled = resolve; });
  const control = await startSessionControl(socketPath, async (value) => {
    received = value;
    resolveHandled();
  });
  try {
    assert.deepEqual(await request(socketPath, {
      type: "session_prompt",
      session: {
        key: "daily-review",
        name: "Daily Review",
        cwd: directory,
        modelPreferenceOrder: ["provider/primary", "provider/fallback"],
      },
      prompt: "Review recent logs",
    }), { ok: true });
    await handled;
    assert.equal(received?.session.key, "daily-review");
    assert.deepEqual(received?.session.modelPreferenceOrder, ["provider/primary", "provider/fallback"]);
    assert.equal(received?.prompt, "Review recent logs");
  } finally {
    await control.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("control socket rejects an invalid model preference order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-pi-control-"));
  const socketPath = join(directory, "control.sock");
  const control = await startSessionControl(socketPath, async () => {});
  try {
    const response = await request(socketPath, {
      type: "session_prompt",
      session: { key: "review", name: "Review", cwd: directory, modelPreferenceOrder: ["not-a-model"] },
      prompt: "Review recent logs",
    }) as { ok: boolean; error?: string };
    assert.equal(response.ok, false);
    assert.match(response.error || "", /modelPreferenceOrder entries must use provider\/model-id/);
  } finally {
    await control.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("control socket rejects malformed and unsafe managed-session requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-pi-control-"));
  const socketPath = join(directory, "control.sock");
  let handled = false;
  const control = await startSessionControl(socketPath, async () => { handled = true; });
  try {
    const response = await request(socketPath, {
      type: "session_prompt",
      session: { key: "../escape", name: "Unsafe", cwd: directory },
      prompt: "Do something",
    }) as { ok: boolean; error?: string };
    assert.equal(response.ok, false);
    assert.match(response.error || "", /Invalid managed session key/);
    assert.equal(handled, false);
  } finally {
    await control.close();
    await rm(directory, { recursive: true, force: true });
  }
});
