import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAgentSession, SessionManager, type AgentSession, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { directory } from "./config.js";
import type { ManagedSessionSpec } from "./control.js";
import { formatContext } from "./context.js";
import { selectPreferredModel } from "./model-selection.js";

interface ManagedState extends ManagedSessionSpec {
  path: string;
}

export interface ManagedResult {
  text: string;
  sessionId: string;
}

export function hasOnePermissionGate(extensions: Array<{ commands: { has(name: string): boolean } }>): boolean {
  return extensions.filter((extension) => extension.commands.has("permissions")).length === 1;
}

/** Pi owns interactive sessions and generic externally-triggered managed sessions. */
export class PiHost {
  private session?: AgentSession;
  private busy = false;
  private preferredCwd: string;
  private readonly managed = new Map<string, AgentSession>();
  private readonly managedBusy = new Set<string>();

  constructor(private readonly managedStateDir: string, cwd: string) { this.preferredCwd = cwd; }

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

  private async createSession(cwd: string, manager: SessionManager): Promise<AgentSession> {
    const { session, extensionsResult } = await createAgentSession({ cwd, sessionManager: manager });
    // The gateway has no approval UI. Never run a managed or interactive Telegram
    // session without the packaged policy gate, even if extension loading failed.
    if (!hasOnePermissionGate(extensionsResult.extensions)) {
      session.dispose();
      throw new Error("Pi permission gate is not installed exactly once; install pi-customizations before using Telegram");
    }
    try {
      // SDK hosts must bind extensions themselves; this emits session_start so
      // the permission gate loads permissions.yaml before the first tool call.
      await session.bindExtensions({});
    } catch (error) {
      session.dispose();
      throw error;
    }
    return session;
  }

  private async applyModel(session: AgentSession, preferenceOrder?: string[]): Promise<string | undefined> {
    if (!preferenceOrder?.length) return undefined;
    const available = await session.modelRuntime.getAvailable();
    const model = selectPreferredModel(preferenceOrder, available);
    if (!model) throw new Error(`None of the managed session models are available: ${preferenceOrder.join(", ")}`);
    await session.setModel(model);
    return `${model.provider}/${model.id}`;
  }

  private statePath(key: string): string { return join(this.managedStateDir, `${key}.json`); }

  private async loadState(key: string): Promise<ManagedState | undefined> {
    try {
      const state = JSON.parse(await readFile(this.statePath(key), "utf8")) as Partial<ManagedState>;
      if (state.key !== key || typeof state.path !== "string" || !existsSync(state.path)) return undefined;
      if (typeof state.name !== "string" || typeof state.cwd !== "string") return undefined;
      return state as ManagedState;
    } catch { return undefined; }
  }

  private async saveState(spec: ManagedSessionSpec, session: AgentSession): Promise<void> {
    const path = session.sessionFile || session.sessionManager.getSessionFile();
    if (!path) throw new Error("Managed session has no persistence path");
    await mkdir(this.managedStateDir, { recursive: true, mode: 0o700 });
    const state: ManagedState = { ...spec, cwd: session.sessionManager.getCwd(), path };
    await writeFile(this.statePath(spec.key), JSON.stringify(state) + "\n", { mode: 0o600 });
  }

  private async ensureManaged(spec: ManagedSessionSpec): Promise<AgentSession> {
    const current = this.managed.get(spec.key);
    if (current) return current;
    const state = await this.loadState(spec.key);
    const cwd = directory(state?.cwd || spec.cwd);
    const manager = state ? SessionManager.open(state.path, undefined, cwd) : SessionManager.create(cwd);
    const session = await this.createSession(cwd, manager);
    if (!state) session.sessionManager.appendSessionInfo(spec.name);
    const preferenceOrder = spec.modelPreferenceOrder
      ?? state?.modelPreferenceOrder
      ?? [spec.model || state?.model].filter((model): model is string => Boolean(model));
    const selectedModel = await this.applyModel(session, preferenceOrder);
    this.managed.set(spec.key, session);
    await this.saveState({
      ...spec,
      cwd,
      model: selectedModel || spec.model || state?.model,
      modelPreferenceOrder: preferenceOrder,
    }, session);
    return session;
  }

  async promptManaged(spec: ManagedSessionSpec, text: string): Promise<ManagedResult> {
    if (this.managedBusy.has(spec.key)) throw new Error(`Managed session is already running: ${spec.name}`);
    this.managedBusy.add(spec.key);
    try {
      const session = await this.ensureManaged(spec);
      await session.prompt(text);
      const last = [...session.messages].reverse().find((message) => message.role === "assistant");
      if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
        throw new Error(`Pi stopped: ${last.errorMessage || last.stopReason}`);
      }
      return { text: session.getLastAssistantText() || "Pi finished without a text response.", sessionId: session.sessionManager.getSessionId() };
    } finally { this.managedBusy.delete(spec.key); }
  }

  async openManaged(key: string): Promise<void> {
    if (this.busy) throw new Error("Pi is busy; wait for the current operation");
    if (this.managedBusy.has(key)) throw new Error("Managed session is running; wait for it to finish");
    const state = await this.loadState(key);
    if (!state) throw new Error(`Managed session not found: ${key}`);
    const session = await this.ensureManaged(state);
    if (this.session && this.session !== session && ![...this.managed.values()].includes(this.session)) this.session.dispose();
    this.session = session;
    this.preferredCwd = session.sessionManager.getCwd();
  }

  setCwd(path: string): string {
    if (this.busy) throw new Error("Pi is busy");
    this.preferredCwd = directory(path);
    return this.preferredCwd;
  }

  async newSession(path = this.preferredCwd): Promise<void> {
    await this.exclusive(async () => {
      const cwd = directory(path);
      const session = await this.createSession(cwd, SessionManager.create(cwd));
      if (this.session && ![...this.managed.values()].includes(this.session)) this.session.dispose();
      this.session = session;
      this.preferredCwd = cwd;
    });
  }

  async open(id: string): Promise<void> {
    await this.exclusive(async () => {
      const entry = (await this.list()).find((item) => item.id === id);
      if (!entry) throw new Error("Session not found in Pi's catalog");
      const managedSession = [...this.managed.values()].find((item) => item.sessionManager.getSessionId() === id);
      if (managedSession) {
        this.session = managedSession;
        this.preferredCwd = managedSession.sessionManager.getCwd();
        return;
      }
      const cwd = directory(entry.cwd || this.preferredCwd);
      const session = await this.createSession(cwd, SessionManager.open(entry.path, undefined, cwd));
      if (this.session && ![...this.managed.values()].includes(this.session)) this.session.dispose();
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
        this.session = await this.createSession(cwd, SessionManager.create(cwd));
      }
      await this.session.prompt(text);
      const last = [...this.session.messages].reverse().find((message) => message.role === "assistant");
      if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) throw new Error(`Pi stopped: ${last.errorMessage || last.stopReason}`);
      return this.session.getLastAssistantText() || "Pi finished without a text response.";
    });
  }

  async abort(): Promise<void> { await this.session?.abort(); }
  dispose(): void {
    const sessions = new Set([this.session, ...this.managed.values()].filter((item): item is AgentSession => Boolean(item)));
    for (const session of sessions) session.dispose();
    this.session = undefined;
    this.managed.clear();
  }
}
