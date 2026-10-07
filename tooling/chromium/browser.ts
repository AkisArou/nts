/**
 * A Chromium-derived shell under Xvfb, driven over the DevTools protocol: the
 * launch, the connection to the page, and the waits every harness here needs.
 * Used by app.ts's check; smoke.ts and benchmark.ts carry their own copies of
 * the same steps, to be moved onto this.
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface Page {
  /** Everything the shell has written so far. */
  log(): string;
  cdp<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T>(expression: string): Promise<T>;
  /** Polls until the predicate is truthy; fails on a renderer check failure or exit. */
  until<T>(predicate: () => T | Promise<T>, label: string, timeout?: number): Promise<NonNullable<T>>;
  close(): Promise<void>;
}

export async function openPage(executable: string, url: string, options: { temporary: string; args?: string[] }): Promise<Page> {
  const profile = await mkdtemp(`${options.temporary}/profile-`);
  const args = ["--ozone-platform=x11", "--enable-logging=stderr", "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, ...(options.args ?? []), url];
  const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1280x900x24", executable, ...args], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  let launchError: Error | undefined;
  let exited = false;
  child.on("error", error => { launchError = error; });
  child.on("exit", () => { exited = true; });
  child.stdout.on("data", chunk => { log += String(chunk); });
  child.stderr.on("data", chunk => { log += String(chunk); });

  async function until<T>(predicate: () => T | Promise<T>, label: string, timeout = 30_000): Promise<NonNullable<T>> {
    const deadline = performance.now() + timeout;
    do {
      if (launchError) throw launchError;
      if (/FATAL:|Check failed|nts host: check failed/.test(log)) throw new Error(`The renderer failed a check while waiting for ${label}`);
      if (exited) throw new Error(`The shell exited while waiting for ${label}`);
      const value = await predicate();
      if (value) return value as NonNullable<T>;
      await delay(100);
    } while (performance.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  }

  const endpoint = await until(() => log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], "DevTools");
  const origin = `http://${new URL(endpoint).host}`;
  const target = await until(async () => {
    const pages = await (await fetch(`${origin}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    return pages.find(page => page.type === "page");
  }, "the page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((accept, reject) => {
    socket.addEventListener("open", () => accept(), { once: true });
    socket.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
  });
  let id = 0;
  const pending = new Map<number, { accept: (value: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)) as { id?: number; error?: unknown; result?: unknown };
    const entry = message.id === undefined ? undefined : pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id!);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.accept(message.result);
  });
  socket.addEventListener("close", () => {
    for (const entry of pending.values()) entry.reject(new Error("The page's DevTools connection closed"));
    pending.clear();
  });
  const cdp = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((accept, reject) => {
    const next = ++id;
    pending.set(next, { accept: value => accept(value as T), reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await cdp<{ exceptionDetails?: unknown; result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return {
    log: () => log, cdp, evaluate, until,
    // Closing its last window ends the shell, as closing the app's would; a
    // shell still there after that is killed.
    async close() {
      await cdp("Page.close").catch(() => undefined);
      const deadline = performance.now() + 20_000;
      while (!exited && performance.now() < deadline) await delay(100);
      if (!exited && child.pid) process.kill(-child.pid, "SIGKILL");
    },
  };
}
