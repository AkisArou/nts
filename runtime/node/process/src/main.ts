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
// anything else, and `node:events` is very nearly its one sibling dependency.
// The exception is `process.stdin`, which needs `node:net` or `node:fs`
// depending on what fd 0 turns out to be. That is node's shape too, and node
// keeps it out of the bootstrap the same way: the stream is built inside the
// getter, so nothing is required until a program actually reads stdin.

import { EventEmitter } from "../../events/src/main.ts";
import { stderr, stdout } from "../../internal/stdio.ts";
import { stdinStream } from "./stdin.ts";
import type { Readable } from "../../stream/src/main.ts";
import { env, refreshEnvironment } from "./env.ts";
import { createProcessFinalization } from "./finalization.ts";
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
  isSignalName,
  signalNumber,
  umask,
} from "./control.ts";
import {
  ERR_FEATURE_UNAVAILABLE_ON_PLATFORM,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET,
} from "../../internal/errors.ts";
import {
  validateArray,
  validateInteger,
  validateObject,
  validateString,
} from "../../internal/validators.ts";
import { exceptionWithHostPort, uvException } from "../../internal/uv.ts";
import { nextTick } from "../../internal/tick.ts";
import { setProcessWarningHandler } from "../../internal/process-warning.ts";
import { format } from "../../util/src/format.ts";
import type { Architecture, Platform } from "../../os/src/main.ts";
import { channel } from "../../diagnostics_channel/src/main.ts";
import { emitAfter, emitBefore, getOrSetAsyncId } from "../../internal/async-hooks.ts";

const execveChannel = channel("process.execve");

/** @ntsAbi managed */
declare function nts_process_pid(): number;
/** @ntsAbi managed */
declare function nts_process_ppid(): number;
/** @ntsAbi managed */
declare function nts_platform(): Platform;
/** @ntsAbi managed */
declare function nts_process_arch(): Architecture;
/** @ntsAbi managed */
declare function nts_process_argv(): string[];
/** @ntsAbi managed */
declare function nts_process_argv0(): string;
/** @ntsAbi managed */
declare function nts_process_exec_path(): string;
/** @ntsAbi managed */
declare function nts_process_exec_argv(): string[];
/** @ntsAbi managed */
declare function nts_process_version(): string;
/** Component names and their versions, as two columns of one table. */
/** @ntsAbi managed */
declare function nts_process_version_names(): string[];
/** @ntsAbi managed */
declare function nts_process_version_values(): string[];
/** @ntsAbi managed */
declare function nts_process_title(): string;
/** @ntsAbi managed */
declare function nts_process_set_title(title: string): void;
/** The flags this build accepts in `NODE_OPTIONS`. */
/** @ntsAbi managed */
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
type ProcessMetadataName = "release" | "features" | "config";
/** @ntsAbi managed */
declare function nts_process_metadata(name: ProcessMetadataName): string;

/** Names of what is currently keeping the loop alive. */
/** @ntsAbi managed */
declare function nts_process_active_resources(): string[];
/** @ntsAbi managed */
declare function nts_process_active_handles(): unknown[];
/** @ntsAbi managed */
declare function nts_process_active_requests(): unknown[];
/** Tell the host whether an uncaught exception should abort rather than exit. */
/** @ntsAbi managed */
declare function nts_process_execve(
  path: string,
  args: readonly string[],
  env: readonly string[],
): never;
/** Zero on success, otherwise a negative libuv filesystem error. */
/** @ntsAbi managed */
declare function nts_process_load_env_file(path: string): number;
/**
 * The builtin named by `id`, or `undefined` if it is not one.
 *
 * A module object, so this is an interpreted-lane function by construction: an
 * object cannot cross the N-API boundary, and the compiled backend declines it
 * along with the other 496. That is the honest shape rather than a limitation of
 * this declaration -- `getBuiltinModule` exists to hand back `node:fs`, and there
 * is nothing to hand back on a lane where modules are linked rather than required.
 */
/** @ntsAbi managed */
declare function nts_process_get_builtin_module(id: string): unknown;
/** Stop the inspector, which is a no-op when none is attached. */
/** @ntsAbi managed */
declare function nts_process_debug_end(): void;
/** @ntsAbi managed */
declare function nts_process_raw_debug(text: string): void;

/**
 * The loop's two lifecycle moments.
 *
 * `beforeExit` fires when there is nothing left to do but the process has not
 * ended -- a listener may schedule more work and be asked again. `exit` fires
 * once, when it really is over. Both are the loop's to notice; nothing above
 * this seam can see that the queues have gone empty.
 */
/**
 * Start delivering `name` to this process's emitter. Negative on failure.
 *
 * The watcher must not keep the process alive: waiting for a signal is not
 * work, and a program whose only remaining listener is a signal handler
 * should still exit when its work is done.
 */
/** @ntsAbi managed */
declare function nts_process_signal_start(name: string): number;
/** Stop delivering `name`, restoring the operating system's default action. */
/** @ntsAbi managed */
declare function nts_process_signal_stop(name: string): void;
/** @ntsAbi managed */
declare function nts_process_on_before_exit(callback: (code: number) => void): void;
/** @ntsAbi managed */
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
/**
 * **Symbol-keyed, because `test/export-surface-static.js` says that list is not a place to put
 * things.** A string-named `_emitUnhandledRejection` is a name node does not publish, and that
 * fixture's `EXTRA` list exists for the four declared fields the object model forces and is pinned
 * "so it stays that". Its own history is the precedent: `_captureRejections` and
 * `_preserveEventShape` were on it and were moved to symbol keys rather than added to.
 *
 * Registered rather than private, as `util.promisify.custom` is, because the stand-in has to find
 * it from outside the module.
 */
const kEmitUnhandledRejection: symbol = Symbol.for("nts.process.emitUnhandledRejection");

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

// Process lifecycle is runtime-global, not instance state. Keeping it beside
// the one process singleton lets the public functions below be direct aliases
// that remain valid when called detached, as Node's bootstrap-installed
// closure functions do.
let currentExitCode: number | undefined = undefined;
let processExiting = false;
let captureCallback: ((error: unknown) => void) | null = null;
let handlingFatalException = false;

export interface ProcessRelease {
  readonly name: string;
  readonly sourceUrl?: string | undefined;
  readonly headersUrl?: string | undefined;
  readonly libUrl?: string | undefined;
  readonly lts?: string | undefined;
  readonly [name: string]: string | undefined;
}

export interface ProcessFeatures {
  readonly inspector: boolean;
  readonly debug: boolean;
  readonly uv: boolean;
  readonly ipv6: boolean;
  readonly openssl_is_boringssl: boolean;
  readonly quic: boolean;
  readonly tls_alpn: boolean;
  readonly tls_sni: boolean;
  readonly tls_ocsp: boolean;
  readonly tls: boolean;
  readonly cached_builtins: boolean;
  readonly require_module: boolean;
  readonly typescript: "strip" | "transform" | false;
}

export interface ProcessConfigVariables {
  readonly napi_build_version: string;
  readonly node_builtin_shareable_builtins: readonly string[];
  readonly node_use_amaro: boolean;
  readonly node_shared_openssl: boolean;
  readonly [name: string]: unknown;
}

export interface ProcessConfigTargetDefaults {
  readonly cflags: readonly string[];
  readonly default_configuration: string;
  readonly defines: readonly string[];
  readonly include_dirs: readonly string[];
  readonly libraries: readonly string[];
  readonly [name: string]: unknown;
}

export interface ProcessConfig {
  readonly variables: ProcessConfigVariables;
  readonly target_defaults: ProcessConfigTargetDefaults;
  readonly [name: string]: unknown;
}

export interface ProcessVersions {
  readonly node: string;
  readonly v8: string;
  readonly ares: string;
  readonly uv: string;
  readonly zlib: string;
  readonly modules: string;
  readonly napi: string;
  readonly openssl: string;
  readonly [name: string]: string;
}

/**
 * The process.
 *
 * A class with one instance rather than a loose object literal, so the runtime
 * has one fixed layout and one statically known method table.
 */
class Process extends EventEmitter {
  constructor() {
    super();
    this.#watchSignalListeners();
    nts_process_on_before_exit((code) => {
      this.emit("beforeExit", this.exitCode ?? code);
    });
    nts_process_on_exit((code) => {
      emitExitOnce(this, this.exitCode ?? code);
    });
  }

  readonly env = env;
  readonly pid = nts_process_pid();
  get ppid(): number {
    return nts_process_ppid();
  }
  readonly platform = nts_platform();
  readonly arch = nts_process_arch();
  readonly version = nts_process_version();
  readonly argv = nts_process_argv();
  readonly argv0 = nts_process_argv0();
  readonly execPath = nts_process_exec_path();
  readonly execArgv = nts_process_exec_argv();

  readonly stdout = stdout;
  readonly stderr = stderr;

  /**
   * Signals are delivered as events, so the operating-system watcher has to
   * follow the listeners: installed when a signal gets its first one and
   * retired when it loses its last. Node does exactly this, on the same two
   * events, and it matters in both directions -- without the install a
   * `SIGINT` listener never runs and the default action kills the process
   * instead, and without the retirement a program that stops listening has
   * quietly kept the default action suppressed.
   *
   * The watcher does not hold the process open. A program waiting only for a
   * signal it may never receive should still exit when its work is done, which
   * is why node unrefs the handle and why this seam does not count as work.
   */
  #watchSignalListeners(): void {
    this.on("newListener", (event: string) => {
      if (typeof event === "string" && isSignalName(event) && this.listenerCount(event) === 0) {
        const failure = nts_process_signal_start(event);
        if (failure < 0) throw uvException(failure, "uv_signal_start");
      }
    });
    this.on("removeListener", (event: string) => {
      if (typeof event === "string" && isSignalName(event) && this.listenerCount(event) === 0) {
        nts_process_signal_stop(event);
      }
    });
  }

  /**
   * Built on first use, as node builds it, and for node's reason: acquiring a
   * handle on fd 0 is not free and a program that never reads stdin should not
   * pay for one. See `stdin.ts` for how the descriptor's kind picks the
   * stream.
   */
  get stdin(): Readable {
    return stdinStream();
  }

  /** The normalized code a graceful or explicit exit will report. */
  get exitCode(): number | undefined {
    return currentExitCode;
  }

  set exitCode(code: number | string | null | undefined) {
    if (code === null || code === undefined) {
      currentExitCode = undefined;
      return;
    }

    let value: number | string = code;
    if (typeof code === "string" && code !== "") {
      const converted = Number(code);
      if (!Number.isNaN(converted)) value = converted;
    }
    validateInteger(value, "code");
    // Node stores this field in the runtime's signed 32-bit exit-info table.
    // Preserve that representation after accepting the wider safe-integer
    // input: the OS ultimately consumes only the low exit-status bits too.
    currentExitCode = value | 0;
  }

  /** Node's bootstrap-visible indication that terminal exit has begun. */
  get _exiting(): boolean {
    return processExiting;
  }

  set _exiting(value: boolean) {
    processExiting = value;
  }

  // The four warning switches. Node sets these from the command line; they are
  // writable here because a program is also allowed to set them, and node's
  // own tests do.
  noDeprecation = false;
  throwDeprecation = false;
  traceDeprecation = false;
  traceProcessWarnings = false;

  readonly versions: ProcessVersions = buildVersions();

  // Own properties rather than prototype getters: node's own test asserts
  // `Object.hasOwn(process, 'config')`, and a getter on the prototype is not
  // that. Parsed eagerly for the same reason -- an own property that appears
  // on first read is a different object shape before and after.
  readonly release: ProcessRelease = releaseMetadata();
  readonly features: ProcessFeatures = featuresMetadata();
  // Readonly in the static API. Node additionally freezes these objects at
  // runtime, but per-property mutability/extensibility is a §13 non-goal.
  readonly config: ProcessConfig = configMetadata();
  allowedNodeEnvironmentFlags: ReadonlySet<string> = new NodeEnvironmentFlagsSet(
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
  // A named function expression rather than the rename the other four got:
  // `nextTick` is already an import at the top of this file, and the
  // implementation *calls* it. Renaming the module function to `nextTick`
  // shadowed that import, so the function called itself -- unbounded recursion
  // that the module loader caught first as a redeclaration. The name node
  // publishes and the name of the internal it delegates to are the same word,
  // and only one of them can have it at module scope.
  nextTick = function nextTick<A extends unknown[]>(
    callback: (...args: A) => void,
    ...args: A
  ): void {
    processNextTick(callback, ...args);
  };

  cwd = cwd;
  chdir = chdir;
  umask = umask;
  uptime = uptime;

  hrtime = hrtime;
  cpuUsage = cpuUsage;
  threadCpuUsage = threadCpuUsage;
  memoryUsage = memoryUsage;
  resourceUsage = resourceUsage;
  availableMemory = availableMemory;
  constrainedMemory = constrainedMemory;

  abort = abort;

  kill = kill;

  /**
   * Ask the process to end.
   *
   * The `exit` event fires here rather than in the runtime, and it fires
   * exactly once even if a listener calls `exit` again -- which is not
   * hypothetical, because the usual reason to listen is to flush something,
   * and flushing can fail and call `exit` with a different code.
   */
  exit = exit;

  getuid = getuid;
  getgid = getgid;
  geteuid = geteuid;
  getegid = getegid;
  getgroups = getgroups;
  setuid = setuid;
  setgid = setgid;
  seteuid = seteuid;
  setegid = setegid;
  setgroups = setgroups;
  initgroups = initgroups;

  emitWarning = emitWarningFor(this);

  /** Weakly-held resource cleanup at the process lifecycle boundaries. */
  readonly finalization = createProcessFinalization(this);

  /**
   * What is currently keeping the loop from exiting, by name.
   *
   * The loop's own answer, not any module's. A timer, a socket and a pending
   * DNS lookup all hold the process open, and only the thing driving the loop
   * knows about all three -- so asking each module and merging would be a list
   * that is wrong whenever a module forgets to register.
   */
  getActiveResourcesInfo = getActiveResourcesInfo;
  // Arrow initializers rather than bare aliases: a class field takes its name
  // from an *anonymous* function expression, and an alias of an already-built
  // function keeps that function's name, which for a host binding stand-in is
  // the empty string.
  _getActiveHandles = (): unknown[] => nts_process_active_handles();
  _getActiveRequests = (): unknown[] => nts_process_active_requests();

  /**
   * Divert uncaught exceptions to `fn` instead of ending the process.
   *
   * At most one at a time, and that is the whole reason this is a function
   * rather than a property. Two libraries each installing a handler and each
   * assuming it is the only one is a debugger silently losing every exception
   * to a test framework, or the reverse; refusing the second makes the
   * conflict visible where it happens.
   */
  setUncaughtExceptionCaptureCallback = setUncaughtExceptionCaptureCallback;
  hasUncaughtExceptionCaptureCallback = hasUncaughtExceptionCaptureCallback;

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
   * stack has unwound completely. The name is the native/bootstrap contract,
   * even though runtime replacement of the method is outside this profile.
   */
  _fatalException = fatalException;

  /**
   * **`unhandledRejection` is emitted inside the rejected promise's async scope.**
   *
   * node runs the handler with `executionAsyncId()` equal to the promise's id --
   * `async-hooks/test-unhandled-rejection-context` asserts exactly that and nothing about the id's
   * value. This profile emitted it in the root context, and the test passed anyway **because the
   * first async id this profile allocated collided with the root's**: both were 1, so
   * `executionAsyncId() === promiseAsyncIds[0]` held by coincidence rather than by behaviour.
   *
   * Reserving 1 for the root in `internal/async-hooks.ts` made the collision go away and turned
   * that coincidence into a failure -- `actual: 1, expected: 2` -- which is the second defect the
   * first one had been hiding. Both are fixed together, because fixing either alone either leaves
   * the uniqueness violation in place or leaves a test red.
   *
   * The stand-in calls this instead of `emit` so the scope is entered on the TypeScript side,
   * where the async-hooks bookkeeping lives.
   */
  [kEmitUnhandledRejection] = emitUnhandledRejection;

  /**
   * Replace this process image with another program.
   *
   * Not a spawn: nothing comes back, the pid stays the same, and everything
   * this process was holding is gone. That is the point -- a supervisor that
   * `execve`s its real payload keeps the pid its own supervisor is watching.
   */
  execve = execve;

  loadEnvFile = loadEnvFile;

  getBuiltinModule = getBuiltinModule;

  ref = ref;

  unref = unref;

  _debugEnd = _debugEnd;

  _startProfilerIdleNotifier = _startProfilerIdleNotifier;

  _stopProfilerIdleNotifier = _stopProfilerIdleNotifier;

  /** Write past every stream and every hook, for debugging the streams. */
  _rawDebug = _rawDebug;
}

/**
 * The five below are declared with the names node publishes them under.
 *
 * They were `processNextTick`, `processKill`, `processExit`, `processExecve`
 * and -- the one that is not merely a name -- `nts_process_active_resources`
 * itself. A field assigned the binding directly publishes *the binding* as the
 * public API: its identity is the stand-in's on the interpreted lane and the C
 * function's on the compiled one, and `process.getActiveResourcesInfo.name`
 * read `"resourcesAfterHarness"`, the name of a harness shim that subtracts the
 * runner's own pipes. The same aliasing once left `os.freemem.name` empty and
 * published 4 of `os`'s 23 names.
 *
 * `x = x` in a field initializer reads oddly and is correct: class-field
 * initializers do not bind the field name, so the right-hand side is the
 * hoisted module-scope declaration.
 *
 * Node ships nothing that reads any of these names, because on node they cannot
 * be wrong. `test/export-surface-static.js` compares every one against node's.
 */
function getActiveResourcesInfo(): string[] {
  return nts_process_active_resources();
}

function processNextTick<A extends unknown[]>(callback: (...args: A) => void, ...args: A): void {
  if (typeof callback !== "function") {
    throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
  }
  if (processExiting) return;
  // Through the shared implementation rather than the binding, because a
  // tick is an asynchronous resource: it reports itself to `async_hooks` and
  // it carries the current context to its callback. Calling the binding here
  // made `process.nextTick` and the internal one two different things, and
  // only one of them was a tick anybody could observe.
  nextTick(callback, ...args);
}

function kill(pid: number, signal?: string | number): true {
  // `!=` on purpose: node accepts a numeric string here, and the check is
  // "does this round-trip through a 32-bit integer", not "is this a number".
  if (pid != (pid | 0)) {
    throw new ERR_INVALID_ARG_TYPE("pid", "number", pid);
  }
  const err = rawKill(pid, signalNumber(signal));
  if (err) throw exceptionWithHostPort(err, "kill");
  return true;
}

function exit(code?: number | string | null): never {
  // `arguments.length`, not a rest parameter, and the distinction is arity rather
  // than behaviour: a rest parameter gives `exit.length === 0` where node's is 1.
  // Node uses a named parameter and `if (arguments.length !== 0)`, which keeps both
  // the arity and the difference between `exit()` and `exit(undefined)` -- the first
  // leaves `exitCode` alone and the second clears it.
  //
  // The same shape as `removeAllListeners` and `Readable`'s override of it: what a
  // caller passed and how many arguments they passed are two different questions,
  // and only `arguments` answers the second.
  if (arguments.length !== 0) process.exitCode = code;

  emitExitOnce(process, process.exitCode ?? 0);
  return reallyExit(process.exitCode ?? 0);
}

/** Deliver the terminal lifecycle event at most once. */
function emitExitOnce(target: Process, code: number): void {
  if (processExiting) return;
  processExiting = true;
  target.emit("exit", code);
}

function setUncaughtExceptionCaptureCallback(fn: ((error: unknown) => void) | null): void {
  if (fn === null) {
    captureCallback = null;
    return;
  }
  if (typeof fn !== "function") {
    throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "null"], fn);
  }
  if (captureCallback !== null) {
    throw new ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET();
  }
  captureCallback = fn;
}

function hasUncaughtExceptionCaptureCallback(): boolean {
  return captureCallback !== null;
}


/**
 * Emit `unhandledRejection` with the rejected promise as the current async resource.
 *
 * `getOrSetAsyncId` returns the id the promise was already tracked under, so a hook that saw the
 * promise's `init` sees the same id here. The scope is left in a `finally`: a listener that throws
 * must not leave the context stack holding a frame that belongs to the promise.
 */
function emitUnhandledRejection(reason: unknown, promise: object): boolean {
  const asyncId = getOrSetAsyncId(promise);
  emitBefore(asyncId, asyncId, promise, true);
  try {
    return process.emit("unhandledRejection", reason, promise);
  } finally {
    emitAfter(asyncId, true);
  }
}

// `fromPromise?:` rather than `= false`, for arity: node's `_fatalException` is
// `(er, fromPromise) => ...` with length 2, and a default initializer is excluded
// from `Function.length` so `= false` gave 1. An optional parameter erases to a
// plain one and keeps the 2, while `undefined` is falsy and behaves as `false` did.
function fatalException(error: unknown, fromPromise?: boolean): boolean {
  // If a monitor, capture callback, or uncaughtException listener throws, the
  // runtime must treat that as a failure of the fatal-error handler. It must
  // not feed the new error through the same user handlers a second time. Node
  // terminates that path with its internal-handler-failure code.
  if (handlingFatalException) throw error;
  handlingFatalException = true;

  const origin = fromPromise ? "unhandledRejection" : "uncaughtException";
  process.emit("uncaughtExceptionMonitor", error, origin);
  if (captureCallback !== null) {
    captureCallback(error);
    handlingFatalException = false;
    return true;
  }
  if (process.emit("uncaughtException", error, origin)) {
    handlingFatalException = false;
    return true;
  }

  // Native code performs the actual termination after a false return, but the
  // TypeScript half owns the observable state transition first. In particular,
  // a prior exitCode of 99 must not reach the exit listener for an uncaught
  // exception: Node reports and stores 1.
  try {
    if (!processExiting) {
      process.exitCode = 1;
      emitExitOnce(process, 1);
    }
  } catch {
    // There is no second recovery path while handling the process's final
    // uncaught exception. The native boundary will terminate after false.
  }
  handlingFatalException = false;
  return false;
}

function execve(
  execPath: string,
  args: readonly string[] = [],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): never {
  if (!execveWarningEmitted) {
    execveWarningEmitted = true;
    process.emitWarning(
      "process.execve is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
  }
  if (process.platform === "win32") {
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
    // A null byte would truncate the variable at the C boundary, so a name or
    // value containing one is refused rather than silently cut in half.
    if (typeof value !== "string" || key.includes("\u0000") || value.includes("\u0000")) {
      throw new ERR_INVALID_ARG_VALUE(
        "env",
        environment,
        "must be an object with string keys and values without null bytes",
      );
    }
    pairs[i] = `${key}=${value}`;
  }

  // Node publishes the array it is about to hand to the syscall, not a copy of
  // it, so a subscriber can still add to the environment the replacement image
  // will see. Published last, once the arguments have been validated: a call
  // that is going to throw never happened.
  if (execveChannel.hasSubscribers) {
    execveChannel.publish({ execPath, args, env: pairs });
  }

  return nts_process_execve(execPath, args, pairs);
}

/**
 * `process._debugEnd`, which stops the inspector.
 *
 * A no-op when nothing is attached, which is the only state this profile's tests
 * run in -- but routed to the real thing rather than stubbed, because "no inspector
 * is attached" is a fact about the run and not about the function.
 */
function _debugEnd(): void {
  nts_process_debug_end();
}

/**
 * `process._startProfilerIdleNotifier` and `process._stopProfilerIdleNotifier`.
 *
 * **Empty on purpose, because node's are empty.** Upstream they are literally
 * `process._startProfilerIdleNotifier = () => {}` in
 * `internal/bootstrap/switches/is_main_thread.js`, kept so that code written
 * against an older node does not break. A no-op here is the faithful
 * implementation rather than a stub standing in for missing work -- which is the
 * distinction that keeps `setSourceMapsEnabled` out of this file: that one does
 * something upstream, and a flag nothing reads would be a lie.
 *
 * Built by a factory, because node's `name` is `""` and matching that takes some
 * care: an arrow assigned to a member expression takes no name from it, while
 * `const f = () => {}` or a class field both *do* take theirs.
 * `export-surface-static.js` compares names, so an arrow returned from a call --
 * which is named by nothing -- is what makes them agree. `(0, () => {})` also works
 * in JavaScript and TypeScript rejects it: "left side of comma operator is unused
 * and has no side effects".
 */
const anonymousNoop = (): (() => void) => () => {};
const _startProfilerIdleNotifier = anonymousNoop();
const _stopProfilerIdleNotifier = anonymousNoop();

/**
 * `process.ref` and `process.unref`, which ask a thing to hold the loop open or to
 * stop holding it.
 *
 * Neither validates and neither throws: a nullish argument returns, and anything
 * else is asked for a `ref`/`unref` to call and ignored when it has none -- so
 * `process.ref("x")` is a no-op rather than an error. That is deliberate upstream,
 * because the point is to ref *whatever* a caller happens to be holding without
 * first proving it is refable.
 *
 * The symbol is consulted **before** the method, which is the part a plain
 * `value.ref?.()` would get wrong: an object can offer a private ref under
 * `Symbol.for("nodejs.ref")` while its public `ref` means something else entirely.
 *
 * No binding: this is pure JavaScript upstream too.
 */
function ref(maybeRefable: unknown): void {
  if (maybeRefable === null || maybeRefable === undefined) return;
  const holder = maybeRefable as Record<PropertyKey, unknown>;
  const fn = holder[Symbol.for("nodejs.ref")] ?? holder.ref;
  if (typeof fn === "function") (fn as (this: unknown) => void).call(maybeRefable);
}

function unref(maybeRefable: unknown): void {
  if (maybeRefable === null || maybeRefable === undefined) return;
  const holder = maybeRefable as Record<PropertyKey, unknown>;
  const fn = holder[Symbol.for("nodejs.unref")] ?? holder.unref;
  if (typeof fn === "function") (fn as (this: unknown) => void).call(maybeRefable);
}

/**
 * `process.getBuiltinModule`, node's way to reach a builtin without `require`.
 *
 * Node normalises the id first: a bare `fs` and a prefixed `node:fs` both resolve,
 * and an id that is not requirable answers `undefined` rather than throwing. Only
 * a non-string is an error, which is what makes it usable as a probe -- a caller
 * asks for a module it may not have and branches on `undefined`.
 *
 * Found absent by the differential: every call answered `TypeError` here because
 * the property did not exist, against `object` or `undefined` on node.
 */
function getBuiltinModule(id: string): unknown {
  validateString(id, "id");
  return nts_process_get_builtin_module(id);
}

function loadEnvFile(path: string | null | undefined = undefined): void {
  // `!= null`, which is node's test, so **both** `undefined` and `null` mean the
  // default `.env`. A default parameter of `".env"` only covers `undefined`, so
  // `loadEnvFile(null)` answered `ERR_INVALID_ARG_TYPE` here and `ENOENT` on node
  // -- node fell through to the default path and reported that it was not there.
  //
  // The difference matters for a forwarded argument: `loadEnvFile(options.path)`
  // with nothing in `path` loads the default upstream and threw here, which is the
  // same shape as `removeAllListeners(undefined)` one module over.
  //
  // The `= undefined` is load-bearing and is node's, with node's reason: it is
  // written that way "so that `loadEnvFile.length` returns 0". A parameter declared
  // `path?:` does **not** do it -- the `?` erases and leaves a plain parameter, so
  // arity was 1 against node's 0. Only a default initializer is excluded from
  // `Function.length`.
  //
  // Measured rather than reasoned: the first version of this comment claimed an
  // optional parameter gave the same 0, and the probe that compared the arity said
  // otherwise on the same run that confirmed the five behaviours.
  const resolved = path != null ? path : ".env";
  if (path != null) validateString(path, "path");
  const result = nts_process_load_env_file(resolved);
  if (result !== 0) throw uvException(result, "open", resolved);
  refreshEnvironment();
}

// Declared with the underscore because that is the name node's carries:
// `process._rawDebug.name` is `"_rawDebug"` there and was `"rawDebug"` here.
// The only reference is the field assignment above, so the name was the whole
// difference. Found by `test/export-surface-static.js`; node ships nothing that
// reads it, because on node it cannot be wrong.
function _rawDebug(...args: unknown[]): void {
  nts_process_raw_debug(format(...args));
}

let execveWarningEmitted = false;

/** One metadata table, parsed. */
function metadata(name: ProcessMetadataName): Record<string, unknown> {
  const value: unknown = JSON.parse(nts_process_metadata(name));
  return metadataObject(value, `process ${name}`);
}

function metadataObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${name} metadata`);
  }
  return Object.fromEntries(Object.entries(value));
}

function metadataString(source: Readonly<Record<string, unknown>>, name: string): string {
  const value = source[name];
  if (typeof value !== "string") throw new Error(`invalid process metadata field ${name}`);
  return value;
}

function metadataBoolean(source: Readonly<Record<string, unknown>>, name: string): boolean {
  const value = source[name];
  if (typeof value !== "boolean") throw new Error(`invalid process metadata field ${name}`);
  return value;
}

function metadataStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`invalid process metadata field ${name}`);
  const result = new Array<string>(value.length);
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item !== "string") throw new Error(`invalid process metadata field ${name}[${i}]`);
    result[i] = item;
  }
  return result;
}

function releaseMetadata(): ProcessRelease {
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

function featuresMetadata(): ProcessFeatures {
  const raw = metadata("features");
  const typeScript = raw["typescript"];
  if (typeScript !== "strip" && typeScript !== "transform" && typeScript !== false) {
    throw new Error("invalid process metadata field typescript");
  }
  return {
    inspector: metadataBoolean(raw, "inspector"),
    debug: metadataBoolean(raw, "debug"),
    uv: metadataBoolean(raw, "uv"),
    ipv6: metadataBoolean(raw, "ipv6"),
    openssl_is_boringssl: metadataBoolean(raw, "openssl_is_boringssl"),
    quic: metadataBoolean(raw, "quic"),
    tls_alpn: metadataBoolean(raw, "tls_alpn"),
    tls_sni: metadataBoolean(raw, "tls_sni"),
    tls_ocsp: metadataBoolean(raw, "tls_ocsp"),
    tls: metadataBoolean(raw, "tls"),
    cached_builtins: metadataBoolean(raw, "cached_builtins"),
    require_module: metadataBoolean(raw, "require_module"),
    typescript: typeScript,
  };
}

function configMetadata(): ProcessConfig {
  const raw = metadata("config");
  const variables = metadataObject(raw["variables"], "process config.variables");
  const targetDefaults = metadataObject(
    raw["target_defaults"],
    "process config.target_defaults",
  );
  return {
    ...raw,
    variables: {
      ...variables,
      napi_build_version: metadataString(variables, "napi_build_version"),
      node_builtin_shareable_builtins: metadataStringArray(
        variables["node_builtin_shareable_builtins"],
        "node_builtin_shareable_builtins",
      ),
      node_use_amaro: metadataBoolean(variables, "node_use_amaro"),
      node_shared_openssl: metadataBoolean(variables, "node_shared_openssl"),
    },
    target_defaults: {
      ...targetDefaults,
      cflags: metadataStringArray(targetDefaults["cflags"], "target_defaults.cflags"),
      default_configuration: metadataString(targetDefaults, "default_configuration"),
      defines: metadataStringArray(targetDefaults["defines"], "target_defaults.defines"),
      include_dirs: metadataStringArray(targetDefaults["include_dirs"], "target_defaults.include_dirs"),
      libraries: metadataStringArray(targetDefaults["libraries"], "target_defaults.libraries"),
    },
  };
}

function buildVersions(): ProcessVersions {
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
  return {
    ...versions,
    node: metadataString(versions, "node"),
    v8: metadataString(versions, "v8"),
    ares: metadataString(versions, "ares"),
    uv: metadataString(versions, "uv"),
    zlib: metadataString(versions, "zlib"),
    modules: metadataString(versions, "modules"),
    napi: metadataString(versions, "napi"),
    openssl: metadataString(versions, "openssl"),
  };
}

const process = new Process();

setProcessWarningHandler(process.emitWarning);
process.on("warning", onWarningFor(process));

export default process;
export { process, Process };
export {
  env,
  hrtimeBigInt as _hrtimeBigInt,
  memoryUsageRss as _memoryUsageRss,
};
