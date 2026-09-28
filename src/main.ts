import { loadConfig } from "./config.js";
import { PiHost } from "./pi.js";
import { COMMANDS, makeBot } from "./telegram.js";

const config = loadConfig();
const pi = new PiHost(config.defaultCwd);
const bot = makeBot(config, pi);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
try {
  // Telegram bot tokens must have exactly one active long poller.
  await bot.start({
    drop_pending_updates: true,
    onStart: async (info) => {
      await bot.api.setMyCommands(COMMANDS.map(({ command, description }) => ({ command, description })));
      console.info(`Polling Telegram as @${info.username}; registered ${COMMANDS.length} Pi commands`);
    },
  });
} finally {
  pi.dispose();
}
