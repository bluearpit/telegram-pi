import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Bot, InlineKeyboard, type Context } from "grammy";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.js";
import { PiHost } from "./pi.js";

const exec = promisify(execFile);
const PAGE_SIZE = 6;
// One source of truth for Telegram's slash menu and /help. setMyCommands
// replaces any stale commands left on a bot token by a previous gateway.
export const COMMANDS = [
  { command: "start", description: "Get started with Pi", usage: "/start — get started" },
  { command: "sessions", description: "Browse Pi sessions", usage: "/sessions — browse Pi sessions from all projects" },
  { command: "search", description: "Search Pi history", usage: "/search query — search Pi history through Agent Recall" },
  { command: "use", description: "Resume a Pi session", usage: "/use ID — resume a listed session" },
  { command: "new", description: "Start a new Pi session", usage: "/new [absolute directory] — start a session" },
  { command: "cwd", description: "Set directory for new sessions", usage: "/cwd absolute-directory — set directory for the next new session" },
  { command: "model", description: "Browse or change Pi model", usage: "/model [provider/model] — browse or change available models" },
  { command: "status", description: "Show current Pi session", usage: "/status — current Pi session, directory, model" },
  { command: "context", description: "Show Pi context usage", usage: "/context — context total, categories, and compaction summary" },
  { command: "cancel", description: "Stop the current Pi turn", usage: "/cancel — stop the running turn" },
  { command: "help", description: "Show Pi commands", usage: "/help — commands" },
] as const;
const HELP = `Pi on Telegram\n${COMMANDS.map((item) => item.usage).join("\n")}\n\nSend a text message to prompt Pi in the selected session. Only private chats from allowed users are accepted.`;

export function label(session: SessionInfo): string {
  const name = session.name || session.firstMessage || "Untitled";
  const project = session.cwd.split("/").filter(Boolean).at(-1) || "/";
  return `${project} · ${name}`.slice(0, 58);
}

export function chunks(text: string, max = 3500): string[] {
  const chars = [...text];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i += max) result.push(chars.slice(i, i + max).join(""));
  return result.length ? result : ["(empty response)"];
}

async function reply(ctx: Context, text: string): Promise<void> {
  for (const chunk of chunks(text)) await ctx.reply(chunk);
}

export function makeBot(config: Config, pi: PiHost): Bot {
  const bot = new Bot(config.token);
  let modelChoices: Array<{ provider: string; id: string }> = [];

  // Authorization applies before *every* command, callback and message handler.
  bot.use(async (ctx, next) => {
    if (!ctx.from || !config.allowedUsers.has(ctx.from.id) || ctx.chat?.type !== "private") {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Not authorized" });
      return;
    }
    await next();
  });

  async function safe(ctx: Context, work: () => Promise<void>): Promise<void> {
    try { await work(); }
    catch (error) { await reply(ctx, error instanceof Error ? error.message : "Operation failed"); }
  }

  async function showSessions(ctx: Context, page: number, results?: SessionInfo[]): Promise<void> {
    const sessions = results ?? await pi.list();
    if (!sessions.length) { await reply(ctx, "No Pi sessions found. Use /new to create one."); return; }
    const lastPage = Math.max(0, Math.ceil(sessions.length / PAGE_SIZE) - 1);
    const current = Math.max(0, Math.min(page, lastPage));
    const keyboard = new InlineKeyboard();
    for (const item of sessions.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)) {
      keyboard.text(label(item), `s:${item.id}`).row();
    }
    if (current > 0) keyboard.text("← Previous", `p:${current - 1}`);
    if (current < lastPage) keyboard.text("Next →", `p:${current + 1}`);
    await ctx.reply(`Pi sessions · page ${current + 1}/${lastPage + 1}\nChoose one to resume:`, { reply_markup: keyboard });
  }

  bot.command(["start", "help"], (ctx) => reply(ctx, HELP));
  bot.command("sessions", (ctx) => safe(ctx, () => showSessions(ctx, Number.parseInt(ctx.match || "0", 10) || 0)));
  bot.command("use", (ctx) => safe(ctx, async () => {
    const id = ctx.match.trim();
    const matches = (await pi.list()).filter((item) => item.id.startsWith(id) && id.length >= 6);
    if (matches.length !== 1) throw new Error("Give an unambiguous session ID from /sessions");
    await pi.open(matches[0].id);
    await reply(ctx, `Resumed ${label(matches[0])}\nDirectory: ${pi.cwd}\nModel: ${pi.model}`);
  }));
  bot.command("new", (ctx) => safe(ctx, async () => {
    await pi.newSession(ctx.match.trim() || pi.preferredDirectory);
    await reply(ctx, `New Pi session in ${pi.cwd}\n${pi.sessionFile}`);
  }));
  bot.command("cwd", (ctx) => safe(ctx, async () => {
    if (!ctx.match.trim()) { await reply(ctx, `Next new session: ${pi.preferredDirectory}\nCurrent session: ${pi.cwd}`); return; }
    await reply(ctx, `Next new session will use ${pi.setCwd(ctx.match.trim())}. Current session is unchanged; use /new to start there.`);
  }));
  bot.command("status", (ctx) => reply(ctx, `Session: ${pi.sessionFile || "none (use /sessions or /new)"}\nDirectory: ${pi.cwd}\nNext new session: ${pi.preferredDirectory}\nModel: ${pi.model}\nBusy: ${pi.isBusy}`));
  bot.command("context", (ctx) => reply(ctx, pi.context() || "No Pi session selected. Use /sessions or /new first."));
  bot.command("cancel", (ctx) => safe(ctx, async () => { await pi.abort(); await reply(ctx, "Stopped the current Pi turn (if any)."); }));
  bot.callbackQuery(/^managed:([A-Za-z0-9._-]{1,32})$/, (ctx) => safe(ctx, async () => {
    await ctx.answerCallbackQuery({ text: "Opening managed session" });
    await pi.openManaged(ctx.match[1]);
    await reply(ctx, `Opened managed session\nDirectory: ${pi.cwd}\nModel: ${pi.model}`);
  }));

  bot.command("model",  (ctx) => safe(ctx, async () => {
    const choice = ctx.match.trim();
    if (choice) {
      const slash = choice.indexOf("/");
      if (slash < 1) throw new Error("Use /model provider/model-id");
      await pi.setModel(choice.slice(0, slash), choice.slice(slash + 1));
      await reply(ctx, `Model: ${pi.model}`);
      return;
    }
    modelChoices = await pi.models();
    if (!modelChoices.length) { await reply(ctx, "No authenticated Pi models available."); return; }
    const keyboard = new InlineKeyboard();
    for (const [index, model] of modelChoices.slice(0, 20).entries()) {
      keyboard.text(`${model.provider}/${model.id}`.slice(0, 58), `m:${index}`).row();
    }
    await ctx.reply(`Current: ${pi.model}\nChoose a model (first 20 shown; /model provider/id for others):`, { reply_markup: keyboard });
  }));

  bot.command("search", (ctx) => safe(ctx, async () => {
    const query = ctx.match.trim();
    if (!query) { await reply(ctx, "Usage: /search words to find"); return; }
    const { stdout } = await exec(config.agentrecallBin,
      ["history", "search", query, "--all", "--agent", "pi", "--format", "json", "--limit", "12"],
      { timeout: 20_000, maxBuffer: 2_000_000 });
    const catalog = new Map((await pi.list()).map((item) => [item.id, item]));
    const data: { matches?: Array<{ session_id: string; source_path: string }> } = JSON.parse(stdout);
    const matches = (data.matches ?? []).map((hit) => catalog.get(hit.session_id))
      .filter((item): item is SessionInfo => item !== undefined);
    await showSessions(ctx, 0, [...new Map(matches.map((item) => [item.id, item])).values()]);
  }));

  bot.callbackQuery(/^s:([a-f0-9-]{36})$/, (ctx) => safe(ctx, async () => {
    await ctx.answerCallbackQuery();
    await pi.open(ctx.match[1]);
    await reply(ctx, `Resumed Pi session\nDirectory: ${pi.cwd}\nModel: ${pi.model}`);
  }));
  bot.callbackQuery(/^p:(\d+)$/, (ctx) => safe(ctx, async () => { await ctx.answerCallbackQuery(); await showSessions(ctx, Number(ctx.match[1])); }));
  bot.callbackQuery(/^m:(\d+)$/, (ctx) => safe(ctx, async () => {
    await ctx.answerCallbackQuery();
    const model = modelChoices[Number(ctx.match[1])];
    if (!model) throw new Error("Model menu expired; run /model again");
    await pi.setModel(model.provider, model.id);
    await reply(ctx, `Model: ${pi.model}`);
  }));
  bot.on("message:text", (ctx) => safe(ctx, async () => {
    if (ctx.message.text.startsWith("/")) { await reply(ctx, "Unknown command. Use /help."); return; }
    if (pi.isBusy) { await reply(ctx, "Pi is busy. Wait or use /cancel."); return; }
    const typing = setInterval(() => { void ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {}); }, 4000);
    try { await reply(ctx, await pi.prompt(ctx.message.text)); }
    finally { clearInterval(typing); }
  }));
  bot.catch((error) => {
    // Do not log Telegram API error objects: their request URLs may contain the bot token.
    console.error("Telegram update failed (details withheld to protect credentials)");
  });
  return bot;
}
