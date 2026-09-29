import { InlineKeyboard } from "grammy";
import { loadConfig } from "./config.js";
import { startSessionControl } from "./control.js";
import { PiHost } from "./pi.js";
import { chunks, COMMANDS, makeBot } from "./telegram.js";

const config = loadConfig();
const pi = new PiHost(config.managedStateDir, config.defaultCwd);
const bot = makeBot(config, pi);

const control = await startSessionControl(config.controlSocket, async ({ session, prompt }) => {
  try {
    const result = await pi.promptManaged(session, prompt);
    const keyboard = new InlineKeyboard().text(`Open ${session.name}`.slice(0, 60), `managed:${session.key}`);
    for (const [index, text] of chunks(result.text).entries()) {
      await bot.api.sendMessage(
        [...config.allowedUsers][0],
        index === 0 ? text : `${session.name} (continued)\n${text}`,
        index === 0 ? { reply_markup: keyboard } : undefined,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Managed session failed";
    await bot.api.sendMessage([...config.allowedUsers][0], `${session.name} failed: ${message}`);
    throw error;
  }
});

let stopped = false;
const stop = async () => {
  if (stopped) return;
  stopped = true;
  await control.close();
  bot.stop();
  pi.dispose();
};
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
try {
  await bot.start({
    drop_pending_updates: true,
    onStart: async (info) => {
      await bot.api.setMyCommands(COMMANDS.map(({ command, description }) => ({ command, description })));
      console.info(`Polling Telegram as @${info.username}; registered ${COMMANDS.length} Pi commands`);
    },
  });
} finally {
  await stop();
}
