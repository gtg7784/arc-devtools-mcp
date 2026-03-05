import WebSocket from "ws";
import type { ClientRequest, IncomingMessage } from "node:http";

export type CdpTarget = {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

export type CdpVersionInfo = {
  Browser?: string;
  "Protocol-Version"?: string;
};

export type CdpConsoleEntry = {
  ts: number;
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type CdpNetworkEntry = {
  ts: number;
  requestId: string;
  url: string;
  method?: string;
  type: "request" | "response" | "failed";
  status?: number;
  mimeType?: string;
  errorText?: string;
};

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: NodeJS.Timeout;
};

function nowMs(): number {
  return Date.now();
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function expandTildePath(path: string): string {
  if (!path.startsWith("~/")) return path;
  const home = process.env.HOME;
  if (!home) return path;
  return `${home}/${path.slice(2)}`;
}

function getArcUserDataDir(): string {
  const override = process.env.ARC_MCP_ARC_USER_DATA_DIR;
  return expandTildePath(override && override.trim().length > 0 ? override : "~/Library/Application Support/Arc/User Data");
}

function getCdpOrigin(): string | undefined {
  const raw = process.env.ARC_MCP_CDP_ORIGIN;
  const origin = raw && raw.trim().length > 0 ? raw.trim() : "http://127.0.0.1";
  return origin;
}

async function readDevToolsActivePort(): Promise<{ port: number; browserWsPath: string }> {
  const fs = await import("node:fs/promises");
  const path = `${getArcUserDataDir()}/DevToolsActivePort`;
  const raw = await fs.readFile(path, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error(`Invalid DevToolsActivePort file: ${path}`);
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid DevToolsActivePort port: ${lines[0]}`);
  const browserWsPath = lines[1];
  if (!browserWsPath.startsWith("/")) throw new Error(`Invalid DevToolsActivePort ws path: ${browserWsPath}`);
  return { port, browserWsPath };
}

async function fetchJson<T>(url: string, timeoutMs = 2_000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function cdpGetVersion(port: number): Promise<CdpVersionInfo> {
  return fetchJson<CdpVersionInfo>(`http://127.0.0.1:${port}/json/version`);
}

export async function cdpListTargets(port: number): Promise<CdpTarget[]> {
  return fetchJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`);
}

function pickTarget(targets: CdpTarget[], opts: { targetId?: string; targetUrl?: string }): CdpTarget {
  const withWs = targets.filter((t) => typeof t.webSocketDebuggerUrl === "string" && t.webSocketDebuggerUrl.length > 0);
  if (opts.targetId) {
    const byId = withWs.find((t) => t.id === opts.targetId);
    if (!byId) throw new Error(`CDP target not found for id=${opts.targetId}`);
    return byId;
  }
  if (opts.targetUrl) {
    const needle = opts.targetUrl;
    const byUrl = withWs.find((t) => typeof t.url === "string" && t.url.includes(needle));
    if (!byUrl) throw new Error(`CDP target not found for url including: ${needle}`);
    return byUrl;
  }
  const page = withWs.find((t) => (t.type ?? "") === "page" && (t.url ?? "").startsWith("http"));
  if (page) return page;
  const any = withWs.find((t) => (t.url ?? "").startsWith("http"));
  if (any) return any;
  throw new Error("No suitable CDP target found");
}

type WsLike = {
  send: (data: string) => void;
  close: () => void;
  on: (event: "message" | "close" | "error" | "open", listener: (...args: any[]) => void) => void;
  off: (event: "message" | "close" | "error" | "open", listener: (...args: any[]) => void) => void;
};

async function openWs(url: string, opts: { timeoutMs?: number; origin?: string } = {}): Promise<WsLike> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const origin = opts.origin;
  const ws = new WebSocket(url, {
    handshakeTimeout: timeoutMs,
    headers: origin ? { Origin: origin } : undefined,
  });
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // noop
      }
      reject(new Error(`WebSocket open timeout: ${url}`));
    }, timeoutMs);
    const onOpen = () => {
      clearTimeout(timeoutId);
      ws.off("error", onError);
      ws.off("unexpected-response", onUnexpectedResponse);
      resolve();
    };
    const onError = (e: unknown) => {
      clearTimeout(timeoutId);
      ws.off("open", onOpen);
      ws.off("unexpected-response", onUnexpectedResponse);
      reject(asError(e));
    };
    const onUnexpectedResponse = (_req: ClientRequest, res: IncomingMessage) => {
      clearTimeout(timeoutId);
      ws.off("open", onOpen);
      ws.off("error", onError);

      const statusCode = res.statusCode ?? 0;
      const statusMessage = res.statusMessage ?? "";
      let body = "";
      res.on("data", (c) => {
        try {
          body += Buffer.isBuffer(c) ? c.toString("utf8") : String(c);
        } catch {
          // noop
        }
      });
      res.on("end", () => {
        const suffix = body && body.trim().length > 0 ? `: ${body.trim()}` : "";
        reject(new Error(`WebSocket rejected (${statusCode} ${statusMessage})${suffix}`));
      });
    };
    ws.on("open", onOpen);
    ws.on("error", onError);
    ws.on("unexpected-response", onUnexpectedResponse);
  });

  return ws as unknown as WsLike;
}

async function wsRequest(ws: WsLike, method: string, params?: JsonObject, timeoutMs = 2_000): Promise<JsonObject> {
  const id = 1;
  const payload: JsonObject = { id, method };
  if (params) payload.params = params;
  const text = JSON.stringify(payload);
  ws.send(text);

  return new Promise<JsonObject>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(`WS request timeout: ${method}`)), timeoutMs);
    const onMessage = (data: unknown) => {
      try {
        const raw = typeof data === "string" ? data : Array.isArray(data) ? Buffer.concat(data as Buffer[]).toString("utf8") : Buffer.isBuffer(data) ? data.toString("utf8") : toText(data);
        const msg = JSON.parse(raw) as JsonObject;
        if (msg.id !== id) return;
        clearTimeout(timeoutId);
        ws.off("message", onMessage);
        if (msg.error && typeof msg.error === "object") {
          const eobj = msg.error as JsonObject;
          const emsg = typeof eobj.message === "string" ? eobj.message : "CDP error";
          reject(new Error(emsg));
          return;
        }
        resolve((msg.result ?? {}) as JsonObject);
      } catch (e) {
        clearTimeout(timeoutId);
        ws.off("message", onMessage);
        reject(asError(e));
      }
    };
    ws.on("message", onMessage);
  });
}

async function listTargetsViaBrowserWs(port: number): Promise<CdpTarget[]> {
  const info = await readDevToolsActivePort();
  if (info.port !== port) throw new Error(`DevToolsActivePort port mismatch: expected ${port}, got ${info.port}`);
  const wsUrl = `ws://127.0.0.1:${port}${info.browserWsPath}`;
  const ws = await openWs(wsUrl, { timeoutMs: 3_000, origin: getCdpOrigin() });
  try {
    const result = await wsRequest(ws, "Target.getTargets");
    const infos = (result.targetInfos ?? []) as unknown[];
    return infos
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const o = x as JsonObject;
        return {
          id: typeof o.targetId === "string" ? o.targetId : "",
          type: typeof o.type === "string" ? o.type : undefined,
          title: typeof o.title === "string" ? o.title : undefined,
          url: typeof o.url === "string" ? o.url : undefined,
        } satisfies CdpTarget;
      })
      .filter((t) => t.id.length > 0);
  } finally {
    ws.close();
  }
}

export class ArcCdpBridge {
  private ws: WsLike | null = null;
  private port: number | null = null;
  private target: CdpTarget | null = null;
  private sessionId: string | null = null;
  private directTargetWs = false;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  private consoleEntries: CdpConsoleEntry[] = [];
  private networkEntries: CdpNetworkEntry[] = [];

  private readonly maxConsoleEntries = 500;
  private readonly maxNetworkEntries = 1_000;

  status(): { connected: boolean; port: number | null; target: CdpTarget | null; mode: "disconnected" | "target" | "browser" } {
    if (!this.ws) return { connected: false, port: this.port, target: this.target, mode: "disconnected" };
    return { connected: true, port: this.port, target: this.target, mode: this.directTargetWs ? "target" : "browser" };
  }

  async connect(params: { port: number; targetId?: string; targetUrl?: string }): Promise<{ target: CdpTarget; version?: CdpVersionInfo }> {
    await this.disconnect();

    let targets: CdpTarget[] | null = null;
    let version: CdpVersionInfo | undefined;
    try {
      version = await cdpGetVersion(params.port);
      targets = await cdpListTargets(params.port);
    } catch (err) {
      const message = asError(err).message;
      if (!message.includes("404")) throw err;
    }

    if (targets) {
      const target = pickTarget(targets, { targetId: params.targetId, targetUrl: params.targetUrl });
      const wsUrl = target.webSocketDebuggerUrl;
      if (!wsUrl) throw new Error("Selected CDP target has no webSocketDebuggerUrl");

      const ws = await openWs(wsUrl, { timeoutMs: 3_000, origin: getCdpOrigin() });
      this.install(ws);
      this.directTargetWs = true;
      this.port = params.port;
      this.target = target;
      this.sessionId = null;
      await this.send("Runtime.enable");
      await this.send("Network.enable");
      await this.send("Log.enable");
      return { target, version };
    }

    const targets2 = await listTargetsViaBrowserWs(params.port);
    const target = pickTarget(
      targets2.map((t) => ({ ...t, webSocketDebuggerUrl: undefined })),
      { targetId: params.targetId, targetUrl: params.targetUrl }
    );

    const info = await readDevToolsActivePort();
    if (info.port !== params.port) throw new Error(`DevToolsActivePort port mismatch: expected ${params.port}, got ${info.port}`);
    const browserWsUrl = `ws://127.0.0.1:${params.port}${info.browserWsPath}`;

    let ws: WsLike;
    try {
      ws = await openWs(browserWsUrl, { timeoutMs: 3_000, origin: getCdpOrigin() });
    } catch (err) {
      const e = asError(err);
      const msg = e.message;
      if (msg.includes("403") || msg.toLowerCase().includes("unexpected server response") || msg.toLowerCase().includes("rejected")) {
        const origin = getCdpOrigin() ?? "";
        const originHint = origin.length > 0 ? origin : "<empty>";
        throw new Error(
          `CDP WebSocket rejected (origin not allowed). Restart Arc with --remote-debugging-port=${params.port} and --remote-allow-origins=${originHint} (or --remote-allow-origins=*). Original error: ${msg}`
        );
      }
      throw err;
    }

    this.install(ws);
    this.directTargetWs = false;
    this.port = params.port;
    this.target = target;

    const attach = (await this.send("Target.attachToTarget", { targetId: target.id, flatten: true })) as JsonObject;
    const sessionId = typeof attach.sessionId === "string" ? attach.sessionId : null;
    if (!sessionId) throw new Error("Failed to attach to CDP target (no sessionId)");
    this.sessionId = sessionId;

    await this.send("Runtime.enable", undefined, sessionId);
    await this.send("Network.enable", undefined, sessionId);
    await this.send("Log.enable", undefined, sessionId);

    return { target };
  }

  async disconnect(): Promise<void> {
    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timeoutId);
      p.reject(new Error("CDP disconnected"));
      this.pending.delete(id);
    }
    const ws = this.ws;
    this.ws = null;
    this.port = null;
    this.target = null;
    this.sessionId = null;
    this.directTargetWs = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // noop
      }
    }
  }

  getConsole(params: { sinceTs?: number; limit?: number } = {}): CdpConsoleEntry[] {
    const since = params.sinceTs ?? 0;
    const items = this.consoleEntries.filter((e) => e.ts >= since);
    const limit = params.limit ?? items.length;
    if (limit <= 0) return [];
    return items.slice(-limit);
  }

  getNetwork(params: { sinceTs?: number; limit?: number } = {}): CdpNetworkEntry[] {
    const since = params.sinceTs ?? 0;
    const items = this.networkEntries.filter((e) => e.ts >= since);
    const limit = params.limit ?? items.length;
    if (limit <= 0) return [];
    return items.slice(-limit);
  }

  private install(ws: WsLike): void {
    this.ws = ws;
    this.consoleEntries = [];
    this.networkEntries = [];
    ws.on("message", (data) => this.onMessage(data));
    ws.on("close", () => void this.disconnect());
  }

  private onMessage(raw: unknown): void {
    const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : toText(raw);
    let msg: JsonObject;
    try {
      msg = JSON.parse(text) as JsonObject;
    } catch {
      return;
    }

    const id = msg.id;
    if (typeof id === "number") {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(id);
      if (msg.error && typeof msg.error === "object") {
        const eobj = msg.error as JsonObject;
        const emsg = typeof eobj.message === "string" ? eobj.message : "CDP error";
        pending.reject(new Error(emsg));
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    const method = msg.method;
    if (typeof method !== "string") return;

    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;
    if (this.sessionId && sessionId && sessionId !== this.sessionId) return;

    const params = (msg.params ?? {}) as JsonObject;
    if (method === "Runtime.consoleAPICalled") {
      const type = typeof params.type === "string" ? params.type : "log";
      const args = Array.isArray(params.args) ? params.args : [];
      const textParts = args.map((a) => {
        if (a && typeof a === "object") {
          const ao = a as JsonObject;
          if (typeof ao.value === "string" || typeof ao.value === "number" || typeof ao.value === "boolean") return String(ao.value);
          if (typeof ao.description === "string") return ao.description;
        }
        return toText(a);
      });

      this.consoleEntries.push({ ts: nowMs(), type, text: textParts.join(" ") });
      if (this.consoleEntries.length > this.maxConsoleEntries) {
        this.consoleEntries.splice(0, this.consoleEntries.length - this.maxConsoleEntries);
      }
      return;
    }

    if (method === "Log.entryAdded") {
      const entryObj = (params.entry ?? {}) as JsonObject;
      const text2 = typeof entryObj.text === "string" ? entryObj.text : "";
      const level = typeof entryObj.level === "string" ? entryObj.level : "log";
      const url = typeof entryObj.url === "string" ? entryObj.url : undefined;
      const lineNumber = typeof entryObj.lineNumber === "number" ? entryObj.lineNumber : undefined;
      this.consoleEntries.push({ ts: nowMs(), type: `log:${level}`, text: text2, url, lineNumber });
      if (this.consoleEntries.length > this.maxConsoleEntries) {
        this.consoleEntries.splice(0, this.consoleEntries.length - this.maxConsoleEntries);
      }
      return;
    }

    if (method === "Network.requestWillBeSent") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const request = (params.request ?? {}) as JsonObject;
      const url = typeof request.url === "string" ? request.url : "";
      const methodStr = typeof request.method === "string" ? request.method : undefined;
      if (requestId && url) {
        this.networkEntries.push({ ts: nowMs(), requestId, url, method: methodStr, type: "request" });
        if (this.networkEntries.length > this.maxNetworkEntries) {
          this.networkEntries.splice(0, this.networkEntries.length - this.maxNetworkEntries);
        }
      }
      return;
    }

    if (method === "Network.responseReceived") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const response = (params.response ?? {}) as JsonObject;
      const url = typeof response.url === "string" ? response.url : "";
      const status = typeof response.status === "number" ? response.status : undefined;
      const mimeType = typeof response.mimeType === "string" ? response.mimeType : undefined;
      if (requestId && url) {
        this.networkEntries.push({ ts: nowMs(), requestId, url, type: "response", status, mimeType });
        if (this.networkEntries.length > this.maxNetworkEntries) {
          this.networkEntries.splice(0, this.networkEntries.length - this.maxNetworkEntries);
        }
      }
      return;
    }

    if (method === "Network.loadingFailed") {
      const requestId = typeof params.requestId === "string" ? params.requestId : "";
      const errorText = typeof params.errorText === "string" ? params.errorText : undefined;
      if (requestId) {
        this.networkEntries.push({ ts: nowMs(), requestId, url: "", type: "failed", errorText });
        if (this.networkEntries.length > this.maxNetworkEntries) {
          this.networkEntries.splice(0, this.networkEntries.length - this.maxNetworkEntries);
        }
      }
    }
  }

  private async send(method: string, params?: JsonObject, sessionId?: string): Promise<unknown> {
    const ws = this.ws;
    if (!ws) throw new Error("CDP not connected");

    const id = this.nextId++;
    const message: JsonObject = { id, method };
    if (params) message.params = params;
    if (sessionId) message.sessionId = sessionId;

    const payload = JSON.stringify(message);
    const timeoutMs = 5_000;

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
    });

    ws.send(payload);
    return promise;
  }
}
