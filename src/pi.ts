import { createAgentSession, SessionManager, type AgentSession, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { directory } from "./config.js";
import { formatContext } from "./context.js";

/** Pi alone owns transcripts and model state; the gateway holds only the selected handle. */
export class PiHost {
  private session?: AgentSession;
  private busy = false;
  private preferredCwd: string;

  constructor(cwd: string) { this.preferredCwd = cwd; }
  get isBusy(): boolean { return this.busy; }
  get cwd(): string { return this.session?.sessionManager.getCwd() ?? this.preferredCwd; }
  get preferredDirectory(): string { return this.preferredCwd; }
  get sessionFile(): string | undefined { return this.session?.sessionFile; }
  get model(): string { return this.session?.model ? `${this.session.model.provider}/${this.session.model.id}` : "not selected"; }
  context(): string | undefined { return this.session ? formatContext(this.session) : undefined; }

  async list(): Promise<SessionInfo[]> {
    return (await SessionManager.listAll()).sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Pi is busy; wait for the current operation or use /cancel");
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }

  setCwd(path: string): string {
    if (this.busy) throw new Error("Pi is busy");
    this.preferredCwd = directory(path);
    return this.preferredCwd;
  }

  async newSession(path = this.preferredCwd): Promise<void> {
    await this.exclusive(async () => {
      const cwd = directory(path);
      const { session } = await createAgentSession({ cwd, sessionManager: SessionManager.create(cwd) });
      this.session?.dispose();
      this.session = session;
      this.preferredCwd = cwd;
    });
  }

  async open(id: string): Promise<void> {
    await this.exclusive(async () => {
      // Never trust paths/IDs from Telegram directly; resolve against Pi's catalog.
      const entry = (await this.list()).find((item) => item.id === id);
      if (!entry) throw new Error("Session not found in Pi's catalog");
      const cwd = directory(entry.cwd || this.preferredCwd);
      const manager = SessionManager.open(entry.path, undefined, cwd);
      const { session } = await createAgentSession({ cwd, sessionManager: manager });
      this.session?.dispose();
      this.session = session;
      this.preferredCwd = cwd;
    });
  }

  async models(): Promise<Array<{ provider: string; id: string }>> {
    if (!this.session) await this.newSession();
    return (await this.session!.modelRuntime.getAvailable()).map(({ provider, id }) => ({ provider, id }));
  }

  async setModel(provider: string, id: string): Promise<void> {
    if (!this.session) await this.newSession();
    await this.exclusive(async () => {
      const available = await this.session!.modelRuntime.getAvailable();
      const model = available.find((item) => item.provider === provider && item.id === id);
      if (!model) throw new Error("Model is unavailable or not authenticated in Pi");
      await this.session!.setModel(model);
    });
  }

  async prompt(text: string): Promise<string> {
    return this.exclusive(async () => {
      if (!this.session) {
        const cwd = directory(this.preferredCwd);
        this.session = (await createAgentSession({ cwd, sessionManager: SessionManager.create(cwd) })).session;
      }
      await this.session.prompt(text);
      const last = [...this.session.messages].reverse().find((message) => message.role === "assistant");
      if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
        throw new Error(`Pi stopped: ${last.errorMessage || last.stopReason}`);
      }
      return this.session.getLastAssistantText() || "Pi finished without a text response.";
    });
  }

  async abort(): Promise<void> { await this.session?.abort(); }
  dispose(): void { this.session?.dispose(); }
}
