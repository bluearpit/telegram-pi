---
name: telegram-pi-maintenance
description: Inspect, restart, or update the telegram-pi macOS LaunchAgent safely. Use when asked to check gateway status, restart the Telegram Pi bot, update telegram-pi, or troubleshoot its local control socket.
---

# telegram-pi Maintenance

Use the repository CLI as the source of truth; do not hand-roll `launchctl`, Git, or npm update sequences.

## Workflow

1. Run `./bin/telegram-pi status` from the `telegram-pi` repository to inspect the LaunchAgent and private control socket.
2. For a restart request, run `./bin/telegram-pi restart`.
3. For an update request, run `./bin/telegram-pi update`. It requires a clean `master` checkout, fast-forwards only from `origin/master`, installs dependencies, runs type-check and tests, then restarts the service if it was loaded.
4. If the CLI refuses because of local changes, local-only commits, a branch mismatch, or a LaunchAgent path mismatch, stop and report the exact blocker. Never stash, reset, clean, or switch branches automatically.
5. After a mutation, run `./bin/telegram-pi status` and report whether the service and private control socket are ready.

## Safety

- Never print or read the private Telegram environment file or expose bot credentials.
- Never start a second polling process manually; Telegram allows only one active poller per bot token.
- Do not edit the LaunchAgent plist or environment file as part of an update unless explicitly requested.
- The CLI is macOS LaunchAgent tooling. If the service is not installed, report that rather than installing it implicitly.
