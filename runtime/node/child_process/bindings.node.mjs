// `nts_child_process_spawn_sync`, stood in for by node's own `spawnSync`.
//
// # What this lane does and does not measure
//
// The binding here is node's `child_process.spawnSync`, so on the interpreted
// lane this module's TypeScript runs over node's spawn. A comparison against node
// therefore measures the argument shaping, the option handling, the result object
// and the throw-on-failure contract -- not `uv_spawn`.
//
// That is the arrangement `zlib` and `dns` already have, and it is stated here
// rather than discovered later. It is legitimate for this module in a way it
// would not be for `crypto`, and the reason is where each implementation's weight
// sits: node's own `lib/child_process.js` is about 1200 lines of exactly this
// shaping over a thin binding, so running our shaping against node's shaping over
// one shared OS primitive is a real comparison. For `crypto` the provider *is*
// the implementation and the same arrangement would compare node against itself.
//
// `uv_spawn` is compared only on the compiled lane. `run.mjs --sabotage` is what
// keeps this honest: blanking the module still fails every test, because the
// TypeScript above is the subject.
// The shared process-level bindings, which `internal/` declares and which this
// module reaches through `Buffer` -- `buffer/src/blob.ts` imports `internal/uv.ts`
// for `systemError`. Without this the module fails to load with
// `nts_uv_err_name is not defined`, one import away from anything this file names.
import "../internal/bindings.node.mjs";
// `collect` arms a timeout through the timers module, the way `net` does.
import "../timers/bindings.node.mjs";
import { spawnSync } from "node:child_process";

globalThis.nts_child_process_spawn_sync = (
  file,
  args,
  env,
  cwd,
  input,
  timeout,
  maxBuffer,
  callback,
) => {
  // The C binding takes argv *including* argv[0] and node's `spawnSync` takes it
  // without, so the stand-in drops it. `argv0` is passed separately to keep the
  // two meanings apart -- a child whose argv[0] differs from its path is exactly
  // what `test-child-process-spawn-argv0.js` asserts.
  const [argv0, ...rest] = args;
  const options = {
    argv0,
    maxBuffer: maxBuffer === 0 ? Infinity : maxBuffer,
    windowsHide: true,
  };
  if (env !== null) {
    options.env = Object.fromEntries(
      env.map((entry) => {
        const at = entry.indexOf("=");
        return at < 0 ? [entry, ""] : [entry.slice(0, at), entry.slice(at + 1)];
      }),
    );
  }
  if (cwd !== "") options.cwd = cwd;
  if (input !== null && input !== undefined) options.input = Buffer.from(input);
  if (timeout > 0) options.timeout = timeout;

  const result = spawnSync(file, rest, options);

  // Node reports a signalled child as `signal: 'SIGTERM'` with `status: null`;
  // the C binding reports a number and a status of -1. Translating here keeps the
  // TypeScript reading one shape rather than two.
  const signal = result.signal === null || result.signal === undefined
    ? 0
    : (hostSignalNumbers[result.signal] ?? 0);

  // The numeric errno, to match the C. Node's own error object carries `errno`
  // already; falling back to a generic negative keeps the shape when it does not.
  let error = 0;
  if (result.error !== undefined && result.error !== null) {
    error = typeof result.error.errno === "number" ? result.error.errno : -1;
  }

  callback(
    result.status === null || result.status === undefined ? -1 : result.status,
    signal,
    result.stdout === null || result.stdout === undefined
      ? new Uint8Array(0)
      : new Uint8Array(result.stdout),
    result.stderr === null || result.stderr === undefined
      ? new Uint8Array(0)
      : new Uint8Array(result.stderr),
    error,
    result.pid ?? 0,
  );
};


// ------------------------------------------------------------ asynchronous
//
// Node's own `spawn` behind the same seven primitives the C provides. The
// interpreted lane therefore tests this module's `ChildProcess`, its stdio
// stream classes and its event ordering over node's `uv_spawn` -- the same
// arrangement `zlib` and `dns` record, and legitimate for the same reason: node's
// `lib/child_process.js` is about 1200 lines of exactly this shaping over a thin
// binding, so our shaping against theirs over one OS primitive is a real
// comparison.
import { spawn as nodeSpawn } from "node:child_process";
import { constants as hostOsConstants } from "node:os";

// The platform's own table rather than three partial copies of it: each of the
// hand-written lists here held 11 of the 33 names `os.constants.signals`
// publishes, and reported every other signal as 0.
const hostSignalNumbers = hostOsConstants.signals;

/**
 * A stdio entry the host can act on.
 *
 * `stdio: [cat.stdout, 'pipe', 'pipe']` hands one child's stream to another child, and
 * the host resolves that from the stream's descriptor. The module's own stream has no
 * descriptor -- the binding owns the pipe -- so it carries the child and slot it belongs
 * to and this swaps in the host stream standing behind it. Everything else passes
 * through: a name, a number, a host stream the test made itself.
 */
function hostStream(entry) {
  if (entry === null || typeof entry !== "object") return entry;
  if (typeof entry.ntsChildHandle !== "number") return entry;
  const owner = live.get(entry.ntsChildHandle);
  if (owner === undefined) return entry;
  const slot = entry.ntsChildSlot;
  return (slot === 0 ? owner.child.stdin : slot === 1 ? owner.child.stdout : owner.child.stderr)
    ?? entry;
}

const live = new Map();
let nextHandle = 0;

const MODE = (bits, slot) => (bits >> (slot * 2)) & 3;
const NAMES = ["pipe", "inherit", "ignore"];

globalThis.nts_child_process_spawn = (file, args, env, cwd, stdioMode, detached, uid, gid, stdioSpec, serialization, onMessage, onExit) => {
  const [argv0, ...rest] = args;
  const options = {
    argv0,
    detached: detached !== 0,
    // The caller's array when there is one: the host understands `'ipc'` in any slot,
    // a descriptor, and another child's stream, and the packed mode cannot say any of
    // those. The mode remains the fallback for a caller who said nothing.
    stdio: stdioSpec !== null && stdioSpec !== undefined
      ? stdioSpec.map(hostStream)
      : [NAMES[MODE(stdioMode, 0)], NAMES[MODE(stdioMode, 1)], NAMES[MODE(stdioMode, 2)]],
  };
  if (env !== null) {
    options.env = Object.fromEntries(env.map((entry) => {
      const at = entry.indexOf("=");
      return at < 0 ? [entry, ""] : [entry.slice(0, at), entry.slice(at + 1)];
    }));
  }
  if (cwd !== "") options.cwd = cwd;
  // -1 is "leave it alone". node's own spawn throws EPERM here for a non-root
  // caller asking for uid 0, and that throw is the point: these two options were
  // validated by the module and then dropped before the binding, so a child asked
  // to drop privileges ran as the caller and nothing said so.
  if (uid >= 0) options.uid = uid;
  if (gid >= 0) options.gid = gid;
  // Only meaningful when `stdio` names a channel, and harmless when it does not.
  options.serialization = serialization;

  let child;
  try {
    child = nodeSpawn(file, rest, options);
  } catch (error) {
    // node's own `spawn` throws for every spawn errno but five, and the errno is on
    // the thrown error. Flattening it to -2 turned an EPERM -- which
    // `spawn('echo', [], { uid: 0 })` raises for a non-root user -- into an ENOENT,
    // and ENOENT is one of the five this module reports asynchronously. The test
    // asserting a synchronous throw then saw nothing at all.
    return typeof error?.errno === "number" ? error.errno : -2;
  }
  // node decides synchronously whether the spawn took: a child that failed has no
  // `pid`, and its `error` event follows on a later tick. The compiled lane's
  // `uv_spawn` returns the error directly, so reporting it here is what keeps the
  // two lanes on one shape -- test-child-process-cwd asserts
  // `typeof child.pid === "undefined"` for a cwd that does not exist, and a
  // stand-in that hands back a handle cannot produce that. The no-op listener is
  // for node's own error event, which would otherwise be unhandled.
  if (child.pid === undefined) {
    child.on("error", () => {});
    return -2;
  }
  const handle = nextHandle++;
  const entry = { child, failed: false };
  live.set(handle, entry);

  // A spawn that fails resolves asynchronously in node too, as an `error` event.
  // Returning a handle and reporting the failure through the exit callback keeps
  // one shape for both lanes.
  child.on("error", () => { entry.failed = true; });
  // A spawned child with an `'ipc'` slot has a channel, and its messages reach the
  // caller the same way a forked child's do. Only `fork` wired this.
  if (typeof onMessage === "function") child.on("message", (message) => onMessage(message));
  child.on("exit", (code, signal) => {
    onExit(code === null ? -1 : code, signal === null ? 0 : (hostSignalNumbers[signal] ?? 0));
  });
  return handle;
};

globalThis.nts_child_process_read_start = (handle, which, onData, onEnd) => {
  const entry = live.get(handle);
  if (entry === undefined) return;
  const stream = which === 1 ? entry.child.stdout : entry.child.stderr;
  if (!stream) return;
  stream.on("data", (chunk) => onData(new Uint8Array(chunk)));
  stream.on("end", () => onEnd());
};

globalThis.nts_child_process_write = (handle, bytes, callback) => {
  const entry = live.get(handle);
  if (entry === undefined || !entry.child.stdin) return -32;
  entry.child.stdin.write(Buffer.from(bytes), () => callback(0, 0));
  return 0;
};

globalThis.nts_child_process_end_stdin = (handle) => {
  const entry = live.get(handle);
  if (entry !== undefined && entry.child.stdin) entry.child.stdin.end();
};

globalThis.nts_child_process_kill = (handle, signal) => {
  const entry = live.get(handle);
  if (entry === undefined) return -3;
  const names = { 1: "SIGHUP", 2: "SIGINT", 3: "SIGQUIT", 9: "SIGKILL", 15: "SIGTERM" };
  return entry.child.kill(names[signal] ?? signal) ? 0 : -3;
};

globalThis.nts_child_process_pid = (handle) => {
  const entry = live.get(handle);
  return entry === undefined ? 0 : (entry.child.pid ?? 0);
};

globalThis.nts_child_process_close = (handle) => {
  live.delete(handle);
};

globalThis.nts_process_exec_path = () => process.execPath;

// `fork` with its channel. Node's own `fork` establishes it -- a socketpair, the
// child's fd in `NODE_CHANNEL_FD`, and newline-delimited JSON over it -- so the
// stand-in hands whole messages up as strings and this module does the framing
// and parsing, which is the part a test can observe.
import { fork as nodeFork } from "node:child_process";

globalThis.nts_child_process_fork = (execPath, args, env, cwd, silent, serialization, onExit, onMessage) => {
  const [, ...rest] = args;
  const modulePath = rest.shift();
  const options = { execPath, silent: silent !== 0, serialization };
  if (env !== null) {
    options.env = Object.fromEntries(env.map((entry) => {
      const at = entry.indexOf("=");
      return at < 0 ? [entry, ""] : [entry.slice(0, at), entry.slice(at + 1)];
    }));
  }
  if (cwd !== "") options.cwd = cwd;

  let child;
  try {
    child = nodeFork(modulePath, rest, options);
  } catch {
    return -2;
  }
  const handle = nextHandle++;
  live.set(handle, { child, failed: false });
  child.on("error", () => {});
  // The value, not text: the host channel already serialised it, with structured
  // clone under `serialization: "advanced"`, and re-encoding it as JSON here would
  // undo exactly what that option is for.
  child.on("message", (message) => onMessage(message));
  child.on("exit", (code, signal) => {
    onExit(code === null ? -1 : code, signal === null ? 0 : (hostSignalNumbers[signal] ?? 0));
  });
  return handle;
};

globalThis.nts_child_process_send = (handle, message, sent) => {
  const entry = live.get(handle);
  if (entry === undefined) return -32;
  try {
    // `sent` is a socket or a server, and it crosses as itself: the host's own
    // `child.send(message, handle)` does the descriptor passing, which is a sendmsg
    // with SCM_RIGHTS and not something this stand-in should reimplement. It is also
    // the one argument here that has no representation in the compiled runtime, and
    // that is written down in the module beside the declaration rather than here.
    if (sent !== undefined && sent !== null) {
      return entry.child.send(message, sent) ? 0 : -32;
    }
    return entry.child.send(message) ? 0 : -32;
  } catch {
    return -32;
  }
};

globalThis.nts_child_process_disconnect = (handle) => {
  const entry = live.get(handle);
  if (entry !== undefined && entry.child.connected) entry.child.disconnect();
};
