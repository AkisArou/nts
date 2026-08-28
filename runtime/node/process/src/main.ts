// `node:process`, assembled from node v24.20.0 `lib/internal/process/*` and
// `lib/internal/bootstrap/node.js`.
//
// Node has no `lib/process.js` worth the name -- the real file is four lines
// that re-export the global. The object is built at bootstrap out of several
// internal files, and this is that assembly: the pieces live in `env.ts`,
// `resources.ts`, `control.ts` and `warning.ts`, and what is here is the
// object they hang on and the parts that need the object to exist.
//
// It is an `EventEmitter`, which is not decoration. `exit`, `beforeExit`,
// `uncaughtException`, `unhandledRejection` and every signal are delivered as
// events, and a program's only way to react to its own shutdown is to listen.
// So `process` is one of the few objects that has to exist before almost
// anything else, and `node:events` is its one sibling dependency.

import { EventEmitter } from "../../events/src/main.ts";
import { stderr, stdout } from "../../internal/stdio.ts";
import { env } from "./env.ts";
import { emitWarningFor, onWarningFor } from "./warning.ts";
import type { WarningTarget } from "./warning.ts";
import {
  availableMemory,
  constrainedMemory,
  cpuUsage,
  hrtime,
  memoryUsage,
  resourceUsage,
  threadCpuUsage,
  uptime,
} from "./resources.ts";
import {
  abort,
  chdir,
  cwd,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  initgroups,
  rawKill,
  reallyExit,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  signalNumber,
  umask,
} from "./control.ts";
import {
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET,
} from "../../internal/errors.ts";
import { validateArray, validateObject, validateString } from "../../internal/validators.ts";
import { uvException } from "../../internal/uv.ts";

declare function nts_next_tick(callback: (...args: never) => void, args: unknown[]): void;
declare function nts_process_pid(): number;
declare function nts_process_ppid(): number;
declare function nts_platform(): string;
declare function nts_process_arch(): string;
declare function nts_process_argv(): string[];
declare function nts_process_argv0(): string;
declare function nts_process_exec_path(): string;
declare function nts_process_exec_argv(): string[];
declare function nts_process_version(): string;
/** Component names and their versions, as two columns of one table. */
declare function nts_process_version_names(): string[];
declare function nts_process_version_values(): string[];
declare function nts_process_title(): string;
declare function nts_process_set_title(title: string): void;
/** The flags this build accepts in `NODE_OPTIONS`. */
declare function nts_process_allowed_env_flags(): string[];

/**
 * Build metadata, as JSON: `release`, `features`, `config`.
 *
 * JSON rather than the two-column shape the other tables use, because `config`
 * is nested and the others are read once. It is also what the compiled runtime
 * naturally has: this is fixed at build time, so it is a constant in the
 * binary, and a serialized constant is the one representation that does not
 * need a schema on both sides of the seam.
 */
declare function nts_process_metadata(name: string): string;

/** Names of what is currently keeping the loop alive. */
declare function nts_process_active_resources(): string[];
declare function nts_process_active_handles(): unknown[];
declare function nts_process_active_requests(): unknown[];
/** Tell the host whether an uncaught exception should abort rather than exit. */
declare function nts_process_set_abort_on_uncaught(abortOnUncaught: boolean): void;
declare function nts_process_execve(path: string, args: string[], env: string[]): void;
declare function nts_process_load_env_file(path: string): void;
declare function nts_process_raw_debug(text: string): void;

/**
 * The loop's two lifecycle moments.
 *
 * `beforeExit` fires when there is nothing left to do but the process has not
 * ended -- a listener may schedule more work and be asked again. `exit` fires
 * once, when it really is over. Both are the loop's to notice; nothing above
 * this seam can see that the queues have gone empty.
 */
declare function nts_process_on_before_exit(callback: (code: number) => void): void;
declare function nts_process_on_exit(callback: (code: number) => void): void;

/**
 * The set behind `process.allowedNodeEnvironmentFlags`.
 *
 * A `Set` that refuses to be changed, because the answer is a property of the
 * binary rather than of the program: adding to it would not make the runtime
 * accept a flag. The mutators are present and do nothing, so that code written
 * against `Set` does not crash on it.
 *
 * `has` is generous about spelling. `--experimental-vm-modules`,
 * `experimental-vm-modules` and `--experimental_vm_modules` are the same flag
 * to the option parser, so they are the same flag here.
 */
class NodeEnvironmentFlagsSet extends Set<string> {
  // The flags live here, and the inherited `Set` storage is left empty on
  // purpose. It reads like a mistake and is the only design that holds.
  //
  // Filling the real set works until someone writes
  // `Set.prototype.add.call(flags, "foo")`, which goes straight past the
  // overridden `add` and into the superclass storage -- and then a `has` that
  // consulted that storage would report a flag this build does not accept.
  // Node's own test does exactly that, because the whole point of the object
  // is that its answer cannot be changed from outside: it describes what the
  // binary will accept, and no amount of adding to a set makes that true.
  //
  // Everything that would otherwise read the empty storage is overridden.
  readonly #flags: readonly string[];
  readonly #canonical: Set<string>;
  readonly #bare: Set<string>;

  constructor(flags: string[]) {
    super();
    this.#flags = flags;
    this.#canonical = new Set(flags);
    this.#bare = new Set(flags.map((flag) => flag.replace(/^--?/, "")));
  }

  override add(): this {
    return this;
  }

  override delete(): boolean {
    return false;
  }

  override clear(): void {
    // Deliberately nothing.
  }

  /**
   * Whether this build accepts the flag, however it is spelled.
   *
   * `--experimental-vm-modules`, `experimental_vm_modules` and
   * `--experimental-vm-modules=1` are the same flag to the option parser, so
   * they are the same flag here. Without the leading dashes it is matched
   * against the bare forms, which is how a program checks a flag it read from
   * `NODE_OPTIONS` without knowing how the user wrote it.
   */
  override has(key: unknown): boolean {
    if (typeof key !== "string") return false;
    const normalized = key.replace(/_/g, "-");
    if (/^--?/.test(normalized)) {
      return this.#canonical.has(normalized.replace(/=.*$/, ""));
    }
    return this.#bare.has(normalized);
  }

  override get size(): number {
    return this.#flags.length;
  }

  override values(): SetIterator<string> {
    return this.#canonical.values();
  }

  override keys(): SetIterator<string> {
    return this.#canonical.values();
  }

  override entries(): SetIterator<[string, string]> {
    return this.#canonical.entries();
  }

  override forEach<T>(
    callback: (value: string, key: string, set: Set<string>) => void,
    thisArg?: T,
  ): void {
    for (const flag of this.#flags) {
      callback.call(thisArg as T, flag, flag, this);
    }
  }

  override [Symbol.iterator](): SetIterator<string> {
    return this.#canonical.values();
  }
}

/**
 * The process.
 *
 * A class with one instance rather than an object literal, so that the methods
 * live on a prototype: node's tests read `process.constructor.name` and check
 * that methods are inherited rather than own properties.
 */
class Process extends EventEmitter {
  readonly env = env;
  readonly pid = nts_process_pid();
  readonly ppid = nts_process_ppid();
  readonly platform = nts_platform();
  readonly arch = nts_process_arch();
  readonly version = nts_process_version();
  readonly argv = nts_process_argv();
  readonly argv0 = nts_process_argv0();
  readonly execPath = nts_process_exec_path();
  readonly execArgv = nts_process_exec_argv();

  readonly stdout = stdout;
  readonly stderr = stderr;

  /** Set by `exit`, and readable by an `exit` listener deciding what to do. */
  exitCode: number | undefined = undefined;
  _exiting = false;

  // The four warning switches. Node sets these from the command line; they are
  // writable here because a program is also allowed to set them, and node's
  // own tests do.
  noDeprecation = false;
  throwDeprecation = false;
  traceDeprecation = false;
  traceProcessWarnings = false;

  readonly versions: Record<string, string> = buildVersions();

  // Own properties rather than prototype getters: node's own test asserts
  // `Object.hasOwn(process, 'config')`, and a getter on the prototype is not
  // that. Parsed eagerly for the same reason -- an own property that appears
  // on first read is a different object shape before and after.
  readonly release: Record<string, string> = metadata("release");
  readonly features: Record<string, unknown> = metadata("features");
  // Frozen, all the way down. It describes how this binary was built, so an
  // assignment to it is always a mistake -- and a silent one without the
  // freeze, since the writer would go on believing the build had changed.
  readonly config: Record<string, unknown> = deepFreeze(metadata("config"));
  // Frozen: the answer is a property of the binary, and a program that could
  // change it would only be lying to itself.
  readonly allowedNodeEnvironmentFlags = Object.freeze(
    new NodeEnvironmentFlagsSet(nts_process_allowed_env_flags()),
  );

  get title(): string {
    return nts_process_title();
  }

  set title(value: string) {
    nts_process_set_title(value);
  }

  /**
   * Run `callback` before the loop does anything else.
   *
   * The queue itself is the runtime's, not this module's, because the point
   * where it drains cannot be expressed from here: it is between the current
   * operation and the microtask checkpoint, and nothing in the language names
   * that instant.
   */
  nextTick<A extends unknown[]>(callback: (...args: A) => void, ...args: A): void {
    if (typeof callback !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
    }
    nts_next_tick(callback as unknown as (...a: never) => void, args);
  }

  cwd(): string {
    return cwd();
  }

  chdir(directory: string): void {
    chdir(directory);
  }

  umask(mask?: number | string): number {
    return umask(mask);
  }

  uptime(): number {
    return uptime();
  }

  hrtime = hrtime;
  cpuUsage = cpuUsage;
  threadCpuUsage = threadCpuUsage;
  memoryUsage = memoryUsage;
  resourceUsage = resourceUsage;
  availableMemory = availableMemory;
  constrainedMemory = constrainedMemory;

  abort(): never {
    return abort();
  }

  /**
   * The raw signal delivery, separated so it can be replaced.
   *
   * Node splits `kill` from `_kill` for exactly one reason: its own tests
   * replace `_kill` to observe what signal a subsystem sent without actually
   * sending it. Keeping the split keeps those tests meaningful.
   */
  _kill(pid: number, signal: number): number {
    return rawKill(pid, signal);
  }

  kill(pid: number, signal?: string | number): boolean {
    // `!=` on purpose: node accepts a numeric string here, and the check is
    // "does this round-trip through a 32-bit integer", not "is this a number".
    // eslint-disable-next-line eqeqeq
    if (pid != (pid | 0)) {
      throw new ERR_INVALID_ARG_TYPE("pid", "number", pid);
    }
    const err = this._kill(pid, signalNumber(signal as string | number));
    if (err) throw uvException(err, "kill");
    return true;
  }

  reallyExit(code: number): void {
    reallyExit(code);
  }

  /**
   * Ask the process to end.
   *
   * The `exit` event fires here rather than in the runtime, and it fires
   * exactly once even if a listener calls `exit` again -- which is not
   * hypothetical, because the usual reason to listen is to flush something,
   * and flushing can fail and call `exit` with a different code.
   */
  exit(code?: number): void {
    if (code !== undefined) this.exitCode = code as number;

    if (!this._exiting) {
      this._exiting = true;
      this.emit("exit", this.exitCode || 0);
    }
    this.reallyExit(this.exitCode || 0);
  }

  getuid(): number {
    return getuid();
  }
  getgid(): number {
    return getgid();
  }
  geteuid(): number {
    return geteuid();
  }
  getegid(): number {
    return getegid();
  }
  getgroups(): number[] {
    return getgroups();
  }
  setuid(id: number | string): void {
    setuid(id);
  }
  setgid(id: number | string): void {
    setgid(id);
  }
  seteuid(id: number | string): void {
    seteuid(id);
  }
  setegid(id: number | string): void {
    setegid(id);
  }
  setgroups(groups: (number | string)[]): void {
    setgroups(groups);
  }
  initgroups(user: number | string, extraGroup: number | string): void {
    initgroups(user, extraGroup);
  }

  emitWarning!: ReturnType<typeof emitWarningFor>;

  /**
   * What is currently keeping the loop from exiting, by name.
   *
   * The loop's own answer, not any module's. A timer, a socket and a pending
   * DNS lookup all hold the process open, and only the thing driving the loop
   * knows about all three -- so asking each module and merging would be a list
   * that is wrong whenever a module forgets to register.
   */
  getActiveResourcesInfo(): string[] {
    return nts_process_active_resources();
  }

  _getActiveHandles(): unknown[] {
    return nts_process_active_handles();
  }

  _getActiveRequests(): unknown[] {
    return nts_process_active_requests();
  }

  /**
   * Divert uncaught exceptions to `fn` instead of ending the process.
   *
   * At most one at a time, and that is the whole reason this is a function
   * rather than a property. Two libraries each installing a handler and each
   * assuming it is the only one is a debugger silently losing every exception
   * to a test framework, or the reverse; refusing the second makes the
   * conflict visible where it happens.
   */
  setUncaughtExceptionCaptureCallback(fn: ((error: unknown) => void) | null): void {
    if (fn === null) {
      this.#captureCallback = null;
      nts_process_set_abort_on_uncaught(true);
      return;
    }
    if (typeof fn !== "function") {
      throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "null"], fn);
    }
    if (this.#captureCallback !== null) {
      throw new ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET();
    }
    this.#captureCallback = fn;
    nts_process_set_abort_on_uncaught(false);
  }

  hasUncaughtExceptionCaptureCallback(): boolean {
    return this.#captureCallback !== null;
  }

  #captureCallback: ((error: unknown) => void) | null = null;

  /**
   * An exception that escaped everything. Returns whether anyone took it.
   *
   * The order is the whole of the policy. A capture callback wins, because a
   * program that installed one asked to be the last word -- that is what
   * `--abort-on-uncaught-exception` is turned off for. Otherwise the
   * `uncaughtException` event is emitted, and `emit` returning false means
   * nothing was listening, which is the one case where the process really is
   * finished.
   *
   * Node calls this `_fatalException` and calls it from C++ at the point the
   * stack has unwound completely. The name is kept because node's own tests
   * replace it.
   */
  _fatalException(error: unknown, fromPromise = false): boolean {
    if (this.#captureCallback !== null) {
      this.#captureCallback(error);
      return true;
    }
    return this.emit("uncaughtException", error, fromPromise ? "unhandledRejection" : "uncaughtException");
  }

  /**
   * Replace this process image with another program.
   *
   * Not a spawn: nothing comes back, the pid stays the same, and everything
   * this process was holding is gone. That is the point -- a supervisor that
   * `execve`s its real payload keeps the pid its own supervisor is watching.
   */
  execve(execPath: string, args: string[] = [], environment: Record<string, string> = this.env as Record<string, string>): void {
    this.emitWarning(
      "process.execve is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    if (this.platform === "win32") {
      throw new ERR_FEATURE_UNAVAILABLE_ON_PLATFORM("process.execve");
    }
    validateString(execPath, "execPath");
    validateArray(args, "args");
    for (let i = 0; i < args.length; i++) {
      const argument = args[i];
      if (typeof argument !== "string" || argument.includes("\u0000")) {
        throw new ERR_INVALID_ARG_VALUE(`args[${i}]`, argument, "must be a string without null bytes");
      }
    }

    validateObject(environment, "env");
    const pairs: string[] = [];
    for (const key of Object.keys(environment)) {
      const value = environment[key];
      // A null byte would truncate the variable at the C boundary, so a name
      // or value containing one is refused rather than silently cut in half.
      if (typeof value !== "string" || key.includes("\u0000") || value.includes("\u0000")) {
        throw new ERR_INVALID_ARG_VALUE(
          "env",
          environment,
          "must be an object with string keys and values without null bytes",
        );
      }
      pairs.push(`${key}=${value}`);
    }

    nts_process_execve(execPath, args, pairs);
  }

  loadEnvFile(path = ".env"): void {
    nts_process_load_env_file(path);
  }

  /** Write past every stream and every hook, for debugging the streams. */
  _rawDebug(...args: unknown[]): void {
    nts_process_raw_debug(args.map((a) => String(a)).join(" "));
  }
}

/** Freeze an object and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** One metadata table, parsed. */
function metadata(name: string): Record<string, never> {
  return JSON.parse(nts_process_metadata(name)) as Record<string, never>;
}

function buildVersions(): Record<string, string> {
  const names = nts_process_version_names();
  const values = nts_process_version_values();
  const versions: Record<string, string> = {};
  for (let i = 0; i < names.length; i++) {
    versions[names[i] as string] = values[i] as string;
  }
  return versions;
}

const process = new Process();

// Bound after construction because both read the finished object: the warning
// path needs the tick queue, the emitter and the deprecation switches, and
// none of those exist while the fields are still being initialised.
process.emitWarning = emitWarningFor(process as unknown as WarningTarget);
process.on("warning", onWarningFor(process as unknown as WarningTarget));

nts_process_on_before_exit((code) => {
  process.emit("beforeExit", process.exitCode ?? code);
});

// Guarded by the same flag `exit()` sets, because both paths lead here: a
// program that calls `process.exit` emits from there and then really exits,
// and the loop running dry emits from here. Exactly one of them is the first,
// and `exit` is documented to fire once.
nts_process_on_exit((code) => {
  if (process._exiting) return;
  process._exiting = true;
  process.emit("exit", process.exitCode ?? code);
});

export default process;
export { process, Process };
export { env };
