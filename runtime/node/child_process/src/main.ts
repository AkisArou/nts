// `node:child_process`, synchronous family.
//
// # What is here and what is deliberately absent
//
// `spawnSync`, `execSync` and `execFileSync`. The asynchronous family --
// `spawn`, `exec`, `execFile`, `fork` and the `ChildProcess` class -- needs a
// live object whose `stdout` and `stderr` are readable streams, with an `exit`
// event ordered against their `end`, and that is a separate piece of work.
//
// Nothing is stubbed. A `spawn` that existed and threw would make `'spawn' in cp`
// answer true and send a feature-detecting program down a branch that cannot
// work; `not-applicable` names the files that need it instead. `dns` records the
// same reasoning for its resolver half.
//
// # The three are one call
//
// Node builds `execSync` and `execFileSync` on `spawnSync`, and so does this. The
// differences are argument shaping -- `execSync` puts the command behind a shell,
// `execFileSync` does not -- and what happens afterwards: the `exec*` pair throw
// on a non-zero status and return stdout, while `spawnSync` returns a result
// object and never throws for the child's sake.

import {
  validateAbortSignal,
  validateString,
  validateObject,
  validateArray,
} from "../../internal/validators.ts";
import {
  AbortError,
  ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_CHILD_PROCESS_IPC_REQUIRED,
  ERR_INVALID_HANDLE_TYPE,
  ERR_IPC_CHANNEL_CLOSED,
  ERR_IPC_DISCONNECTED,
  ERR_IPC_ONE_PIPE,
  ERR_MISSING_ARGS,
  ERR_OUT_OF_RANGE,
  ERR_UNKNOWN_SIGNAL,
} from "../../internal/errors.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { clearTimeout, setTimeout } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/main.ts";
import { addTrackedAbortListener, EventEmitter } from "../../events/src/main.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { nextTick } from "../../internal/tick.ts";
import { errName, errnoException } from "../../internal/uv.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { fileURLToPath } from "../../url/src/fileurl.ts";
import type { URL } from "../../url/src/url.ts";
import { Readable } from "../../stream/src/readable.ts";
import { Writable } from "../../stream/src/writable.ts";

declare function nts_child_process_spawn_sync(
  file: string,
  args: string[],
  env: string[] | null,
  cwd: string,
  input: Uint8Array | null,
  timeout: number,
  maxBuffer: number,
  callback: (
    status: number,
    signal: number,
    stdout: Uint8Array,
    stderr: Uint8Array,
    error: number,
    pid: number,
  ) => void,
): void;

declare function nts_process_env(name: string): string;
declare function nts_process_exec_path(): string;

declare function nts_child_process_spawn(
  file: string,
  args: string[],
  env: string[] | null,
  cwd: string,
  stdioMode: number,
  detached: number,
  uid: number,
  gid: number,
  /**
   * The caller's `stdio` as it was written, or null when nothing was said.
   *
   * `stdioMode` is three slots of two bits, which is enough to decide *which streams
   * this module exposes* and not enough to describe what node accepts: `'ipc'` in an
   * arbitrary slot, a file descriptor, another child's stream. Those go through here
   * instead, and the host's own `spawn` resolves them.
   *
   * An array that may hold objects **has no representation in the compiled runtime**,
   * so that lane declines this binding. It passes 0 of 110 files in this module, so
   * the trade is nothing against nine.
   */
  stdioSpec: readonly unknown[] | null,
  serialization: string,
  onMessage: (message: unknown, sent?: unknown) => void,
  onDisconnect: () => void,
  onExit: (status: number, signal: number) => void,
  onError: (code: number) => void,
): number;
declare function nts_child_process_read_start(
  handle: number,
  which: number,
  onData: (bytes: Uint8Array) => void,
  onEnd: () => void,
): void;
declare function nts_child_process_write(
  handle: number,
  bytes: Uint8Array,
  callback: (status: number, unused: number) => void,
): number;
declare function nts_child_process_end_stdin(handle: number): void;
declare function nts_child_process_kill(handle: number, signal: number): number;
declare function nts_child_process_pid(handle: number): number;
declare function nts_child_process_close(handle: number): void;

/* The channel. `fork` is `spawn` plus a socketpair the child finds through
 * `NODE_CHANNEL_FD`, and node's default framing over it is newline-delimited
 * JSON -- `lib/internal/child_process/serialization.js` says so outright. The
 * binding carries whole lines; the framing and the parsing are here, because
 * they are the part a test can observe. */
declare function nts_child_process_fork(
  execPath: string,
  args: string[],
  env: string[] | null,
  cwd: string,
  silent: number,
  serialization: string,
  onExit: (status: number, signal: number) => void,
  onMessage: (message: unknown, sent?: unknown) => void,
  onDisconnect: () => void,
): number;
/**
 * `sent` is a socket or a server travelling to the child, and it crosses as itself.
 *
 * The host's `child.send(message, handle)` does the descriptor passing -- a sendmsg
 * with SCM_RIGHTS -- so the stand-in hands the object straight over rather than
 * reimplementing it. **This parameter has no representation in the compiled runtime**,
 * the same wall `tty`'s `isatty(fd: unknown)` hit: an object cannot be built at a
 * Node-API parameter. So the compiled lane declines this binding -- and it already
 * passes 0 of 110 files in this module, so nothing is traded for what the interpreted
 * lane gains.
 */
declare function nts_child_process_send(
  handle: number,
  message: unknown,
  sent?: unknown,
  options?: unknown,
  callback?: unknown,
): number;
declare function nts_child_process_disconnect(handle: number): void;

/** Node's signal names, in the direction the binding needs them. */
// Every signal `os.constants.signals` names on this platform, in its order --
// the order decides the reverse lookup, because SIGABRT/SIGIOT share 6 and
// SIGIO/SIGPOLL share 29, and node reports the first of each pair.
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6,
  SIGIOT: 6, SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11,
  SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGCHLD: 17,
  SIGSTKFLT: 16, SIGCONT: 18, SIGSTOP: 19, SIGTSTP: 20, SIGTTIN: 21,
  SIGTTOU: 22, SIGURG: 23, SIGXCPU: 24, SIGXFSZ: 25, SIGVTALRM: 26,
  SIGPROF: 27, SIGWINCH: 28, SIGIO: 29, SIGPOLL: 29, SIGPWR: 30, SIGSYS: 31,
};

/**
 * A child's stdout or stderr.
 *
 * `net.Socket` is a `Duplex` over a TCP handle and cannot adopt a pipe, so this
 * is its own `Readable` over the binding's read callbacks rather than a reuse of
 * it. `_read` is a no-op because the binding pushes: libuv decides when bytes
 * arrive and there is nothing to pull.
 */
class ChildReadable extends Readable {
  /**
   * Which child and which slot this stream is, so a *later* `spawn` can be handed it
   * as a stdio entry.
   *
   * `stdio: [cat.stdout, 'pipe', 'pipe']` asks for one child's output to be another's
   * input, and node resolves that by taking the stream's descriptor. Ours has no
   * descriptor to give -- the binding owns the pipe -- so the pair travels instead and
   * the stand-in looks up the host stream behind it. Three tests ask for exactly this.
   */
  readonly ntsChildHandle: number;
  readonly ntsChildSlot: number;

  constructor(handle: number, which: number, onEof: () => void) {
    super();
    this.ntsChildHandle = handle;
    this.ntsChildSlot = which;
    nts_child_process_read_start(
      handle,
      which,
      (bytes: Uint8Array): void => {
        this.push(Buffer.from(bytes));
      },
      (): void => {
        this.push(null);
        // A `Readable` nobody reads never reaches `end` on its own -- node's plain
        // `Readable` does not either, measured both ways. Node's child stdio is a
        // socket that reads eagerly, and `read(0)` is what kicks the end
        // machinery; it fires `end` only once the buffer is drained, so a killed
        // `cat` whose stdout has an `end` listener and no `data` listener still
        // ends, and buffered bytes are not dropped.
        this.read(0);
        // The **binding's** EOF, not the stream's `end` event.
        //
        // A `Readable` does not emit `end` until something has read it to
        // completion, so a child whose output nobody consumes would never
        // report its stdio closed and `close` would never fire. Node tracks the
        // underlying handle rather than the JavaScript stream, and so does this.
        // Attaching to `end` instead cost every `exec` test its callback.
        onEof();
      },
    );
  }

  override _read(): void {}
}

/** A child's stdin. */
class ChildWritable extends Writable {
  /** As `ChildReadable`: slot 0, so another child can be given this as its input. */
  readonly ntsChildHandle: number;
  readonly ntsChildSlot = 0;

  #handle: number;

  /**
   * Node's child stdin is a `net.Socket`, which is a Duplex, so it answers
   * `readable` as well as `writable` -- `false`, because the pipe only goes one
   * way. A plain `Writable` has no such property and answered `undefined`, which
   * is what test-child-process-stdin compares against `false`.
   */
  get readable(): boolean {
    return false;
  }

  constructor(handle: number) {
    super();
    this.ntsChildHandle = handle;
    this.#handle = handle;
  }

  override _write(
    chunk: Uint8Array,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    const status = nts_child_process_write(this.#handle, chunk, (): void => {
      callback(null);
    });
    if (status < 0) callback(new Error(`write failed: ${status}`));
  }

  override _final(callback: (error?: Error | null) => void): void {
    nts_child_process_end_stdin(this.#handle);
    callback(null);
  }
}

export interface SpawnSyncOptions {
  cwd?: string | URL | undefined;
  input?: string | Uint8Array | undefined;
  argv0?: string | undefined;
  env?: Record<string, string> | undefined;
  timeout?: number | undefined;
  maxBuffer?: number | undefined;
  encoding?: string | undefined;
  shell?: boolean | string | undefined;
  killSignal?: string | number | undefined;
  signal?: AbortSignalLike | undefined;
  serialization?: string | undefined;
  uid?: number | undefined;
  gid?: number | undefined;
  windowsHide?: boolean | undefined;
}

export interface SpawnSyncResult {
  pid: number;
  output: (Buffer | string | null)[];
  stdout: Buffer | string | null;
  stderr: Buffer | string | null;
  status: number | null;
  signal: string | null;
  error?: Error | undefined;
}

const MAX_BUFFER = 1024 * 1024;

/**
 * Node rejects a null byte in anything that becomes part of an `execve`
 * argument, because a C string ends at the first one and the kernel would see a
 * silently truncated command. `test-child-process-reject-null-bytes.js` asserts
 * it **51 times** across `exec`, `execSync`, `execFile`, `execFileSync`, `fork`,
 * `spawn` and `spawnSync`, on the file, the arguments, the cwd and the
 * environment -- one rule, and every entry point has to carry it.
 */
/**
 * The file argument, checked the way node checks it.
 *
 * Shared between `spawn` and `spawnSync` because they had drifted: `spawnSync`
 * rejected an empty string and `spawn` did not, so `spawn('')` returned a child
 * for a command with no name instead of throwing `ERR_INVALID_ARG_VALUE`.
 * `test-child-process-spawn-typeerror.js` asserts both across 28 cases.
 */
function validateFile(file: string): void {
  validateString(file, "file");
  if (file.length === 0) {
    throw new ERR_INVALID_ARG_VALUE("file", file, "cannot be empty");
  }
}

function rejectNullBytes(value: unknown, name: string): void {
  if (typeof value === "string" && value.includes("\u0000")) {
    throw new ERR_INVALID_ARG_VALUE(name, value, "must be a string without null bytes");
  }
}

/**
 * `uid` and `gid`, which node requires to be int32 if present.
 *
 * `{ uid: 2 ** 63 }` throws `ERR_INVALID_ARG_TYPE` rather than being clamped or
 * truncated, because a uid that does not fit is a different user than the caller
 * asked for and silently picking one is worse than refusing.
 */
function validateCredentials(options: SpawnSyncOptions & Record<string, unknown>): void {
  for (const name of ["uid", "gid"] as const) {
    const value = options[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isInteger(value)
      || value < -2147483648 || value > 2147483647) {
      throw new ERR_INVALID_ARG_TYPE(`options.${name}`, "int32", value);
    }
  }
}

/**
 * Every option node type-checks before it spawns anything.
 *
 * `test-child-process-spawnsync-validation-errors.js` walks ten of them with 63
 * type assertions and 21 range assertions, and its `pass` helper is as load
 * bearing as its `fail`: `spawnSync('not_a_real_command', { detached: true })`
 * must reach the spawn and come back `ENOENT`, so a check that is too eager
 * fails the test as surely as one that is absent.
 *
 * `undefined` and `null` are always accepted -- node treats both as absent.
 */
/**
 * node's `convertToValidSignal`. Three details are each an assertion in
 * test-child-process-spawnsync-validation-errors: a **number** is a signal only
 * if the table names it, so 0, -200, 3.14 and 500 are all unknown rather than
 * accepted; a name is upper-cased, so `"sigterm"` is valid; and the lookup reads
 * own keys only, because the test walks `Object.getOwnPropertyNames(Object
 * .prototype)` and an indexed read of `"toString"` on an object literal would
 * find the inherited function and take it for a signal.
 */
function validSignal(signal: string | number): number {
  const wanted = typeof signal === "string" ? signal.toUpperCase() : signal;
  for (const name of Object.keys(SIGNAL_NUMBERS)) {
    const value = SIGNAL_NUMBERS[name]!;
    if (name === wanted || value === wanted) return value;
  }
  throw new ERR_UNKNOWN_SIGNAL(`${signal}`);
}

function validateSpawnOptions(options: SpawnSyncOptions & Record<string, unknown>): void {
  const booleans = ["detached", "windowsHide", "windowsVerbatimArguments"] as const;
  for (const name of booleans) {
    const value = options[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "boolean") {
      throw new ERR_INVALID_ARG_TYPE(`options.${name}`, "boolean", value);
    }
  }

  const cwd = options["cwd"];
  // Structural, not `instanceof`: the test's `new URL(...)` is the **host's** on
  // the interpreted lane, so an `instanceof` against the class this module imports
  // answers false and the URL case is unreachable. `href` is the one member every
  // realm's URL agrees on.
  const cwdIsUrl = typeof cwd === "object" && cwd !== null
    && typeof (cwd as { href?: unknown }).href === "string";
  if (cwd !== undefined && cwd !== null && typeof cwd !== "string" && !cwdIsUrl) {
    throw new ERR_INVALID_ARG_TYPE("options.cwd", "string", cwd);
  }

  const shell = options["shell"];
  if (shell !== undefined && shell !== null
    && typeof shell !== "boolean" && typeof shell !== "string") {
    throw new ERR_INVALID_ARG_TYPE("options.shell", ["boolean", "string"], shell);
  }

  // Both are range errors even for a string or a boolean, and the two differ in
  // what they accept: `timeout` must be a whole number, `maxBuffer` may be
  // Infinity or a fraction. This is node's validateTimeout/validateMaxBuffer.
  const timeout = options["timeout"];
  if (timeout !== undefined && timeout !== null
    && !(typeof timeout === "number" && Number.isInteger(timeout) && timeout >= 0)) {
    throw new ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
  const maxBuffer = options["maxBuffer"];
  if (maxBuffer !== undefined && maxBuffer !== null
    && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }

  const killSignal = options["killSignal"];
  if (killSignal !== undefined && killSignal !== null) {
    if (typeof killSignal === "string" || typeof killSignal === "number") {
      validSignal(killSignal);
    } else {
      throw new ERR_INVALID_ARG_TYPE("options.killSignal", ["string", "number"], killSignal);
    }
  }
}

function checkNoNullBytes(
  file: string,
  args: readonly string[],
  options: SpawnSyncOptions,
): void {
  validateCredentials(options as SpawnSyncOptions & Record<string, unknown>);
  validateSpawnOptions(options as SpawnSyncOptions & Record<string, unknown>);
  rejectNullBytes(file, "file");
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument !== undefined) rejectNullBytes(argument, `args[${index}]`);
  }
  if (options.cwd !== undefined) rejectNullBytes(options.cwd, "options.cwd");
  if (options.argv0 !== undefined) rejectNullBytes(options.argv0, "options.argv0");
  const env = options.env;
  if (env !== undefined && env !== null) {
    for (const key of Object.keys(env)) {
      rejectNullBytes(key, "options.env");
      rejectNullBytes(env[key], `options.env[${JSON.stringify(key)}]`);
    }
  }
  if (typeof options.shell === "string") rejectNullBytes(options.shell, "options.shell");
}


// Node names the signal in the result; libuv reports the number. Only the
// signals a child is plausibly killed by are here, because a number with no name
// is better than a wrong name -- `signal` stays null and `status` still says the
// child was signalled.
const SIGNAL_NAMES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  4: "SIGILL",
  6: "SIGABRT",
  8: "SIGFPE",
  9: "SIGKILL",
  11: "SIGSEGV",
  13: "SIGPIPE",
  14: "SIGALRM",
  15: "SIGTERM",
};

/** The inherited environment, flattened the way `execve` wants it. */
function inheritedEnv(): string[] | null {
  return null;
}

/**
 * Every enumerable key of `env`, including inherited ones.
 *
 * node's comment above its own loop says it outright -- "Prototype values are
 * intentionally included" -- and it uses `for (const key in env)`. `Object.keys`
 * sees own keys only, and test-child-process-env puts `FOO` on a prototype with
 * `Object.setPrototypeOf` and then asserts the child received `FOO=BAR`. The chain
 * is walked here rather than with `for...in` because no module in this profile uses
 * that form, and a shadowed key is yielded once, by the nearest holder, which is
 * what `for...in` does.
 */
function envKeys(env: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let cursor: Record<string, unknown> | null = env;
  while (cursor !== null && cursor !== (Object.prototype as unknown as Record<string, unknown>)) {
    for (const key of Object.keys(cursor)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    cursor = Object.getPrototypeOf(cursor) as Record<string, unknown> | null;
  }
  return keys;
}

function flattenEnv(env: Record<string, string> | undefined): string[] | null {
  if (env === undefined) return inheritedEnv();
  const source = env as Record<string, unknown>;
  const flat: string[] = [];
  for (const key of envKeys(source)) {
    const value = source[key];
    // Node drops a key whose value is undefined rather than passing "undefined".
    if (value === undefined) continue;
    flat.push(`${key}=${value}`);
  }
  return flat;
}

/**
 * node's DEP0190, emitted once per process.
 *
 * Passing `args` *and* `shell: true` concatenates them into the command line
 * without escaping, which is node's stated reason for deprecating it. The flag is
 * module-scope because node's is (`emittedDEP0190Already`), and the warning is about
 * what the caller asked for rather than about our shaping.
 * test-child-process-execfile waits for it with `common.expectWarning`.
 */
let emittedDep0190 = false;

function warnArgsWithShell(argCount: number): void {
  if (argCount === 0 || emittedDep0190) return;
  emittedDep0190 = true;
  emitWarning(
    "Passing args to a child process with shell option true can lead to security "
      + "vulnerabilities, as the arguments are not escaped, only concatenated.",
    "DeprecationWarning",
    "DEP0190",
  );
}

/** `shell: true` means `/bin/sh -c <command>`; a string names the shell. */
function shellCommand(command: string, shell: boolean | string): [string, string[]] {
  const file = typeof shell === "string" && shell !== "" ? shell : "/bin/sh";
  return [file, [file, "-c", command]];
}

/**
 * node's rule, from `execFile`: an encoding of `"buffer"` -- or any name
 * `Buffer.isEncoding` rejects -- yields the bytes, and anything else decodes.
 * An unrecognised name is *not* an error there, so this cannot hand it to
 * `toString`, which throws.
 */
function decode(bytes: Uint8Array, encoding: string | undefined): Buffer | string {
  const buffer = Buffer.from(bytes);
  if (encoding === undefined || encoding === "buffer") return buffer;
  if (!Buffer.isEncoding(encoding)) return buffer;
  return buffer.toString(encoding);
}

/**
 * The caller's options, copied, with no prototype.
 *
 * node writes `{ __proto__: null, ...options }` at every entry point and the reason
 * is test-child-process-prototype-tampering: with `Object.prototype.cwd = '/tmp'`
 * set, reading `options.cwd` off an object the caller passed as `{}` finds `/tmp`,
 * and the child runs somewhere the caller never asked for. Copying own enumerable
 * keys onto a null prototype is what stops an inherited option being read as one.
 *
 * `env` is copied by reference, so *its* prototype chain survives -- node includes
 * inherited keys there deliberately, and `envKeys` depends on that. The two are not
 * in tension: an inherited **option** is not the caller's, an inherited **env** key
 * is.
 */
function ownOptions<T extends object>(options: T): T {
  const source = options as Record<string, unknown>;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) copy[key] = source[key];
  return copy as T;
}

function normaliseArgs(
  file: string,
  args: readonly string[] | SpawnSyncOptions | undefined,
  options: SpawnSyncOptions | undefined,
): { args: string[]; options: SpawnSyncOptions } {
  let list: string[] = [];
  let opts: SpawnSyncOptions = ownOptions({}) as SpawnSyncOptions;
  if (Array.isArray(args)) {
    // Captured before the assertion, which is why this reads oddly.
    // `Array.isArray` narrows to `readonly string[]`; `validateArray` asserts
    // `unknown[]` and therefore *widens* it back, so slicing the asserted
    // binding gives `unknown[]` and TS2322. The interpreted lane never saw it,
    // because it does not typecheck.
    const given: readonly string[] = args;
    validateArray(args, "args");
    list = given.slice();
    if (options !== undefined) {
      validateObject(options, "options");
      opts = ownOptions(options);
    }
  } else if (args === undefined || args === null) {
    // node treats `args == null` as "no arguments" and leaves the options in the
    // third position. Dropping them here ran `spawnSync(cmd, undefined, { cwd })`
    // in the wrong directory, and test-child-process-spawnsync-args walks
    // `undefined`, `null` and `[]` and requires all three to report the same cwd.
    if (options !== undefined) {
      validateObject(options, "options");
      opts = ownOptions(options);
    }
  } else {
    validateObject(args, "options");
    opts = ownOptions(args as SpawnSyncOptions);
  }
  void file;
  return { args: list, options: opts };
}

export function spawnSync(
  file: string,
  args?: readonly string[] | SpawnSyncOptions,
  options?: SpawnSyncOptions,
): SpawnSyncResult {
  validateFile(file);
  const normalised = normaliseArgs(file, args, options);
  const opts = normalised.options;
  checkNoNullBytes(file, normalised.args, opts);

  const maxBuffer = opts.maxBuffer ?? MAX_BUFFER;
  if (typeof maxBuffer !== "number" || Number.isNaN(maxBuffer)) {
    throw new ERR_INVALID_ARG_TYPE("options.maxBuffer", "number", maxBuffer);
  }
  if (maxBuffer < 0) {
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", ">= 0", maxBuffer);
  }
  const timeout = opts.timeout ?? 0;
  if (typeof timeout !== "number" || Number.isNaN(timeout) || timeout < 0) {
    throw new ERR_OUT_OF_RANGE("options.timeout", ">= 0", timeout);
  }

  let command = file;
  let argv: string[];
  if (opts.shell !== undefined && opts.shell !== null && opts.shell !== false && opts.shell !== "") {
    warnArgsWithShell(normalised.args.length);
    const joined = [file, ...normalised.args].join(" ");
    const pair = shellCommand(joined, opts.shell);
    command = pair[0];
    argv = pair[1];
  } else {
    // argv[0] is the program's own name, which `argv0` overrides without
    // changing which file is executed. That distinction is the whole point of
    // the option and is why the two are passed separately.
    argv = [opts.argv0 === undefined ? file : opts.argv0, ...normalised.args];
  }

  let input: Uint8Array | null = null;
  if (opts.input !== undefined && opts.input !== null) {
    const given = opts.input as unknown;
    if (typeof given === "string") {
      input = Buffer.from(given);
    } else {
      // A typed array is not its bytes. `Buffer.from(new Int16Array(44))` reads it
      // as 44 *numbers* and truncates each to one byte, so an 88-byte payload
      // arrived as 44 -- exactly half, which is what
      // test-child-process-spawnsync-input showed. node takes the bytes:
      // `Buffer.from(view.buffer, view.byteOffset, view.byteLength)`. A DataView has
      // the same three members and no element type at all, which is why that test
      // walks every view `common.getArrayBufferViews` produces.
      const view = given as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
      const buffer = view.buffer;
      const byteLength = view.byteLength;
      input = buffer !== undefined && byteLength !== undefined
        ? new Uint8Array(buffer, view.byteOffset ?? 0, byteLength)
        : (given as Uint8Array);
    }
  }

  let status: number | null = null;
  let signalName: string | null = null;
  let stdoutValue: Buffer | string | null = null;
  let stderrValue: Buffer | string | null = null;
  let failureCode = 0;
  let pid = 0;

  nts_child_process_spawn_sync(
    command,
    argv,
    flattenEnv(opts.env),
    cwdPath(opts.cwd),
    input,
    timeout,
    maxBuffer,
    (
      childStatus: number,
      childSignal: number,
      out: Uint8Array,
      err: Uint8Array,
      error: number,
      childPid: number,
    ): void => {
      pid = childPid;
      failureCode = error;
      if (childSignal !== 0) {
        status = null;
        const named = SIGNAL_NAMES[childSignal];
        signalName = named === undefined ? null : named;
      } else {
        status = childStatus;
      }
      stdoutValue = decode(out, opts.encoding);
      stderrValue = decode(err, opts.encoding);
    },
  );

  const result: SpawnSyncResult = {
    pid,
    output: [null, stdoutValue, stderrValue],
    stdout: stdoutValue,
    stderr: stderrValue,
    status,
    signal: signalName,
  };
  if (failureCode !== 0) {
    // Node's shape: `errno` is libuv's **negative number** and `code` is its
    // name. This carried the name in both, so `util.getSystemErrorName(errno)`
    // -- which five of node's own `spawnSync` tests call -- threw
    // `The "err" argument must be of type number. Received type string`.
    const name = errName(failureCode);
    const error: Error & {
      errno?: number;
      code?: string;
      syscall?: string;
      path?: string;
      spawnargs?: string[];
    } = new Error(`spawnSync ${file} ${name}`);
    error.errno = failureCode;
    error.code = name;
    error.syscall = `spawnSync ${file}`;
    error.path = file;
    // Node carries the arguments **without** argv[0] on the error, and
    // `test-child-process-spawnsync.js` asserts it by deep equality.
    error.spawnargs = normalised.args.slice();
    result.error = error;
    result.status = null;
  }
  return result;
}

/** The `exec*` pair's shared tail: throw on failure, hand back stdout. */
function checked(result: SpawnSyncResult, command: string): Buffer | string {
  if (result.error !== undefined) {
    // Node attaches the captured output to the error it throws, in **every**
    // failing case and not only a non-zero exit. `maxBuffer` is the one that
    // shows it: the error is the only place the bytes read before the limit can
    // be seen, and three of node's own tests assert `e.stdout` by deep equality
    // against what the child had written. Throwing the bare error lost them.
    const failure = result.error as Error & {
      status?: number | null;
      signal?: string | null;
      output?: (Buffer | string | null)[];
      stdout?: Buffer | string | null;
      stderr?: Buffer | string | null;
      pid?: number;
    };
    failure.status = result.status;
    failure.signal = result.signal;
    failure.output = result.output;
    failure.stdout = result.stdout;
    failure.stderr = result.stderr;
    failure.pid = result.pid;
    throw failure;
  }
  if (result.status !== 0 || result.signal !== null) {
    const error: Error & {
      status?: number | null;
      signal?: string | null;
      output?: (Buffer | string | null)[];
      stdout?: Buffer | string | null;
      stderr?: Buffer | string | null;
      pid?: number;
    } = new Error(`Command failed: ${command}\n${String(result.stderr ?? "")}`);
    error.status = result.status;
    error.signal = result.signal;
    error.output = result.output;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.pid = result.pid;
    throw error;
  }
  return result.stdout ?? Buffer.alloc(0);
}

export function execFileSync(
  file: string,
  args?: readonly string[] | SpawnSyncOptions,
  options?: SpawnSyncOptions,
): Buffer | string {
  const result = spawnSync(file, args, options);
  return checked(result, file);
}

export function execSync(
  command: string,
  options?: SpawnSyncOptions,
): Buffer | string {
  validateString(command, "command");
  const opts: SpawnSyncOptions = options === undefined ? {} : options;
  const shell = typeof opts.shell === "string" ? opts.shell : true;
  const result = spawnSync(command, [], ownOptions({ ...opts, shell }));
  return checked(result, command);
}

void nts_process_env;


// ------------------------------------------------------------ asynchronous

export interface SpawnOptions extends SpawnSyncOptions {
  detached?: boolean | undefined;
  stdio?: string | readonly string[] | undefined;
}

/**
 * The IPC channel's half of a ChildProcess: `connected`, `send` and `disconnect`.
 *
 * Extracted from `fork` so `spawn` can have it too -- a child spawned with an `'ipc'`
 * slot has a channel, and before this it had one the caller could not reach.
 */
function attachChannel(child: ChildProcess, channel: number): void {
  child.connected = true;
  child.send = (
    message: unknown,
    handleArg?: unknown,
    optionsArg?: unknown,
    callbackArg?: unknown,
  ): boolean => {
    // node's argument shuffle, and its order decides which error a caller gets.
    // `send` takes (message, handle?, options?, callback?) and any of the last three
    // may be the callback, so node walks them in that order before validating
    // anything. test-child-process-send-type-error drives nine spellings through this
    // and they land on three different clauses.
    let handle = handleArg;
    let options = optionsArg;
    if (typeof handleArg === "function") {
      handle = undefined;
      options = undefined;
    } else if (typeof optionsArg === "function") {
      options = undefined;
    } else if (options !== undefined) {
      validateObject(options, "options");
    }
    const callback = typeof handleArg === "function" ? handleArg
      : typeof optionsArg === "function" ? optionsArg
      : typeof callbackArg === "function" ? callbackArg
      : undefined;
    // After the shuffle: `send(callback)` is only a message of undefined once the
    // callback has been taken out of the way.
    if (message === undefined) throw new ERR_MISSING_ARGS("message");
    // What can cross the channel: node serialises a string, an object, a number or a
    // boolean and rejects the rest by name. A Symbol is the case test-child-process-fork
    // asserts, and `JSON.stringify` would have turned it into `undefined` -- the bug
    // the comment above that assertion in node's own test still points at.
    if (typeof message !== "string" && typeof message !== "object"
      && typeof message !== "number" && typeof message !== "boolean") {
      throw new ERR_INVALID_ARG_TYPE(
        "message", ["string", "object", "number", "boolean"], message,
      );
    }
    // A sendable handle is an object -- a socket or a server. Anything else truthy is
    // not one, and node says so rather than serialising it: `send('msg', 'meow')` is
    // ERR_INVALID_HANDLE_TYPE, which test-child-process-send-type-error asserts.
    const sending = handle !== undefined && handle !== null;
    if (sending && typeof handle !== "object") throw new ERR_INVALID_HANDLE_TYPE();
    // Once the channel is gone node reports it rather than returning false in
    // silence: the callback gets the error if there is one, and it is emitted as an
    // `error` if there is not. test-child-process-send-after-close reads
    // 'Channel closed'.
    if (!child.connected) {
      const closed = new ERR_IPC_CHANNEL_CLOSED();
      if (callback !== undefined) {
        nextTick((): void => { (callback as (error: unknown) => void)(closed); });
      } else {
        nextTick((): void => { child.emit("error", closed); });
      }
      return false;
    }
    // `options` and the callback both reach the host, for the same reason `sent` does:
    // node owns the channel's queue and only it knows when a message has gone.
    //
    // Synthesising the callback here instead was wrong in a way worth keeping written
    // down. `send` returns false for **backpressure**, not failure -- node still
    // delivers the message and still calls back with null once the queue drains -- so
    // calling back with ERR_IPC_CHANNEL_CLOSED whenever the return was false turned
    // every backed-up send into an error. test-child-process-send-returns-boolean
    // drives `send` until it returns false on purpose and then waits for that exact
    // callback; it got an AssertionError from `mustSucceed` instead.
    //
    // The backlog itself needed nothing: measured against node, rv1..rv4 read
    // [true, true, false, false] on both, because forwarding to the host's `send`
    // forwards the host's queue.
    const written = nts_child_process_send(
      channel, message, sending ? handle : undefined, options, callback,
    ) === 0;
    return written;
  };
  child.disconnect = (): void => {
    // node emits an **error** for a second disconnect rather than a second
    // `disconnect` event, and that is the difference test-child-process-disconnect
    // counts: it reads one and this emitted two.
    if (!child.connected) {
      child.emit("error", new ERR_IPC_DISCONNECTED());
      return;
    }
    child.connected = false;
    nts_child_process_disconnect(channel);
    child.emit("disconnect");
  };
}

/**
 * `'json'` unless the caller asked for `'advanced'`.
 *
 * The host channel does the serialising, so this only has to name which. `validateSerialization`
 * has already refused anything else by the time this runs.
 */
function serializationOf(opts: { serialization?: unknown }): string {
  return opts.serialization === "advanced" ? "advanced" : "json";
}

/**
 * The caller's `stdio` for the binding, or null when they said nothing.
 *
 * A string becomes three of itself, the way node's `stdioStringToArray` expands it. An
 * array passes through untouched: `stdioMode` below reduces it to what *this module* can
 * expose, and this keeps what the host can act on -- `'ipc'` in any slot, a descriptor,
 * another child's stream.
 */
function stdioSpecOf(
  stdio: string | readonly string[] | undefined,
): readonly unknown[] | null {
  if (stdio === undefined) return null;
  if (typeof stdio === "string") return [stdio, stdio, stdio];
  return stdio;
}

/** `'pipe'` is 0, `'inherit'` 1, `'ignore'` 2 -- what every other spelling reduces to. */
/**
 * `serialization` is one of three things or it is an error.
 *
 * node validates it in `ChildProcess.prototype.spawn`, which `spawn` and `fork` reach
 * and `spawnSync` does not -- so this is called from those two and not from the sync
 * path, which would be stricter than node rather than closer to it. The message is
 * node's, and `advanced` is not implemented here: accepting the name and then using
 * JSON would be the wrong half of this to get right, so that remains a separate gap
 * rather than a silent substitution.
 */
function validateSerialization(value: unknown): void {
  if (value === undefined || value === "json" || value === "advanced") return;
  throw new ERR_INVALID_ARG_VALUE(
    "options.serialization", value, "must be one of: undefined, 'json', 'advanced'",
  );
}

/** A `cwd` as the binding wants it: a path, or "" for absent. */
function cwdPath(cwd: string | URL | undefined): string {
  if (cwd === undefined || cwd === null) return "";
  if (typeof cwd === "string") return cwd;
  // Through the string form, because `fileURLToPath` decides on `instanceof` too
  // and a host URL is not an instance of ours. Parsing the href is also what puts
  // `http://example.com/` on the ERR_INVALID_URL_SCHEME path that
  // test-child-process-cwd matches on, rather than ERR_INVALID_ARG_TYPE.
  return fileURLToPath(`${(cwd as { href: string }).href}`);
}

function stdioFlag(value: string | undefined): number {
  if (value === "inherit") return 1;
  if (value === "ignore") return 2;
  return 0;
}

function stdioMode(stdio: string | readonly string[] | undefined): number {
  if (stdio === undefined) return 0;
  if (typeof stdio === "string") {
    const flag = stdioFlag(stdio);
    return flag | (flag << 2) | (flag << 4);
  }
  // A second `'ipc'` is an error rather than an extra channel, and node raises it
  // from `spawn` synchronously. `'ipc'` was not read here at all -- it fell through
  // `stdioFlag` to 0, so `['pipe','pipe','pipe','ipc','ipc']` quietly asked for two
  // channels and got none.
  let ipcSeen = 0;
  for (const entry of stdio) {
    if (entry === "ipc") ipcSeen++;
  }
  if (ipcSeen > 1) throw new ERR_IPC_ONE_PIPE();
  const first = stdio.length > 0 ? stdio[0] : undefined;
  const second = stdio.length > 1 ? stdio[1] : undefined;
  const third = stdio.length > 2 ? stdio[2] : undefined;
  return stdioFlag(typeof first === "string" ? first : undefined)
    | (stdioFlag(typeof second === "string" ? second : undefined) << 2)
    | (stdioFlag(typeof third === "string" ? third : undefined) << 4);
}

/**
 * Node's `ChildProcess`.
 *
 * `exit` and `close` are two events and the order matters: `exit` fires when the
 * process is reaped, `close` when its stdio have also ended, and a caller may
 * read buffered output between them. The binding keeps the handle alive across
 * both, which is why `nts_child_process_close` is separate from the exit
 * callback.
 */
export class ChildProcess extends EventEmitter {
  #handle: number;
  #exited = false;
  #stdioOpen: number;

  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  stdin: ChildWritable | null = null;
  /**
   * What node calls the child by.
   *
   * `spawnargs` is the whole argv including argv[0], which is why
   * test-child-process-spawn-shell reads its *last* element to find the command it
   * handed to the shell. The error path slices argv[0] off, the way node's
   * `ChildProcess.prototype.spawn` does when it builds `err.spawnargs`.
   */
  spawnfile = "";
  spawnargs: string[] = [];
  stdout: ChildReadable | null = null;
  stderr: ChildReadable | null = null;
  readonly stdio: (ChildWritable | ChildReadable | null)[] = [];

  constructor(handle: number, mode: number) {
    super();
    this.#handle = handle;
    this.pid = nts_child_process_pid(handle);
    const wantsIn = (mode & 3) === 0;
    const wantsOut = ((mode >> 2) & 3) === 0;
    const wantsErr = ((mode >> 4) & 3) === 0;
    this.#stdioOpen = (wantsOut ? 1 : 0) + (wantsErr ? 1 : 0);

    if (wantsIn) this.stdin = new ChildWritable(handle);
    if (wantsOut) this.stdout = new ChildReadable(handle, 1, (): void => this.#stdioEnded());
    if (wantsErr) this.stderr = new ChildReadable(handle, 2, (): void => this.#stdioEnded());
    this.stdio.push(this.stdin, this.stdout, this.stderr);
  }

  #stdioEnded(): void {
    this.#stdioOpen -= 1;
    this.#maybeClose();
  }

  #maybeClose(): void {
    if (!this.#exited || this.#stdioOpen > 0) return;
    nts_child_process_close(this.#handle);
    this.emit("close", this.exitCode, this.signalCode);
  }

  /** Called by `spawn` when the binding reports the child reaped. */
  _handleExit(status: number, signal: number): void {
    this.#exited = true;
    if (signal !== 0) {
      this.exitCode = null;
      this.signalCode = signalName(signal);
    } else {
      this.exitCode = status;
      this.signalCode = null;
    }
    // The channel closes when the child goes, from either side. node emits
    // `disconnect` for that; this only emitted it when the *parent* called
    // `disconnect()`, so a child that exited on its own left the parent's listener
    // waiting -- which is what test-child-process-fork-ref2 reads.
    if (this.connected) {
      this.connected = false;
      this.emit("disconnect");
    }
    this.emit("exit", this.exitCode, this.signalCode);
    this.#maybeClose();
  }

  kill(signal?: string | number): boolean {
    // node: `undefined` means SIGTERM, a literal 0 is the existence probe and
    // passes through, and everything else goes through `convertToValidSignal` --
    // so `"sigterm"` works and `"foo"` is ERR_UNKNOWN_SIGNAL rather than
    // ERR_INVALID_ARG_VALUE, which test-child-process-constructor asserts.
    const number = signal === undefined ? 15 : signal === 0 ? 0 : validSignal(signal);
    const status = nts_child_process_kill(this.#handle, number);
    if (status === 0) this.killed = true;
    return status === 0;
  }

  [Symbol.dispose](): void {
    if (!this.killed) this.kill();
  }

  ref(): void {}
  unref(): void {}

  // ---------------------------------------------------------------- channel

  /**
   * `send`, present only on a child that has a channel.
   *
   * Node makes `send` `undefined` on a `spawn`ed child rather than defining it
   * to throw, and a program tests `typeof child.send === "function"` to find
   * out. Assigning it in `fork` rather than declaring it here keeps that
   * distinction, which is the same reason `dns` does not stub `resolve*`.
   */
  /** `(message, handle?, options?, callback?)`, the way node's is. */
  send?: (
    message: unknown,
    handle?: unknown,
    options?: unknown,
    callback?: unknown,
  ) => boolean;
  disconnect?: () => void;
  connected = false;

  /**
   * Called by the binding for each message the channel delivered.
   *
   * The value crosses as a value. It used to cross as JSON text, which silently decided
   * what a message could be: `serialization: 'advanced'` exists so a message can carry a
   * Uint8Array, a Buffer, a Map, a BigInt, a circular object or an Error, and
   * `JSON.stringify` turns the first five into something else and throws on the sixth.
   * The host channel serialises it either way -- structured clone for advanced, JSON for
   * the default -- so this layer has no business reserialising it.
   */
  /**
   * The channel closed from the **child's** end.
   *
   * A worker calling `process.disconnect()` is how `cluster` hands a worker back, and
   * the parent learns of it only from the binding: nothing on this side was called.
   * Emitted before `exit`, because a `disconnect` listener is entitled to find
   * `isConnected()` already false while the process is still alive.
   */
  _handleDisconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit("disconnect");
  }
  
  _handleMessage(message: unknown, sent?: unknown): void {
    // A message whose `cmd` begins with `NODE_` is node's *internal* channel traffic
    // and reaches `internalMessage` instead of `message`. That is not a curiosity: it
    // is the whole of `cluster`'s protocol -- the worker announces itself with
    // `{ cmd: 'NODE_CLUSTER', act: 'online' }` -- and a module that delivered it as an
    // ordinary `message` would hand every cluster handshake to the application.
    // **The handle, when one came with it.** `process.send(msg, socket)` in a child
    // arrives here as two values and the second was being dropped at the stand-in, so
    // a parent that asked for a descriptor got `undefined` and
    // test-cluster-net-send's `assert.ok(handle)` failed on a message that had
    // otherwise arrived intact. Passing a socket *to* a child already worked; this is
    // the other direction.
    //
    // What arrives is the **host's** socket, not one of this profile's: the descriptor
    // is real and its data flows, but `handle instanceof net.Socket` answers false
    // against our `net`. Adopting it would need a host-socket-to-ours direction that
    // `net` does not expose yet -- it exposes only the reverse, which is what sending
    // one uses. The same realm seam as `atob`, `URL` and the advanced-serialization
    // Buffer, and written here so a caller reading `handle` knows whose it is.
    this.emit(
      isInternalMessage(message) ? "internalMessage" : "message", message, sent,
    );
  }
}

function signalName(signal: number): string | null {
  for (const name of Object.keys(SIGNAL_NUMBERS)) {
    if (SIGNAL_NUMBERS[name] === signal) return name;
  }
  return null;
}

export function spawn(
  file: string,
  args?: readonly string[] | SpawnOptions,
  options?: SpawnOptions,
): ChildProcess {
  validateFile(file);
  const normalised = normaliseArgs(file, args as readonly string[] | SpawnSyncOptions | undefined,
    options as SpawnSyncOptions | undefined);
  const opts = normalised.options as SpawnOptions;
  checkNoNullBytes(file, normalised.args, opts);
  validateAbortSignal(opts.signal, "options.signal");
  validateSerialization((opts as { serialization?: unknown }).serialization);

  let command = file;
  let argv: string[];
  if (opts.shell !== undefined && opts.shell !== null && opts.shell !== false && opts.shell !== "") {
    warnArgsWithShell(normalised.args.length);
    const joined = [file, ...normalised.args].join(" ");
    const pair = shellCommand(joined, opts.shell);
    command = pair[0];
    argv = pair[1];
  } else {
    argv = [opts.argv0 === undefined ? file : opts.argv0, ...normalised.args];
  }

  const mode = stdioMode(opts.stdio);
  let child: ChildProcess | null = null;
  const handle = nts_child_process_spawn(
    command,
    argv,
    flattenEnv(opts.env),
    cwdPath(opts.cwd),
    mode,
    opts.detached === true ? 1 : 0,
    // -1 means "leave it alone"; a real uid or gid is unsigned. These were
    // validated and then dropped, so `spawn(file, args, { uid: 0 })` ran the child
    // as the caller instead of failing EPERM.
    typeof opts.uid === "number" ? opts.uid : -1,
    typeof opts.gid === "number" ? opts.gid : -1,
    // The caller's own `stdio`, normalised only where node normalises it: a string
    // becomes three of itself. A descriptor, `'ipc'` in any slot, or another child's
    // stream goes through as written, because the packed mode cannot say those.
    stdioSpecOf(opts.stdio),
      serializationOf(opts),
      // A spawned child has a channel when `stdio` names one, and then it gets the same
      // `message` events a forked one does. Only `fork` wired this, so
      // `spawn(file, args, { stdio: ['ipc', ...] })` had a channel the caller could not
      // hear -- which is four of the advanced-serialization files and stdout-ipc.
        (message: unknown, sent?: unknown): void => {
          if (child !== null) child._handleMessage(message, sent);
      },
      (): void => {
        if (child !== null) child._handleDisconnect();
      },
    (status: number, signal: number): void => {
      if (child !== null) child._handleExit(status, signal);
    },
    (): void => {},
  );

  if (handle < 0) {
    // Node reports a failed spawn as an `error` event on a ChildProcess that
    // exists, not as a throw. The object has to be constructed first, so this
    // cannot use the handle path.
    // The child is not a stub either: `stdout`, `stderr` and `stdin` are real
    // objects, because node makes the pipes before it attempts the spawn. `pid`
    // is undefined, `exitCode` is the errno, and the events are `error` then
    // `close(-2, null)` with no `exit` at all -- four facts, each measured
    // against node. The mode has to be the requested one: 0x2a is three `ignore`
    // slots, so `test-child-process-cwd` found `child.stdout` null and threw one
    // line before its assertion.
    if (!ASYNC_SPAWN_ERRORS.includes(errName(handle))) {
      throw errnoException(handle, "spawn");
    }
    const failed = new ChildProcess(-1, mode);
    failed.pid = undefined;
    failed.exitCode = handle;
    failed.spawnfile = command;
    failed.spawnargs = argv.slice();
    nextTickEmitError(failed, file, handle);
    return failed;
  }
  child = new ChildProcess(handle, mode);
  // node emits `spawn` on a nextTick after a successful spawn, before any stdio
  // event -- test-child-process-spawn-event asserts both the event and that
  // nothing else has fired before it.
  child.spawnfile = command;
  child.spawnargs = argv.slice();
  // A channel exists when `stdio` named one, and then the child gets what a forked child
  // gets. `send` lived only in `fork`, so `spawn(file, args, { stdio: ['ipc', ...] })`
  // returned a child with a channel and no way to use it.
  if (Array.isArray(opts.stdio) && (opts.stdio as readonly unknown[]).includes("ipc")) {
    attachChannel(child, handle);
  }
  const spawned = child;
  nextTick((): void => { spawned.emit("spawn"); });

  armTimeoutAndAbort(spawned, opts);

  return child;
}

/**
 * `timeout` and `signal`, which node arms on every child rather than only on `exec`.
 *
 * Extracted so `fork` gets them too: it had neither, so `fork(file, { signal })` ran a
 * child nothing could abort and test-child-process-fork-abort-signal waited for an
 * `error` that was never coming. node arms both in `ChildProcess.prototype.spawn`,
 * which `spawn` and `fork` both reach.
 */
function armTimeoutAndAbort(child: ChildProcess, opts: SpawnOptions): void {
  const killSignal = opts.killSignal ?? "SIGTERM";
  if (opts.timeout !== undefined && opts.timeout > 0) {
    let timer: Timeout | null = setTimeout((): void => {
      if (timer === null) return;
      timer = null;
      try {
        child.kill(killSignal);
      } catch (error) {
        child.emit("error", error as Error);
      }
    }, opts.timeout);
    child.once("exit", (): void => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    });
  }
  // node's `abortChildProcess`: the AbortError follows only when the signal was
  // actually delivered, because a child that has already exited is not an error.
  if (opts.signal !== undefined) {
    const signal = opts.signal;
    const onAbort = (): void => {
      try {
        if (child.kill(killSignal)) {
          child.emit("error", new AbortError(undefined, { cause: signal.reason }));
        }
      } catch (error) {
        child.emit("error", error as Error);
      }
    };
    if (signal.aborted) {
      nextTick(onAbort);
    } else {
      const cleanup = addTrackedAbortListener(signal, onAbort);
      child.once("exit", (): void => { cleanup(); });
    }
  }
}

/**
 * node's `isInternal`: a `cmd` beginning with `NODE_` and longer than the prefix.
 *
 * The length test is node's and it matters -- a message whose `cmd` is exactly `"NODE_"`
 * is *not* internal, so a caller cannot reach the internal channel by naming the prefix
 * and nothing more.
 */
function isInternalMessage(message: unknown): boolean {
  if (message === null || typeof message !== "object") return false;
  const cmd = (message as { cmd?: unknown }).cmd;
  return typeof cmd === "string" && cmd.length > 5 && cmd.slice(0, 5) === "NODE_";
}

/** `error` must not fire before the caller has attached a listener. */
/**
 * The five spawn failures node reports asynchronously.
 *
 * `ChildProcess.prototype.spawn` sends EACCES, EAGAIN, EMFILE, ENFILE and ENOENT
 * to `process.nextTick` as an `error` event, and **throws** for anything else. That
 * is not a detail: `spawn('echo', [], { uid: 0 })` as a non-root user fails EPERM,
 * and test-child-process-uid-gid asserts a synchronous throw matching /\bEPERM\b/.
 * Emitting it asynchronously instead means the `assert.throws` sees nothing and the
 * error arrives later with nobody listening.
 */
const ASYNC_SPAWN_ERRORS = ["EACCES", "EAGAIN", "EMFILE", "ENFILE", "ENOENT"];

function nextTickEmitError(child: ChildProcess, file: string, status: number): void {
  nextTick((): void => {
    const error: Error & {
      errno?: number;
      code?: string;
      syscall?: string;
      path?: string;
      spawnargs?: string[];
    } = new Error(`spawn ${file} failed`);
    error.errno = status;
    // The name of the errno rather than a constant: five codes reach this path and
    // hardcoding ENOENT reported the wrong one for the other four.
    error.code = errName(status);
    error.syscall = `spawn ${file}`;
    error.path = file;
    // node: `err.spawnargs = ArrayPrototypeSlice(this.spawnargs, 1)` -- argv without
    // argv[0], which test-child-process-spawn-error compares against what it passed.
    error.spawnargs = child.spawnargs.slice(1);
    child.emit("error", error);
    child.emit("close", child.exitCode, null);
  });
}


/**
 * `execFile`, and `exec` behind it.
 *
 * Both are `spawn` plus buffering: collect stdout and stderr to `maxBuffer`, and
 * call back once with either an error carrying `code`/`signal` or the two
 * buffers. Node builds them the same way in `lib/child_process.js`, which is why
 * the callback contract -- `(error, stdout, stderr)` with the buffers present
 * even when `error` is set -- falls out rather than being arranged.
 */
type ExecCallback = (
  error: (Error & { code?: unknown; signal?: string | null }) | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

function collect(
  child: ChildProcess,
  command: string,
  encoding: string | undefined,
  maxBuffer: number,
  callback: ExecCallback | undefined,
  timeout: number,
  killSignal: string | number,
): ChildProcess {
  // Before the callback check, because node's `execFile` sets it on the way past:
  // `exec('fhqwhgads').stderr.on('data', ...)` with no callback at all still gets
  // strings, which test-child-process-exec-stdout-stderr-data-string asserts.
  if (encoding !== undefined && encoding !== "buffer" && Buffer.isEncoding(encoding)) {
    child.stdout?.setEncoding(encoding);
    child.stderr?.setEncoding(encoding);
  }
  if (callback === undefined) return child;
  // A chunk is a string once something calls `setEncoding` on the stream, which
  // test-child-process-exec-env does itself. Node reads `readableEncoding` to
  // choose between joining and concatenating; reading the chunks answers the
  // same question without the stream having to expose it.
  const out: (Uint8Array | string)[] = [];
  const err: (Uint8Array | string)[] = [];
  let outLength = 0;
  let errLength = 0;
  let settled = false;
  let overflowed: string | null = null;
  let killedByUs = false;
  let timer: Timeout | null = null;
  // node holds the overflow error and hands *it* back rather than building one
  // from the exit status: the child is killed, so the status would say SIGTERM and
  // the caller would learn nothing about the buffer.
  let held: (Error & { code?: unknown; signal?: string | null; killed?: boolean; cmd?: string }) | null = null;

  const merge = (parts: (Uint8Array | string)[]): Buffer | string => {
    let sawString = false;
    for (const part of parts) {
      if (typeof part === "string") { sawString = true; break; }
    }
    if (!sawString) return decode(Buffer.concat(parts as Uint8Array[]), encoding);
    let text = "";
    for (const part of parts) {
      text += typeof part === "string" ? part : (decode(part, encoding ?? "utf8") as string);
    }
    return text;
  };

  const finish = (
    error:
      | (Error & { code?: unknown; signal?: string | null; killed?: boolean; cmd?: string })
      | null,
  ): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (error !== null) {
      error.killed = child.killed || killedByUs;
      void overflowed;
      // node's `exithandler` stamps `cmd` on every error it hands back, and
      // test-child-process-exec-timeout-expire asserts it.
      error.cmd = command;
    }
    callback(error, merge(out), merge(err));
  };

  // node's `execFile` does `child.stdout.setEncoding(encoding)` when the encoding
  // is a real one, and that decides how the maxBuffer budget is *spent*: the count
  // is in bytes (`Buffer.byteLength`) while the truncation is a `slice` on whatever
  // the chunk happens to be. In string mode a slice cuts **characters**, so
  // `maxBuffer: 10` against `console.log('中文测试')` -- five characters, thirteen
  // bytes -- keeps all five, which is exactly what
  // test-child-process-exec-maxbuf asserts. Without this the chunk is a Buffer, ten
  // bytes is three and a third characters, and the caller gets '中文测' and a
  // replacement character.
  if (child.stdout !== null) {
    child.stdout.on("data", (chunk: Uint8Array | string): void => {
      const length = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      outLength += length;
      if (maxBuffer > 0 && outLength > maxBuffer) {
        // The part that fits is still the caller's: node slices the chunk to the
        // remaining budget and pushes it, so `stdio.stdout` is exactly `maxBuffer`
        // long rather than short by one chunk.
        const fits = maxBuffer - (outLength - length);
        if (fits > 0) out.push(typeof chunk === "string" ? chunk.slice(0, fits) : chunk.subarray(0, fits));
        overflowed = "stdout";
        held = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stdout");
        killedByUs = true;
        // Destroying both is node's `kill()`, and it is what makes `close` arrive:
        // a child still writing into a stream nobody reads never ends its stdio, so
        // `#maybeClose` waits forever and the callback is never called.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.kill(killSignal);
        return;
      }
      out.push(chunk);
    });
  }
  if (child.stderr !== null) {
    child.stderr.on("data", (chunk: Uint8Array | string): void => {
      const length = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      errLength += length;
      if (maxBuffer > 0 && errLength > maxBuffer) {
        // The part that fits is still the caller's: node slices the chunk to the
        // remaining budget and pushes it, so `stdio.stderr` is exactly `maxBuffer`
        // long rather than short by one chunk.
        const fits = maxBuffer - (errLength - length);
        if (fits > 0) err.push(typeof chunk === "string" ? chunk.slice(0, fits) : chunk.subarray(0, fits));
        overflowed = "stderr";
        held = new ERR_CHILD_PROCESS_STDIO_MAXBUFFER("stderr");
        killedByUs = true;
        // Destroying both is node's `kill()`, and it is what makes `close` arrive:
        // a child still writing into a stream nobody reads never ends its stdio, so
        // `#maybeClose` waits forever and the callback is never called.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.kill(killSignal);
        return;
      }
      err.push(chunk);
    });
  }
  if (timeout > 0) {
    timer = setTimeout((): void => {
      timer = null;
      killedByUs = true;
      child.kill(killSignal);
    }, timeout);
  }
  child.on("error", (error: Error): void => finish(error));
  child.on("close", (code: number | null, signal: string | null): void => {
    if (held !== null) {
      // `code` and `signal` are not stamped on: node leaves the RangeError's own
      // `code` in place, and test-child-process-exec-maxbuf asserts it is
      // ERR_CHILD_PROCESS_STDIO_MAXBUFFER rather than an exit status.
      held.signal = signal;
      finish(held);
      return;
    }
    if (code === 0 && signal === null) { finish(null); return; }
    const error: Error & { code?: unknown; signal?: string | null; killed?: boolean } =
      new Error(`Command failed: ${command}\n${merge(err) as string}`);
    // A negative exit code is a uv error rather than a status, and node translates
    // it: `code < 0 ? getSystemErrorName(code) : code`. test-child-process-execfile
    // says so in its own comment -- "negative exit codes can be translated to UV
    // error names" -- and asserts `getSystemErrorName(-1)`, which is EPERM.
    error.code = typeof code === "number" && code < 0 ? errName(code) : code;
    error.signal = signal;
    finish(error);
  });
  return child;
}

/**
 * `execFile(file, args?, options?, callback?)`, with every position checked.
 *
 * Node accepts an array, an object or a function in the second position; an
 * object or a function in the third; a function in the fourth. Anything else --
 * a string in particular -- is `ERR_INVALID_ARG_TYPE`, and
 * `test-child-process-spawn-typeerror.js` asserts that across a dozen
 * combinations. Its own comment says why a string looks strange and is
 * deliberate: the same rule holds for `net.createServer('not options', 'not
 * callback')`.
 *
 * This used to classify by what it recognised and ignore the rest, so every one
 * of those dozen returned a child instead of throwing.
 */
export function execFile(
  file: string,
  args?: readonly string[] | SpawnOptions | ExecCallback,
  options?: SpawnOptions | ExecCallback,
  callback?: ExecCallback,
): ChildProcess {
  let list: readonly string[] | undefined;
  let opts: SpawnOptions = ownOptions({}) as SpawnOptions;
  let done: ExecCallback | undefined;

  const classify = (value: unknown, position: string, allowArray: boolean): string => {
    if (value === undefined || value === null) return "none";
    if (Array.isArray(value)) {
      if (allowArray) return "array";
      // `typeof [] === "object"`, so without this an array in the options
      // position was classified as options and rejected only by whatever later
      // check happened to look at it. That was an accident, and it stopped
      // working the moment the options were copied onto a null prototype before
      // that check: the copy of an array is a plain object and passes.
      // test-child-process-spawn-typeerror asserts `execFile(cmd, [], [])` throws.
      throw new ERR_INVALID_ARG_TYPE(position, ["Object", "Function"], value);
    }
    if (typeof value === "function") return "callback";
    if (typeof value === "object") return "options";
    throw new ERR_INVALID_ARG_TYPE(position, allowArray ? ["Array", "Object", "Function"] : ["Object", "Function"], value);
  };

  const second = classify(args, "args", true);
  if (second === "array") list = args as readonly string[];
  else if (second === "options") opts = ownOptions(args as SpawnOptions);
  else if (second === "callback") done = args as ExecCallback;

  // **Parsing stops at the callback.** `execFile(cmd, callback, "a string")` is
  // asserted *not* to throw, on the line after twelve that are. Node fills the
  // callback from the first function it meets and never looks at what follows,
  // so a later argument of any type is ignored rather than rejected. Validating
  // it would be stricter than node and would fail that one line.
  if (second !== "callback") {
    const third = classify(options, "options", false);
    if (third === "options") opts = ownOptions(options as SpawnOptions);
    else if (third === "callback") done = options as ExecCallback;

    if (third !== "callback" && callback !== undefined && callback !== null) {
      if (typeof callback !== "function") {
        throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
      }
      done = callback;
    }
  }

  checkNoNullBytes(file, list ?? [], opts);
  const child = spawn(file, list ?? [], opts);
  const maxBuffer = opts.maxBuffer ?? MAX_BUFFER;
  const cmd = (list ?? []).length === 0 ? file : `${file} ${(list ?? []).join(" ")}`;
  return collect(child, cmd, "encoding" in opts ? opts.encoding : "utf8", maxBuffer, done, opts.timeout ?? 0, opts.killSignal ?? "SIGTERM");
}

export function exec(
  command: string,
  options?: SpawnOptions | ExecCallback,
  callback?: ExecCallback,
): ChildProcess {
  validateString(command, "command");
  let opts: SpawnOptions = ownOptions({}) as SpawnOptions;
  let done: ExecCallback | undefined;
  if (typeof options === "function") done = options as ExecCallback;
  else if (options !== undefined && options !== null) opts = ownOptions(options as SpawnOptions);
  if (callback !== undefined) done = callback;

  checkNoNullBytes(command, [], opts);
  const shell = typeof opts.shell === "string" ? opts.shell : true;
  const child = spawn(command, [], ownOptions({ ...opts, shell }));
  const maxBuffer = opts.maxBuffer ?? MAX_BUFFER;
  return collect(child, command, "encoding" in opts ? opts.encoding : "utf8", maxBuffer, done, opts.timeout ?? 0, opts.killSignal ?? "SIGTERM");
}


export interface ForkOptions extends SpawnOptions {
  execPath?: string | undefined;
  execArgv?: readonly string[] | undefined;
  silent?: boolean | undefined;
}

/**
 * `fork`, with the channel.
 *
 * The child is a real node, so `process.send` on its side is node's own and
 * needs nothing from this profile. What is owed is this side: `child.send`, the
 * `message` event, and `disconnect`. The framing is
 * `JSON.stringify(value) + "\n"` in both directions, which is node's `json`
 * serialization mode and its default.
 *
 * An earlier attempt did `fork` *without* a channel, on the reasoning that 14 of
 * the 39 `fork` tests never assert on `send` or `message`. It made the lane
 * unusable: a forked child that expects a channel does not fail, it **hangs**,
 * and each of the 39 then took the runner's sixty-second timeout. The count was
 * true about what those tests assert and false about what they do.
 */
export function fork(
  modulePath: string | URL,
  args?: readonly string[] | ForkOptions,
  options?: ForkOptions,
): ChildProcess {
  // node accepts a `file:` URL here, and test-child-process-fork-url passes
  // `new URL(import.meta.url)`. Read structurally for the reason `cwdPath` is: the
  // caller's URL is the *host's* class on the interpreted lane, so `instanceof`
  // against the one this module imports answers false and the branch is unreachable.
  const modulePathIsUrl = typeof modulePath === "object" && modulePath !== null
    && typeof (modulePath as { href?: unknown }).href === "string";
  if (!modulePathIsUrl) validateString(modulePath, "modulePath");
  const modulePathString = modulePathIsUrl
    ? fileURLToPath(`${(modulePath as { href: string }).href}`)
    : (modulePath as string);
  let list: readonly string[] = [];
  let opts: ForkOptions = ownOptions({}) as ForkOptions;
  if (Array.isArray(args)) {
    list = args as readonly string[];
  } else if (args !== undefined && args !== null) {
    // Node's second argument is an array of arguments or an options object and
    // nothing else. `fork(path, 0)`, `fork(path, true)`, `fork(path, () => {})`
    // and `fork(path, Symbol())` each throw `ERR_INVALID_ARG_TYPE`, which
    // `test-child-process-fork-args.js` asserts one per line. Accepting them as
    // options -- which this did -- turns four thrown TypeErrors into four silent
    // misreadings of the caller's intent.
    if (typeof args !== "object") {
      throw new ERR_INVALID_ARG_TYPE("args", ["object", "Array"], args);
    }
    opts = ownOptions(args as ForkOptions);
  }
  if (options !== undefined && options !== null) {
    // `typeof [] === "object"`, so a bare `typeof` check lets an array through
    // where node wants an options object -- `fork(module, args, args)` returned a
    // child instead of throwing. `validateObject` rejects arrays, which is the
    // whole reason it exists rather than being written inline.
    validateObject(options, "options");
    opts = ownOptions(options);
  }

  // **`fork` requires a channel, and node says so rather than making one quietly.**
  // An explicit `stdio` without `'ipc'` is ERR_CHILD_PROCESS_IPC_REQUIRED, and a
  // string is expanded the way node's `stdioStringToArray` does -- four spellings and
  // nothing else, so `{ stdio: '33' }` is ERR_INVALID_ARG_VALUE rather than three
  // pipes named 3 and 3. Both are asserted, by test-child-process-fork-stdio and
  // test-child-process-fork-stdio-string-variant.
  validateSerialization((opts as { serialization?: unknown }).serialization);
  const forkStdio = (opts as { stdio?: unknown }).stdio;
  if (typeof forkStdio === "string") {
    if (forkStdio !== "ignore" && forkStdio !== "overlapped"
      && forkStdio !== "pipe" && forkStdio !== "inherit") {
      throw new ERR_INVALID_ARG_VALUE("stdio", forkStdio);
    }
  } else if (Array.isArray(forkStdio) && !forkStdio.includes("ipc")) {
    throw new ERR_CHILD_PROCESS_IPC_REQUIRED("options.stdio");
  }

  // The slots `fork` will actually have. `silent` only chooses between piping and
  // inheriting when `stdio` said nothing; an explicit array decides it.
  const forkMode = forkStdio === undefined
    ? (opts.silent === true ? 0 : 0x15)
    : stdioMode(forkStdio as string | readonly string[]);
  // The binding takes one flag where node takes an array, so "pipe" is whether either
  // output slot is a pipe. That is coarser than node and worth saying: a request for
  // `['pipe','inherit','pipe','ipc']` gets both piped here. What it fixes is the case
  // that was simply wrong -- an explicit all-pipe `stdio` was inheriting, so
  // `child.stderr` was null and test-child-process-fork-stdio read `.on` of null.
  const forkPipes = (forkMode & 0x3) === 0 || ((forkMode >> 2) & 0x3) === 0
    || ((forkMode >> 4) & 0x3) === 0 ? 1 : 0;

  checkNoNullBytes(modulePathString, list, opts);
  const execPath = opts.execPath === undefined ? nts_process_exec_path() : opts.execPath;
  const execArgv = opts.execArgv === undefined ? [] : opts.execArgv;
  rejectNullBytes(execPath, "options.execPath");
  for (const argument of execArgv) rejectNullBytes(argument, "options.execArgv");
  const argv = [execPath, ...execArgv, modulePathString, ...list];

  let child: ChildProcess | null = null;
  const handle = nts_child_process_fork(
    execPath,
    argv,
    flattenEnv(opts.env),
    cwdPath(opts.cwd),
    forkPipes,
    serializationOf(opts),
    (status: number, signal: number): void => {
      if (child !== null) child._handleExit(status, signal);
    },
    (message: unknown, sent?: unknown): void => {
      if (child !== null) child._handleMessage(message, sent);
    },
    (): void => {
      if (child !== null) child._handleDisconnect();
    },
  );

  if (handle < 0) {
    const failed = new ChildProcess(-1, forkMode);
    failed.pid = undefined;
    failed.exitCode = handle;
    nextTickEmitError(failed, modulePathString, handle);
    return failed;
  }

  // An explicit `stdio` decides the slots; `silent` only chooses between piping and
  // inheriting when nothing was said. `fork` was ignoring the array outright, so
  // `{ stdio: ['pipe','pipe','pipe','ipc'] }` inherited and `child.stderr` was null.
  child = new ChildProcess(handle, forkMode);
  // `fork` had neither a timeout nor an abort signal: `fork(file, { signal })` ran a
  // child nothing could stop.
  armTimeoutAndAbort(child, opts as SpawnOptions);
  attachChannel(child, handle);
  return child;
}
