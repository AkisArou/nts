// `fs.watch` and `fs.watchFile`, from node v24.20.0
// `lib/internal/fs/watchers.js`.
//
// Two mechanisms with one purpose and very different characters, which is why
// node has both and why the documentation warns about each.
//
// `watch` asks the operating system: inotify on Linux, FSEvents on macOS,
// ReadDirectoryChangesW on Windows. It is cheap and prompt, and it is not
// uniform -- whether a rename arrives as one event or two, whether a filename
// is reported at all, and whether watching a directory sees changes inside
// subdirectories are all platform answers rather than node's.
//
// `watchFile` polls `stat` on an interval and compares. It is uniform,
// portable, and costs a system call per file per interval forever. It is what
// to use when the answer has to be the same everywhere, and what not to use
// for many files.

import { EventEmitter } from "../../events/src/main.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import {
  defaultTriggerAsyncIdScope,
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";
import { nextTick } from "../../internal/tick.ts";
import { uvException } from "../../internal/uv.ts";
import {
  compileGlobPatterns,
  matchesCompiledGlobPatterns,
  type CompiledGlobPattern,
} from "../../path/src/glob-matcher.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateInteger,
} from "../../internal/validators.ts";
import { Stats } from "./stats.ts";
import {
  getValidatedPath,
  encodeNormalizedFileBytes,
  normalizeFileResultEncoding,
  type FileResultEncoding,
  type PathLike,
} from "./options.ts";

declare function nts_platform(): string;

/** Start watching. The handle is what stops it again. */
declare function nts_fs_watch_start(
  path: string,
  recursive: boolean,
  persistent: boolean,
  throwIfNoEntry: boolean,
  callback: (status: number, event: string, filename: number[] | null) => void,
): number;
declare function nts_fs_watch_stop(handle: number): void;
declare function nts_fs_watch_ref(handle: number): void;
declare function nts_fs_watch_unref(handle: number): void;
/** Poll `path` every `interval` ms, reporting the two stat readings. */
declare function nts_fs_watchfile_start(
  path: string,
  interval: number,
  persistent: boolean,
  callback: (current: number[], previous: number[]) => void,
): number;
declare function nts_fs_watchfile_stop(handle: number): void;
declare function nts_fs_watchfile_ref(handle: number): void;
declare function nts_fs_watchfile_unref(handle: number): void;

export interface WatchSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export type WatchFileName = string | Buffer | null;
export type WatchListener = (event: string, filename: WatchFileName) => void;
export type WatchIgnoreFunction = (filename: string) => boolean;
export type WatchIgnoreElement = string | RegExp | WatchIgnoreFunction;
export type WatchIgnore = WatchIgnoreElement | WatchIgnoreElement[];

export interface WatchOptions {
  persistent?: boolean | undefined;
  recursive?: boolean | undefined;
  encoding?: string | undefined;
  signal?: WatchSignal | undefined;
  throwIfNoEntry?: boolean | undefined;
  ignore?: WatchIgnore | null | undefined;
}

function validateIgnoreElement(
  value: unknown,
  name: string,
): asserts value is WatchIgnoreElement {
  if (typeof value === "string") {
    if (value.length === 0) {
      throw new ERR_INVALID_ARG_VALUE(name, value, "must be a non-empty string");
    }
    return;
  }
  if (value instanceof RegExp || typeof value === "function") return;
  throw new ERR_INVALID_ARG_TYPE(name, ["string", "RegExp", "Function"], value);
}

export function normalizeWatchIgnore(
  value: unknown,
): WatchIgnore | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateIgnoreElement(value[i], `options.ignore[${i}]`);
    }
    return value;
  }
  validateIgnoreElement(value, "options.ignore");
  return value;
}

interface CompiledWatchGlob {
  readonly kind: "glob";
  readonly alternatives: CompiledGlobPattern[];
  readonly matchBase: boolean;
}

interface CompiledWatchRegExp {
  readonly kind: "regexp";
  readonly expression: RegExp;
}

interface CompiledWatchFunction {
  readonly kind: "function";
  readonly predicate: WatchIgnoreFunction;
}

type CompiledWatchIgnore =
  | CompiledWatchGlob
  | CompiledWatchRegExp
  | CompiledWatchFunction;

const watchPlatform = nts_platform();
const watchWindows = watchPlatform === "win32";
const watchNocase = watchWindows || watchPlatform === "darwin";

function watchPatternHasSeparator(pattern: string): boolean {
  return pattern.includes("/") || (watchWindows && pattern.includes("\\"));
}

function watchBaseName(filename: string): string {
  const slash = filename.lastIndexOf("/");
  const backslash = watchWindows ? filename.lastIndexOf("\\") : -1;
  return filename.slice(Math.max(slash, backslash) + 1);
}

function compileWatchIgnoreElement(
  matcher: WatchIgnoreElement,
): CompiledWatchIgnore {
  if (typeof matcher === "string") {
    return {
      kind: "glob",
      alternatives: compileGlobPatterns(matcher, watchWindows, watchNocase),
      matchBase: !watchPatternHasSeparator(matcher),
    };
  }
  if (typeof matcher === "function") {
    return { kind: "function", predicate: matcher };
  }
  return { kind: "regexp", expression: matcher };
}

function compileWatchIgnore(
  ignore: WatchIgnore | undefined,
): CompiledWatchIgnore[] | undefined {
  if (ignore === undefined) return undefined;
  if (!Array.isArray(ignore)) return [compileWatchIgnoreElement(ignore)];

  const compiled = new Array<CompiledWatchIgnore>(ignore.length);
  for (let index = 0; index < ignore.length; index++) {
    const matcher = ignore[index];
    if (matcher === undefined) {
      throw new Error(`watch ignore list is missing element ${index}`);
    }
    compiled[index] = compileWatchIgnoreElement(matcher);
  }
  return compiled;
}

function ignoreElementMatches(
  matcher: CompiledWatchIgnore,
  filename: string,
): boolean {
  if (matcher.kind === "function") return matcher.predicate(filename);
  if (matcher.kind === "regexp") return matcher.expression.test(filename);
  const candidate = matcher.matchBase ? watchBaseName(filename) : filename;
  return matchesCompiledGlobPatterns(
    candidate,
    matcher.alternatives,
    watchWindows,
  );
}

function shouldIgnore(
  ignore: CompiledWatchIgnore[] | undefined,
  filename: string,
): boolean {
  if (ignore === undefined) return false;
  for (let index = 0; index < ignore.length; index++) {
    const matcher = ignore[index];
    if (matcher !== undefined && ignoreElementMatches(matcher, filename)) {
      return true;
    }
  }
  return false;
}

function emitWatcherClose(watcher: FSWatcher): void {
  watcher.emit("close");
}

function emitWatcherStop(watcher: StatWatcher): void {
  watcher.emit("stop");
}

function closeWatcher(watcher: FSWatcher): void {
  watcher.close();
}

export class FSWatcher extends EventEmitter {
  #handle: number | null = null;
  #path: string | undefined;
  #asyncId: number;
  #triggerAsyncId: number;
  #contextFrame: AsyncContextFrame | undefined;
  #destroyed = false;
  #encoding: FileResultEncoding | undefined;
  #signal: WatchSignal | undefined;
  #abortListener: (() => void) | undefined;
  #ignore: CompiledWatchIgnore[] | undefined;

  constructor() {
    super();
    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = getDefaultTriggerAsyncId();
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(
        this.#asyncId,
        "FSEVENTWRAP",
        this.#triggerAsyncId,
        this,
      );
    }
  }

  /**
   * Begin watching.
   *
   * Separate from the constructor because node's is: `new FSWatcher()` gives
   * an object you can add listeners to before anything can fire, which
   * matters when the first event may arrive during `start`.
   */
  start(path: PathLike, options: WatchOptions = {}): this {
    const persistent = options.persistent ?? true;
    const recursive = options.recursive ?? false;
    const throwIfNoEntry = options.throwIfNoEntry ?? true;
    validateBoolean(persistent, "options.persistent");
    validateBoolean(recursive, "options.recursive");
    validateBoolean(throwIfNoEntry, "options.throwIfNoEntry");
    this.#ignore = compileWatchIgnore(normalizeWatchIgnore(options.ignore));
    this.#encoding = normalizeFileResultEncoding(options.encoding);
    const validatedPath = getValidatedPath(path, "filename");
    this.#path = validatedPath;
    this.#handle = nts_fs_watch_start(
      validatedPath,
      recursive,
      persistent,
      throwIfNoEntry,
      (status: number, event: string, filename: number[] | null) => {
        if (status < 0) {
          const error = uvException(status, "watch", validatedPath);
          error.filename = validatedPath;
          this.#stop(false);
          this.emit("error", error);
          return;
        }
        const decoded = filename === null ? null : Buffer.from(filename).toString();
        if (decoded !== null && shouldIgnore(this.#ignore, decoded)) return;
        const prior = AsyncContextFrame.exchange(this.#contextFrame);
        emitBefore(this.#asyncId, this.#triggerAsyncId, this);
        try {
          this.emit(
            "change",
            event,
            filename === null
              ? null
              : encodeNormalizedFileBytes(filename, this.#encoding),
          );
        } finally {
          emitAfter(this.#asyncId);
          AsyncContextFrame.setCurrent(prior);
        }
      },
    );
    if (this.#handle < 0) {
      const error = uvException(this.#handle, "watch", validatedPath);
      error.filename = validatedPath;
      this.#handle = null;
      this.#destroy();
      throw error;
    }
    return this;
  }

  /** Attach cancellation after listeners can be installed on the watcher. */
  attachSignal(signal: WatchSignal): void {
    validateAbortSignal(signal, "options.signal");
    validateFunction(signal.addEventListener, "options.signal.addEventListener");
    validateFunction(signal.removeEventListener, "options.signal.removeEventListener");
    if (signal.aborted) {
      nextTick(closeWatcher, this);
      return;
    }
    const abortListener = (): void => this.close();
    this.#signal = signal;
    this.#abortListener = abortListener;
    signal.addEventListener("abort", abortListener, { once: true });
  }

  close(): void {
    this.#stop(true);
  }

  #stop(emitClose: boolean): void {
    if (this.#handle === null) return;
    const signal = this.#signal;
    const abortListener = this.#abortListener;
    this.#signal = undefined;
    this.#abortListener = undefined;
    if (signal !== undefined && abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
    nts_fs_watch_stop(this.#handle);
    this.#handle = null;
    this.#destroy();
    if (emitClose) nextTick(emitWatcherClose, this);
  }

  /**
   * Stop holding the process open, without stopping watching.
   *
   * A watcher on a config file should not be the reason a program never
   * exits, but should still fire while it is running.
   */
  ref(): this {
    if (this.#handle !== null) nts_fs_watch_ref(this.#handle);
    return this;
  }

  unref(): this {
    if (this.#handle !== null) nts_fs_watch_unref(this.#handle);
    return this;
  }

  get path(): string | undefined {
    return this.#path;
  }

  #destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    emitDestroy(this.#asyncId);
  }
}

export class StatWatcher extends EventEmitter {
  #handle: number | null = null;
  #asyncId = 0;
  #triggerAsyncId = 0;
  #contextFrame: AsyncContextFrame | undefined;

  start(path: string, interval: number, persistent: boolean): this {
    if (this.#handle !== null) return this;

    this.#asyncId = newAsyncId();
    this.#triggerAsyncId = getDefaultTriggerAsyncId();
    this.#contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) {
      emitInit(
        this.#asyncId,
        "STATWATCHER",
        this.#triggerAsyncId,
        this,
      );
    }

    this.#handle = nts_fs_watchfile_start(path, interval, persistent, (current, previous) => {
      const prior = AsyncContextFrame.exchange(this.#contextFrame);
      emitBefore(this.#asyncId, this.#triggerAsyncId, this);
      try {
        this.emit("change", new Stats(current), new Stats(previous));
      } finally {
        emitAfter(this.#asyncId);
        AsyncContextFrame.setCurrent(prior);
      }
    });
    return this;
  }

  stop(): void {
    if (this.#handle === null) return;
    nts_fs_watchfile_stop(this.#handle);
    this.#handle = null;
    defaultTriggerAsyncIdScope(
      this.#asyncId,
      nextTick,
      emitWatcherStop,
      this,
    );
    emitDestroy(this.#asyncId);
    this.#asyncId = 0;
    this.#triggerAsyncId = 0;
    this.#contextFrame = undefined;
  }

  ref(): this {
    if (this.#handle !== null) nts_fs_watchfile_ref(this.#handle);
    return this;
  }

  unref(): this {
    if (this.#handle !== null) nts_fs_watchfile_unref(this.#handle);
    return this;
  }
}

export function watch(
  path: PathLike,
  options?: WatchOptions | string | WatchListener,
  listener?: WatchListener,
): FSWatcher {
  let opts: WatchOptions = {};
  if (typeof options === "function") {
    listener = options;
  } else if (typeof options === "string") {
    opts = { encoding: options };
  } else if (options !== null && options !== undefined && typeof options === "object") {
    opts = options;
  } else if (options !== null && options !== undefined) {
    throw new ERR_INVALID_ARG_TYPE("options", ["string", "Object", "Function"], options);
  }
  if (listener !== undefined) validateFunction(listener, "listener");

  const watcher = new FSWatcher();
  watcher.start(path, opts);
  if (typeof listener === "function") {
    watcher.on("change", listener);
  }

  if (opts.signal !== undefined) watcher.attachSignal(opts.signal);

  return watcher;
}

/**
 * Every path being polled, and its watcher.
 *
 * Shared because `watchFile` on the same path twice must poll once and deliver
 * to both listeners -- otherwise a library and its caller watching the same
 * file would double the polling cost invisibly.
 */
const statWatchers = new Map<string, StatWatcher>();

export function watchFile(
  path: PathLike,
  options?: { interval?: number; persistent?: boolean } |
    ((current: Stats, previous: Stats) => void),
  listener?: (current: Stats, previous: Stats) => void,
): StatWatcher {
  let interval = 5007;
  let persistent = true;
  if (typeof options === "function") {
    listener = options;
  } else if (options !== null && options !== undefined) {
    if (typeof options !== "object") {
      throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    if (options.interval !== undefined) interval = options.interval;
    if (options.persistent !== undefined) persistent = options.persistent;
  }
  validateFunction(listener, "listener");
  validateInteger(interval, "options.interval", 0, 2_147_483_647);
  validateBoolean(persistent, "options.persistent");

  const validatedPath = getValidatedPath(path, "filename");

  let watcher = statWatchers.get(validatedPath);
  if (!watcher) {
    watcher = new StatWatcher();
    statWatchers.set(validatedPath, watcher);
    watcher.start(validatedPath, interval, persistent);
  }
  watcher.on("change", listener);
  return watcher;
}

export function unwatchFile(
  path: PathLike,
  listener?: (current: Stats, previous: Stats) => void,
): void {
  const validatedPath = getValidatedPath(path, "filename");
  const watcher = statWatchers.get(validatedPath);
  if (!watcher) return;

  if (typeof listener === "function") {
    watcher.removeListener("change", listener);
  } else {
    watcher.removeAllListeners("change");
  }

  // Polling with nobody listening is a system call per interval for no
  // reason, so the last listener leaving stops it.
  if (watcher.listenerCount("change") === 0) {
    watcher.stop();
    statWatchers.delete(validatedPath);
  }
}
