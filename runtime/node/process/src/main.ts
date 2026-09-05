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
import { env, refreshEnvironment } from "./env.ts";
import { emitWarningFor, onWarningFor } from "./warning.ts";
import {
  availableMemory,
  constrainedMemory,
  cpuUsage,
  hrtime,
  hrtimeBigInt,
  memoryUsage,
  memoryUsageRss,
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
import { exceptionWithHostPort, uvException } from "../../internal/uv.ts";
import { nextTick } from "../../internal/tick.ts";
import { setProcessWarningHandler } from "../../internal/process-warning.ts";

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
declare function nts_process_execve(path: string, args: string[], env: string[]): void;
/** Zero on success, otherwise a negative libuv filesystem error. */
declare function nts_process_load_env_file(path: string): number;
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
  readonly #bare: Set<string>;

  constructor(flags: string[]) {
    super();
    // `super(flags)` consults the subclass's overridden `add`, whose public
    // behavior must be a no-op. Populate the inherited storage explicitly
    // through the statically named base method instead.
    for (const flag of flags) super.add(flag);
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
      return super.has(normalized.replace(/=.*$/, ""));
    }
    return this.#bare.has(normalized);
  }
}

const refSymbol: unique symbol = Symbol.for("nodejs.ref");
const unrefSymbol: unique symbol = Symbol.for("nodejs.unref");

/** The current symbol protocol and its legacy string-named fallback. */
interface Refable {
  [refSymbol]?: ((this: Refable) => unknown) | undefined;
  [unrefSymbol]?: ((this: Refable) => unknown) | undefined;
  ref?: ((this: Refable) => unknown) | undefined;
  unref?: ((this: Refable) => unknown) | undefined;
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
  readonly release = releaseMetadata();
  readonly features: Record<string, unknown> = metadata("features");
  // Readonly in the static API. Node additionally freezes these objects at
  // runtime, but per-property mutability/extensibility is a §13 non-goal.
  readonly config: Record<string, unknown> = metadata("config");
  readonly allowedNodeEnvironmentFlags = new NodeEnvironmentFlagsSet(
    nts_process_allowed_env_flags(),
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
    // Through the shared implementation rather than the binding, because a
    // tick is an asynchronous resource: it reports itself to `async_hooks` and
    // it carries the current context to its callback. Calling the binding here
    // made `process.nextTick` and the internal one two different things, and
    // only one of them was a tick anybody could observe.
    nextTick(callback, ...args);
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
    if (pid != (pid | 0)) {
      throw new ERR_INVALID_ARG_TYPE("pid", "number", pid);
    }
    const err = this._kill(pid, signalNumber(signal));
    if (err) throw exceptionWithHostPort(err, "kill");
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
    if (code !== undefined) this.exitCode = code;

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

  emitWarning = emitWarningFor(this);

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

  /** Keep a resource alive through Node's symbol protocol or legacy method. */
  ref(resource: Refable | null | undefined): void {
    if (resource == null) return;
    const ref = resource[refSymbol] ?? resource.ref;
    if (typeof ref === "function") ref.call(resource);
  }

  /** Release a resource through Node's symbol protocol or legacy method. */
  unref(resource: Refable | null | undefined): void {
    if (resource == null) return;
    const unref = resource[unrefSymbol] ?? resource.unref;
    if (typeof unref === "function") unref.call(resource);
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
      return;
    }
    if (typeof fn !== "function") {
      throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "null"], fn);
    }
    if (this.#captureCallback !== null) {
      throw new ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET();
    }
    this.#captureCallback = fn;
  }

  hasUncaughtExceptionCaptureCallback(): boolean {
    return this.#captureCallback !== null;
  }

  #captureCallback: ((error: unknown) => void) | null = null;

  /**
   * An exception that escaped everything. Returns whether anyone took it.
   *
   * The order is the whole of the policy. A capture callback wins, because a
   * program that installed one asked to be the last word. Node additionally
   * toggles V8's `--abort-on-uncaught-exception` state here; NTS has no engine
   * flag of that kind, so there is no native flag-shaped binding to imitate.
   * Otherwise the `uncaughtException` event is emitted, and `emit` returning
   * false means nothing was listening, which is the one case where the process
   * really is finished.
   *
   * Node calls this `_fatalException` and calls it from C++ at the point the
   * stack has unwound completely. The name is kept because node's own tests
   * replace it.
   */
  _fatalException(error: unknown, fromPromise = false): boolean {
    const origin = fromPromise ? "unhandledRejection" : "uncaughtException";
    this.emit("uncaughtExceptionMonitor", error, origin);
    if (this.#captureCallback !== null) {
      this.#captureCallback(error);
      return true;
    }
    return this.emit("uncaughtException", error, origin);
  }

  /**
   * Replace this process image with another program.
   *
   * Not a spawn: nothing comes back, the pid stays the same, and everything
   * this process was holding is gone. That is the point -- a supervisor that
   * `execve`s its real payload keeps the pid its own supervisor is watching.
   */
  execve(
    execPath: string,
    args: string[] = [],
    environment: Readonly<Record<string, string | undefined>> = this.env,
  ): void {
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
    const keys = Object.keys(environment);
    const pairs = new Array<string>(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === undefined) throw new Error(`missing environment key at index ${i}`);
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
      pairs[i] = `${key}=${value}`;
    }

    nts_process_execve(execPath, args, pairs);
  }

  loadEnvFile(path = ".env"): void {
    validateString(path, "path");
    const result = nts_process_load_env_file(path);
    if (result !== 0) throw uvException(result, "open", path);
    refreshEnvironment();
  }

  /** Write past every stream and every hook, for debugging the streams. */
  _rawDebug(...args: unknown[]): void {
    nts_process_raw_debug(args.map((a) => String(a)).join(" "));
  }
}

/** One metadata table, parsed. */
function metadata(name: string): Record<string, unknown> {
  const value: unknown = JSON.parse(nts_process_metadata(name));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid process ${name} metadata`);
  }
  return Object.fromEntries(Object.entries(value));
}

function releaseMetadata(): Record<string, string> & { name: string } {
  const raw = metadata("release");
  const release: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new Error(`invalid process release metadata field ${key}`);
    }
    release[key] = value;
  }
  const name = release["name"];
  if (name === undefined) throw new Error("process release metadata has no name");
  return { ...release, name };
}

function buildVersions(): Record<string, string> {
  const names = nts_process_version_names();
  const values = nts_process_version_values();
  const versions: Record<string, string> = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const value = values[i];
    if (name === undefined || value === undefined) {
      throw new Error(`incomplete process version record at index ${i}`);
    }
    versions[name] = value;
  }
  return versions;
}

const process = new Process();

setProcessWarningHandler(process.emitWarning);
process.on("warning", onWarningFor(process));

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
export {
  env,
  hrtimeBigInt as _hrtimeBigInt,
  memoryUsageRss as _memoryUsageRss,
};
