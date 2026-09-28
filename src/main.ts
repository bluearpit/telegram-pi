import { loadConfig } from "./config.js";
import { PiHost } from "./pi.js";
import { makeBot } from "./telegram.js";

const config = loadConfig();
const pi = new PiHost(config.defaultCwd);
const bot = makeBot(config, pi);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
try {
  // Telegram bot tokens must have exactly one active long poller.
  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.info(`Polling Telegram as @${info.username}; Pi sessions remain in Pi`),
  });
} finally {
  pi.dispose();
}
