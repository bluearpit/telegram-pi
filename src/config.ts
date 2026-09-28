import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface Config {
  token: string;
  allowedUsers: Set<number>;
  defaultCwd: string;
  agentrecallBin: string;
}

export function directory(value: string): string {
  if (!isAbsolute(value)) throw new Error("Working directory must be an absolute path");
  const path = resolve(value);
  if (!statSync(path).isDirectory()) throw new Error("Working directory is not a directory");
  return path;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || token === "replace-me") throw new Error("TELEGRAM_BOT_TOKEN is required");
  const ids = env.TELEGRAM_ALLOWED_USERS?.split(",").map((id) => id.trim()) ?? [];
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error("TELEGRAM_ALLOWED_USERS must contain numeric Telegram user IDs");
  }
  return {
    token,
    allowedUsers: new Set(ids.map(Number)),
    defaultCwd: directory(env.PI_DEFAULT_CWD || homedir()),
    agentrecallBin: env.AGENTRECALL_BIN || "agentrecall",
  };
}
