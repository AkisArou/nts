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
import { validateString } from "../../internal/validators.ts";
import { uvException } from "../../internal/uv.ts";
import { Stats } from "./stats.ts";

/** Start watching. The handle is what stops it again. */
declare function nts_fs_watch_start(
  path: string,
  recursive: boolean,
  callback: (event: string, filename: string) => void,
): number;
declare function nts_fs_watch_stop(handle: number): void;
/** Poll `path` every `interval` ms, reporting the two stat readings. */
declare function nts_fs_watchfile_start(
  path: string,
  interval: number,
  callback: (current: number[], previous: number[]) => void,
): number;
declare function nts_fs_watchfile_stop(handle: number): void;

export interface WatchOptions {
  persistent?: boolean | undefined;
  recursive?: boolean | undefined;
  encoding?: string | undefined;
  signal?: { addEventListener(type: "abort", listener: () => void): void } | undefined;
}

export class FSWatcher extends EventEmitter {
  #handle: number | null = null;
  #path: string | undefined;

  /**
   * Begin watching.
   *
   * Separate from the constructor because node's is: `new FSWatcher()` gives
   * an object you can add listeners to before anything can fire, which
   * matters when the first event may arrive during `start`.
   */
  start(path: string, options: WatchOptions = {}): this {
    validateString(path, "filename");
    this.#path = path;
    this.#handle = nts_fs_watch_start(
      path,
      Boolean(options.recursive),
      (event: string, filename: string) => {
        this.emit("change", event, filename);
      },
    );
    if (this.#handle < 0) {
      const error = uvException(this.#handle, "watch", path);
      this.#handle = null;
      throw error;
    }
    return this;
  }

  close(): void {
    if (this.#handle === null) return;
    nts_fs_watch_stop(this.#handle);
    this.#handle = null;
    this.emit("close");
  }

  /**
   * Stop holding the process open, without stopping watching.
   *
   * A watcher on a config file should not be the reason a program never
   * exits, but should still fire while it is running.
   */
  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  get path(): string | undefined {
    return this.#path;
  }
}

export class StatWatcher extends EventEmitter {
  #handle: number | null = null;

  start(path: string, interval: number): this {
    this.#handle = nts_fs_watchfile_start(path, interval, (current, previous) => {
      this.emit("change", new Stats(current), new Stats(previous));
    });
    return this;
  }

  stop(): void {
    if (this.#handle === null) return;
    nts_fs_watchfile_stop(this.#handle);
    this.#handle = null;
    this.emit("stop");
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function watch(
  path: string,
  options?: WatchOptions | string | ((event: string, filename: string) => void),
  listener?: (event: string, filename: string) => void,
): FSWatcher {
  let opts: WatchOptions = {};
  if (typeof options === "function") {
    listener = options;
  } else if (typeof options === "string") {
    opts = { encoding: options };
  } else if (options) {
    opts = options;
  }

  const watcher = new FSWatcher();
  watcher.start(path, opts);
  if (typeof listener === "function") {
    watcher.on("change", listener as never);
  }

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => watcher.close());
  }

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
  path: string,
  options?: { interval?: number; persistent?: boolean } | ((current: Stats, previous: Stats) => void),
  listener?: (current: Stats, previous: Stats) => void,
): StatWatcher {
  let interval = 5007;
  if (typeof options === "function") {
    listener = options;
  } else if (options?.interval !== undefined) {
    interval = options.interval;
  }

  validateString(path, "filename");

  let watcher = statWatchers.get(path);
  if (!watcher) {
    watcher = new StatWatcher();
    statWatchers.set(path, watcher);
    watcher.start(path, interval);
  }
  if (typeof listener === "function") watcher.on("change", listener as never);
  return watcher;
}

export function unwatchFile(
  path: string,
  listener?: (current: Stats, previous: Stats) => void,
): void {
  validateString(path, "filename");
  const watcher = statWatchers.get(path);
  if (!watcher) return;

  if (typeof listener === "function") {
    watcher.removeListener("change", listener as never);
  } else {
    watcher.removeAllListeners("change");
  }

  // Polling with nobody listening is a system call per interval for no
  // reason, so the last listener leaving stops it.
  if (watcher.listenerCount("change") === 0) {
    watcher.stop();
    statWatchers.delete(path);
  }
}
