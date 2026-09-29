import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";

export interface ManagedSessionSpec {
  key: string;
  name: string;
  cwd: string;
  model?: string;
  modelPreferenceOrder?: string[];
}

export interface SessionPromptRequest {
  type: "session_prompt";
  session: ManagedSessionSpec;
  prompt: string;
}

export interface SessionControl {
  close(): Promise<void>;
}

export async function startSessionControl(
  socketPath: string,
  handle: (request: SessionPromptRequest) => Promise<void>,
): Promise<SessionControl> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  try { await unlink(socketPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const server: Server = createServer((socket) => {
    let buffer = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while (!handled && (newline = buffer.indexOf("\n")) !== -1) {
        handled = true;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const request = parseRequest(line);
          socket.end('{"ok":true}\n');
          void handle(request).catch((error) => {
            console.error(`Managed session request failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          socket.end(JSON.stringify({ ok: false, error: message }) + "\n");
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);

  return {
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try { await unlink(socketPath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

function parseRequest(line: string): SessionPromptRequest {
  if (!line.trim()) throw new Error("Empty session control request");
  const request = JSON.parse(line) as Partial<SessionPromptRequest>;
  const session = request.session as Partial<ManagedSessionSpec> | undefined;
  if (request.type !== "session_prompt" || typeof request.prompt !== "string" || !request.prompt.trim()) {
    throw new Error("Invalid session control request");
  }
  if (!session || !/^[A-Za-z0-9._-]{1,32}$/.test(session.key || "")) throw new Error("Invalid managed session key");
  if (typeof session.name !== "string" || !session.name.trim() || session.name.length > 80) throw new Error("Invalid managed session name");
  if (typeof session.cwd !== "string" || !session.cwd.startsWith("/")) throw new Error("Managed session cwd must be absolute");
  if (session.model !== undefined && (typeof session.model !== "string" || !/^[^/]+\/[^/]+$/.test(session.model))) throw new Error("Managed session model must use provider/model-id");
  if (session.modelPreferenceOrder !== undefined) {
    if (!Array.isArray(session.modelPreferenceOrder) || session.modelPreferenceOrder.length === 0 || session.modelPreferenceOrder.length > 8) {
      throw new Error("Managed session modelPreferenceOrder must contain 1–8 models");
    }
    if (session.modelPreferenceOrder.some((model) => typeof model !== "string" || !/^[^/]+\/[^/]+$/.test(model))) {
      throw new Error("Managed session modelPreferenceOrder entries must use provider/model-id");
    }
    if (new Set(session.modelPreferenceOrder).size !== session.modelPreferenceOrder.length) {
      throw new Error("Managed session modelPreferenceOrder must not contain duplicates");
    }
  }
  if (request.prompt.length > 100_000) throw new Error("Session prompt is too large");
  return {
    type: "session_prompt",
    session: {
      key: session.key as string,
      name: session.name as string,
      cwd: session.cwd as string,
      model: session.model as string | undefined,
      modelPreferenceOrder: session.modelPreferenceOrder as string[] | undefined,
    },
    prompt: request.prompt,
  };
}
