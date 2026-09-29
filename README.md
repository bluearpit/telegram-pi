# telegram-pi

A small, single-user Telegram front end for [Pi](https://github.com/earendil-works/pi-coding-agent). The bot polls Telegram; Pi's SDK owns conversations, working directories, tools, model credentials, and session files. No Telegram webhook or public server is needed.

## Requirements

- Node.js 22+, a configured Pi installation with authenticated models, and a Telegram bot token from BotFather.
- Optional: [Agent Recall](https://github.com/bluearpit/agentrecall) [v0.2.4 or newer](https://github.com/bluearpit/agentrecall/releases/tag/v0.2.4) for `/search`. Install the [`agentrecall-cli` package](https://pypi.org/project/agentrecall-cli/) with `uv tool install agentrecall-cli` and ensure `agentrecall` is on `PATH`. `/sessions` uses Pi's own catalog, not Agent Recall's index.
- A **dedicated poller** per bot token. Stop any other process polling with this token before starting this bot; Telegram supports only one active long poller per token.

## Start

```bash
npm ci
npm run check && npm test
# Put TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS in a private env file.
# Node 22+ supports --env-file; never commit the real credentials.
node --env-file=/absolute/path/to/private/env --import tsx src/main.ts
```

See `.env.example`. `TELEGRAM_ALLOWED_USERS` is a required comma-separated list of **numeric Telegram user IDs**. The bot rejects group chats and anyone not on this list. If `PI_DEFAULT_CWD` is unset, new sessions start in your home directory. Run the gateway under the same OS user who configured Pi so it can access Pi's sessions and model credentials.

## Telegram controls

- `/sessions` — browse all Pi projects with inline buttons; `/use <session-id>` resumes one.
- `/search <query>` — optional Pi-only Agent Recall history search; results are checked against Pi's catalog before selection.
- `/new [absolute-directory]` — create a Pi session; `/cwd <absolute-directory>` chooses the directory for the *next* new session, without changing the active one.
- `/model` — available authenticated models (first 20 shown); `/model provider/model-id` selects any available model.
- `/context` — Pi's context usage and estimated category breakdown, including active compaction-summary tokens and compaction count. This is a Telegram-native view; the interactive Pi `/context` extension is not required.
- `/status`, `/cancel`, `/help`; plain text prompts Pi. One turn at a time; Pi retains its normal transcript in `~/.pi/agent/sessions/`.
- The optional local control socket accepts generic managed-session prompts. A caller supplies a session key, display name, working directory, model, and prompt; the response is delivered to the allowlisted Telegram user with a button to open that managed session. This gateway does not know what the session is used for.

The bot does not store a second transcript or copy Pi session files. A process restart drops the in-memory selection: use `/sessions` to select the session again. Pending Telegram updates are discarded on startup to avoid replaying old prompts with tool side effects. Stop the bot cleanly before updating it. Do **not** send turns from a Pi terminal and this bot into the *same session at the same time*: Pi's JSONL session file has no cross-process writer lock. This gateway is intended only for **trusted users**: Pi tools can execute code and change files as that OS user.

## Publishing and credentials

The repository contains no bot token, Telegram user ID, or machine-specific path. Keep real credentials outside the checkout; never commit logs or Pi transcripts. For a macOS background service, run this command under your own LaunchAgent, using an absolute `node` executable and private env file. Stop it with `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/<label>.plist` before resuming another poller with the same token. Rotate the bot token if it is ever exposed. BotFather can rename the bot without changing its token; the token must still have only one active long poller.

The managed-session control socket is generic: `PI_MANAGED_STATE_DIR` selects where its small session metadata files live, and `PI_CONTROL_SOCKET` selects the private Unix socket. Product-specific schedulers should send their own session metadata in the request rather than adding product-specific code or environment variables here.
