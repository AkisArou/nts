// The native half of everything under `runtime/node/internal/`, for the
// node-side run only.
//
// These stand for what the process itself provides -- its streams, its
// environment, its clock, its tick queue -- and every module needs some of
// them because the shared code under `internal/` does. One file rather than a
// copy per module: a binding defined twice with two slightly different bodies
// is a bug that only shows up in whichever module is tested second.
//
// Each module's own `bindings.node.mjs` imports this and adds what is its own.
import process from "node:process";
import { createRequire } from "node:module";
import v8 from "node:v8";
import { AsyncLocalStorage } from "node:async_hooks";

const require = createRequire(import.meta.url);

// Read at call time, not captured: node's tests replace `process.stdout.write`
// to see what was printed, and a captured reference would miss the
// replacement.
globalThis.nts_write_stdout = (text) => { process.stdout.write(text); };
globalThis.nts_write_stderr = (text) => { process.stderr.write(text); };

// Ending the process, for the paths that cannot return to their caller: a
// hook that threw, a fatal error inside the runtime. Here rather than in
// `node:process` because `async_hooks` needs it and does not otherwise depend
// on that module, and because two definitions of one binding with two
// slightly different bodies is what this file exists to prevent.
globalThis.nts_process_really_exit = (code) => process.reallyExit(code);
globalThis.nts_stdout_is_tty = () => Boolean(process.stdout.isTTY);
globalThis.nts_stderr_is_tty = () => Boolean(process.stderr.isTTY);
globalThis.nts_stdio_color_depth = () =>
  (typeof process.stdout.getColorDepth === "function" ? process.stdout.getColorDepth() : 1);

globalThis.nts_process_env = (name) => process.env[name] ?? "";
globalThis.nts_process_env_has = (name) => process.env[name] !== undefined;
globalThis.nts_process_pid = () => process.pid;
globalThis.nts_process_emit_warning = (message, name, code) => {
  process.emitWarning(message, name, code || undefined);
};

globalThis.nts_hrtime_ns = () => process.hrtime.bigint();
globalThis.nts_process_is_exiting = () => Boolean(process._exiting);
globalThis.nts_next_tick = (callback, args) => { process.nextTick(callback, ...(args ?? [])); };

globalThis.nts_debug_write = (text) => { process.stderr.write(text); };
globalThis.nts_platform = () => process.platform;
globalThis.nts_process_cwd = () => process.cwd();

// Node suppresses a deprecation warning raised from inside a dependency, on
// the grounds that the application cannot act on it. A compiled program has no
// `node_modules` to be inside, so the compiled answer is always false; on node
// the stack is what says.
globalThis.nts_is_inside_node_modules = () => false;

// libuv's error table, for `internal/uv.ts`.
//
// Here rather than in `fs` and `util`, which each had their own copy. The two
// had already drifted: one asked `getSystemErrorMessage` and fell back to a
// hand-written table, the other read `getSystemErrorMap` and answered "unknown
// error". A rule with two implementations has two behaviours, and which one a
// module got depended on which bindings file it happened to load.
globalThis.nts_uv_err_name = (code) => {
  try {
    return require("node:util").getSystemErrorName(code);
  } catch {
    return "UNKNOWN";
  }
};

globalThis.nts_uv_err_message = (code) => {
  const util = require("node:util");
  if (typeof util.getSystemErrorMessage === "function") {
    try {
      return util.getSystemErrorMessage(code);
    } catch {
      // Fall through to the map.
    }
  }
  const entry = util.getSystemErrorMap().get(code);
  return entry ? entry[1] : "unknown error";
};

// -- asynchronous context ---------------------------------------------------
//
// Everything below is a capability the language does not have. A value cannot
// be made to survive an `await` from inside JavaScript, and a promise cannot be
// watched from inside JavaScript, because both are things the engine does
// between one piece of user code and the next.
//
// They live in this shared file rather than with `node:async_hooks` because
// `internal/tick.ts` and `node:timers` report themselves to the hooks, so a
// program that never mentions `async_hooks` still needs these defined.
//
// It is worth being precise about what a test passing over these does and does
// not prove: that the module's logic is right given working primitives, and
// nothing at all about whether the compiled runtime has them.

// The continuation-preserved slot, which node exposes only through this class.
// One instance for the whole process, holding our frame as its store: what is
// borrowed is the propagation, not the storage semantics, and the frame we put
// in is entirely ours.
const carrier = new AsyncLocalStorage();

globalThis.nts_async_context_get = () => carrier.getStore();
globalThis.nts_async_context_set = (frame) => carrier.enterWith(frame);

// `v8.promiseHooks` rather than node's `async_hooks`, because the callbacks
// here need the promise *object* -- `async_hooks` reports ids, and an id
// cannot be given the async id we want to attach to it.
let stopPromiseHook;

globalThis.nts_promise_hook_install = (init, before, after, settled) => {
  // Replacing rather than adding: the module calls this again whenever the set
  // of hooks it needs changes, and leaving the old one installed would report
  // every promise twice.
  if (stopPromiseHook) stopPromiseHook();
  stopPromiseHook = v8.promiseHooks.createHook({
    init: init ?? undefined,
    before: before ?? undefined,
    after: after ?? undefined,
    settled: settled ?? undefined,
  });
};

globalThis.nts_promise_hook_uninstall = () => {
  if (!stopPromiseHook) return;
  stopPromiseHook();
  stopPromiseHook = undefined;
};

// A `FinalizationRegistry` is the JavaScript form of "tell me when this is
// gone", and it is the right shape: the callback runs after collection, never
// during, so a `destroy` hook cannot observe a half-collected object. What it
// does not promise is that the callback runs at all -- a program that exits
// first will never see it -- which is why nothing in the module above depends
// on `destroy` arriving.
const collected = new FinalizationRegistry((onCollected) => { onCollected(); });

globalThis.nts_on_collected = (resource, onCollected) => {
  collected.register(resource, onCollected);
};

globalThis.nts_enqueue_microtask = (callback) => { queueMicrotask(callback); };
