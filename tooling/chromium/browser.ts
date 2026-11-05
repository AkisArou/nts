/**
 * A Chromium-derived shell under Xvfb, driven over the DevTools protocol: the
 * launch, the connection to the page, and the waits every harness here needs
 * (app.ts's check, smoke.ts, benchmark.ts). The shell's flags are the
 * caller's; this adds only what driving it needs (DevTools on a free port,
 * a fresh profile).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { WriteStream } from "node:fs";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pinLaunchProcesses, scopeProcesses, type LaunchProcess } from "./processes.ts";

export interface Target { type: string; url: string; webSocketDebuggerUrl: string }

export interface LaunchOptions {
  /**
   * A directory to make a fresh profile in, removed when the page ends; or
   * `profile`, a profile of the caller's, which is kept.
   */
  temporary?: string;
  profile?: string;
  /** The shell's flags, before the URL. */
  args?: string[];
  /**
   * Start the shell under taskset on this CPU, so every thread it ever
   * spawns inherits the mask from birth. For measurement: pinning a
   * running renderer reaches only its main thread, and cpu_core
   * counters silently miss a thread scheduled on an E-core.
   */
  cpu?: number;
  /** Which DevTools target is the page; the first page by default. */
  target?: (target: Target) => boolean;
  /**
   * A log line that means the renderer failed: every wait and pending call
   * fails at once. `null` for a harness that crashes renderers on purpose.
   */
  failure?: RegExp | null;
  /** Everything the shell writes, as it writes it. */
  logTo?: WriteStream;
  /** How long a DevTools call, and a wait by default, may take. */
  callTimeout?: number;
  waitTimeout?: number;
}

export interface Page {
  /** The systemd-run launcher. Process ownership comes from `processes()`. */
  readonly pid: number;
  /** The transient scope that owns this launch and every browser process. */
  readonly unit: string;
  readonly cgroup: string;
  readonly busAddress: string;
  pinForMeasurement(): Promise<{ rendererPid: number; affinities: string[] }>;
  processes(): Promise<LaunchProcess[]>;
  /** The shell's DevTools HTTP origin (`/json/version`, `/json/list`). */
  readonly origin: string;
  /** Everything the shell has written so far. */
  log(): string;
  exited(): boolean;
  cdp<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** An expression's value; a promise is awaited. */
  evaluate<T>(expression: string): Promise<T>;
  /** A DevTools event's parameters, each time it arrives. */
  on(method: string, handler: (params: Record<string, unknown>) => void): void;
  /** Polls until the predicate is truthy; fails on a renderer failure or exit. */
  until<T>(predicate: () => T | Promise<T>, label: string, timeout?: number): Promise<NonNullable<T>>;
  /** Closes the page, which ends the shell; kills what is left. */
  close(): Promise<void>;
  /** Stops the launch's scope now. */
  kill(): void;
}

const DEFAULT_FAILURE = /FATAL:|Check failed|nts host: check failed/;
const activeLaunches = new Set<() => void>();
process.once("exit", () => { for (const stop of activeLaunches) stop(); });
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => { for (const stop of activeLaunches) stop(); process.exit(code); });
}

export async function openPage(executable: string, url: string, options: LaunchOptions): Promise<Page> {
  const profile = options.profile ?? await mkdtemp(`${options.temporary}/profile-`);
  // Unix socket paths are short. Keep the private bus in a short, owned
  // cache directory even when the caller's evidence path is deeply nested.
  const busRoot = join(homedir(), ".cache", "nts-chromium-bus");
  await mkdir(busRoot, { recursive: true });
  const busDirectory = await mkdtemp(join(busRoot, "b-"));
  const busConfig = join(busDirectory, "session.conf");
  await writeFile(busConfig, `<busconfig>
  <type>session</type>
  <listen>unix:dir=${encodeURIComponent(busDirectory)}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>\n`);
  const failure = options.failure === undefined ? DEFAULT_FAILURE : options.failure;
  const callTimeout = options.callTimeout ?? 60_000;
  const waitTimeout = options.waitTimeout ?? 30_000;
  // X11 because the display is Xvfb's.
  const args = ["--ozone-platform=x11", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    ...(options.args ?? []), url];
  const command = options.cpu === undefined ? [executable, ...args] : ["taskset", "-c", String(options.cpu), executable, ...args];
  const unit = `chromium-launch-${randomUUID()}.scope`;
  const child = spawn("systemd-run", ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`,
    "dbus-run-session", `--config-file=${busConfig}`, "--", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24", ...command], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  let launchError: Error | undefined;
  let exited = false;
  let failed = false;
  let failedLine = "";
  const pending = new Map<number, { accept: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  const rejectAll = (message: string) => {
    for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(new Error(message)); }
    pending.clear();
  };
  child.on("error", error => { launchError = error; });
  child.on("exit", () => { exited = true; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => {
      log += String(chunk);
      options.logTo?.write(chunk);
      if (!failed && failure?.test(log)) {
        failed = true;
        // The line itself: the process may end before a log file is flushed.
        const line = log.split("\n").find(text => failure.test(text))?.trim();
        failedLine = line ?? "";
        rejectAll(`The renderer failed a check: ${failedLine}`);
      }
    });
  }
  // Stop by the launch's own unit, including any reparented descendants.
  let stopped = false;
  const kill = () => {
    if (stopped) return;
    try { execFileSync("systemctl", ["--user", "stop", unit], { stdio: "pipe" }); }
    catch (error) {
      const message = error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
      if (!exited && !/not (?:loaded|found)/.test(message)) throw error;
    }
    stopped = true;
    activeLaunches.delete(kill);
    rmSync(busDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (options.profile === undefined) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  activeLaunches.add(kill);

  async function until<T>(predicate: () => T | Promise<T>, label: string, timeout = waitTimeout): Promise<NonNullable<T>> {
    const deadline = performance.now() + timeout;
    do {
      if (launchError) throw launchError;
      if (failed) throw new Error(`The renderer failed a check while waiting for ${label}: ${failedLine}`);
      if (exited) throw new Error(`The shell exited while waiting for ${label}`);
      const value = await predicate();
      if (value) return value as NonNullable<T>;
      await delay(100);
    } while (performance.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  }

  try {
    const endpoint = await until(() => log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], "DevTools");
    const group = execFileSync("systemctl", ["--user", "show", unit, "--property=ControlGroup", "--value"], { encoding: "utf8" }).trim();
    assert(group.startsWith("/") && !group.split("/").includes("..") && group.endsWith(`/${unit}`), `Invalid launch cgroup: ${group}`);
    const sockets = (await readdir(busDirectory, { withFileTypes: true })).filter(entry => entry.isSocket());
    assert.equal(sockets.length, 1, "the launch must have exactly one private session-bus socket");
    const busAddress = `unix:path=${encodeURIComponent(join(busDirectory, sockets[0].name))}`;
    log += `\nlaunch unit=${unit} cgroup=${group} private-session-bus=${busAddress}\n`;
    const processes = () => scopeProcesses(group, executable);
    const origin = `http://${new URL(endpoint).host}`;
    const choose = options.target ?? ((target: Target) => target.type === "page");
    const target = await until(async () => {
      const targets = await (await fetch(`${origin}/json/list`)).json() as Target[];
      return targets.find(choose);
    }, "the page");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error("DevTools connection timed out")), 10_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); accept(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("DevTools connection failed")); }, { once: true });
    });
    let id = 0;
    const handlers = new Map<string, Array<(params: Record<string, unknown>) => void>>();
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: Record<string, unknown>; error?: unknown; result?: unknown };
      if (message.method !== undefined) for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {});
      const entry = message.id === undefined ? undefined : pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id!);
      clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.accept(message.result);
    });
    socket.addEventListener("close", () => rejectAll("The page's DevTools connection closed"));
    const cdp = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((accept, reject) => {
      if (failed) { reject(new Error(`The renderer failed a check: ${failedLine}`)); return; }
      const next = ++id;
      const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`DevTools call timed out: ${method}`)); }, callTimeout);
      pending.set(next, { accept: value => accept(value as T), reject, timeout });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = await cdp<{ exceptionDetails?: unknown; result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    return {
      pid: child.pid!, unit, cgroup: group, busAddress, processes, origin,
      pinForMeasurement: async () => {
        assert(options.cpu !== undefined, "openPage needs a CPU birth mask before pinning a measured launch");
        return pinLaunchProcesses(await processes(), options.cpu);
      },
      log: () => log, exited: () => exited, cdp, evaluate, until, kill,
      on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
      // Closing its last window ends the shell, as closing the app's would; a
      // shell still there after that is killed.
      async close() {
        await cdp("Page.close").catch(() => undefined);
        const deadline = performance.now() + 20_000;
        while (!exited && performance.now() < deadline) await delay(100);
        socket.close();
        kill();
      },
    };
  } catch (error) {
    kill();
    throw error;
  }
}
