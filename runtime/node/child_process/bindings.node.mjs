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
import { Buffer as HostBuffer } from "node:buffer";
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
/**
 * A handle the host's `child.send(message, handle)` will accept.
 *
 * `cluster` distributes accepted connections by sending them to a worker, and the host
 * needs one of *its* sockets. This profile's `net.Socket` is a number on the boundary --
 * a `uv_tcp_t` on the compiled side -- so `net`'s stand-in keeps the host object behind
 * that number and `nts_net_host_socket` hands it back. A socket that is already the
 * host's passes through, which is what a test constructing its own gets.
 */
function hostHandle(sent) {
  if (sent === null || typeof sent !== "object") return sent;
  // **A registry rather than a second named global.** Our `net.Socket` is resolved by
  // `_handle` below; `cluster` needs to pass a handle node's own factories built, and it
  // registers a resolver rather than being special-cased here -- `child_process` should
  // not have to know what `cluster` is. Two ad-hoc globals is where the list earns itself.
  const resolvers = globalThis.nts_host_handle_resolvers;
  if (Array.isArray(resolvers)) {
    for (const resolve of resolvers) {
      const found = resolve(sent);
      if (found !== undefined) return found;
    }
  }
  // **`net`'s `_handle` is an object carrying `identifier`, as node's carries a descriptor.**
  //
  // This read `typeof sent._handle === "number"` to recognise one of our sockets. When `net`
  // stopped exposing a bare number -- because a number in a `stdio` array is a file descriptor
  // and `server._handle` was being passed as fd 1 -- every socket stopped being recognised
  // here, and a socket that is not recognised is sent as itself.
  const wrapped = sent._handle;
  const handle = typeof wrapped === "number"
    ? wrapped
    : wrapped !== null && typeof wrapped === "object" && typeof wrapped.identifier === "number"
      ? wrapped.identifier
      : undefined;
  if (typeof handle !== "number") return sent;
  if (typeof globalThis.nts_net_host_socket !== "function") return sent;
  const host = globalThis.nts_net_host_socket(handle);
  if (host !== undefined) return host;
  // **Falling back to `sent` here is how a numeric `_handle` reaches node's `net`.**
  //
  // An object with a numeric `_handle` is one of this profile's sockets, and the host's
  // `send` needs the host's. Returning ours when the lookup misses hands node an object
  // whose `_handle` is a number, and node then calls `_handle.close()` on it deep inside
  // `new Socket` -- *self._handle.close is not a function*, from
  // `closeSocketHandle (node:net:360)` by way of `Object.onconnection (node:net:2735)`, in
  // the *worker*. Nothing in that stack names the parent, the socket, or the lookup.
  //
  // A miss means the socket was never adopted or has already been closed and swept, and
  // either way sending it is wrong. Saying so costs one line and turns a stack in someone
  // else's module into a sentence about this one.
  throw new Error(
    `nts: a socket with handle ${handle} has no host socket to send; ` +
    "it was never adopted, or it closed before it crossed",
  );
}

function hostStream(entry) {
  if (entry === null || typeof entry !== "object") return entry;
  // **A `stdio` entry can be one of `net`'s handles, and then the host needs its own.**
  //
  // `spawn(..., { stdio: ['ignore','ignore','ignore', server._handle] })` asks the operating
  // system to hand a child a listening socket. Only the host's handle can be inherited, so a
  // `NetNativeHandle` is translated here rather than passed through -- passed through as a
  // *number*, which is what `_handle` used to be, it was read as **file descriptor 1** and the
  // child listened on the parent's stdout.
  if (typeof entry.identifier === "number") {
    if (entry.server === true) {
      return globalThis.nts_net_host_server_handle?.(entry.identifier) ?? entry;
    }
    return globalThis.nts_net_host_socket?.(entry.identifier)?._handle ?? entry;
  }
  if (typeof entry.ntsChildHandle !== "number") return entry;
  const owner = live.get(entry.ntsChildHandle);
  if (owner === undefined) return entry;
  // **The stream, not its descriptor, because node's wrap branch does the right thing.**
  //
  // Measured on node, hooking `Pipe.prototype.readStop` and watching the parent's stream across
  // a handoff:
  //
  //     before   isPaused=false destroyed=false
  //     after    isPaused=true  destroyed=false  readStop=1  handle=present
  //     later    readableLength=0                (nothing stolen)
  //
  // So node **pauses the parent's reader and keeps the handle**. The child gets a duplicate, the
  // parent can `resume()` afterwards, and nothing is consumed in between. That is what both of
  // the awkward tests need at once: `pipe-dataflow` needs the parent not to steal, and
  // `stdio-reuse-readable-stdio` needs the parent able to read again once the other child exits.
  //
  // Handing the descriptor instead put node on its `fd` branch, which dups without pausing, and
  // the reader we left running stole one 64KB chunk: `wc` counted **983041 of 1048577**.
  const slot = entry.ntsChildSlot;
  return (slot === 0 ? owner.child.stdin
    : slot === 1 ? owner.child.stdout
    : slot === 2 ? owner.child.stderr
    : owner.child.stdio?.[slot])
    ?? entry;
}

const live = new Map();
let nextHandle = 0;

const MODE = (bits, slot) => (bits >> (slot * 2)) & 3;
const NAMES = ["pipe", "inherit", "ignore"];

globalThis.nts_child_process_spawn = (file, args, env, cwd, stdioMode, detached, uid, gid, stdioSpec, serialization, onMessage, onDisconnect, onExit) => {
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
  if (typeof onMessage === "function") {
    child.on("message", (message, sent) => onMessage(message, sent));
    child.on("internalMessage", (message, sent) => onMessage(message, sent));
    // The channel closing from the child's own end, which nothing here called.
    if (typeof onDisconnect === "function") child.on("disconnect", () => onDisconnect());
  }
  child.on("exit", (code, signal) => {
    onExit(code === null ? -1 : code, signal === null ? 0 : (hostSignalNumbers[signal] ?? 0));
  });
  return handle;
};

globalThis.nts_child_process_read_start = (handle, which, onData, onEnd) => {
  const entry = live.get(handle);
  if (entry === undefined) return;
  // **Any slot, by index, because a child can have more than three.**
  //
  // `stdio: ['pipe','pipe','pipe','ipc','pipe']` gives the parent a fifth stream at
  // `child.stdio[4]`, and both `test-child-process-fork-stdio` and
  // `test-cluster-fork-stdio` read exactly that. Special-casing 1 and 2 answered
  // `stderr` for every other index, so slot 4 silently read slot 2 -- a wrong stream
  // rather than a missing one, which is the harder failure to see.
  const stream = which === 1 ? entry.child.stdout
    : which === 2 ? entry.child.stderr
    : entry.child.stdio?.[which];
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

globalThis.nts_child_process_write_slot = (handle, slot, bytes, done) => {
  const entry = live.get(handle);
  const stream = entry?.child.stdio?.[slot];
  // A slot the caller did not ask for as a pipe has no stream, and writing to it is the
  // caller's mistake rather than something to paper over.
  if (stream === undefined || stream === null || typeof stream.write !== "function") return -32;
  stream.write(Buffer.from(bytes), () => done(0));
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

globalThis.nts_child_process_fork = (execPath, args, env, cwd, silent, serialization, onExit, onMessage, onDisconnect, stdioSpec) => {
  const [, ...rest] = args;
  const modulePath = rest.shift();
  const options = { execPath, silent: silent !== 0, serialization };
  // **`stdio` when the caller gave one, because `silent` cannot say five slots.**
  //
  // `fork(file, args, { stdio: [0, 'ignore', 'pipe', 'ipc', 'pipe'] })` is a five-slot
  // child and this binding took only `silent`, so the host created three slots plus the
  // channel and fd 4 in the child was whatever happened to be there --
  // `Unsupported fd type: UNKNOWN` from `new net.Socket({ fd: 4 })`, thrown in the child,
  // where the parent only ever sees a non-zero exit code.
  if (stdioSpec !== null && stdioSpec !== undefined) {
    options.stdio = stdioSpec.map(hostStream);
  }
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
  child.on("message", (message, sent) => onMessage(message, sent));
  // **Both events, because the host already split them.** A message whose `cmd` begins
  // with `NODE_` never reaches the host's `message` event -- it is kept for
  // `internalMessage` -- so listening to one of the two loses every internal message,
  // which is the whole of cluster's handshake. The module re-applies the same test to
  // decide which of *its* events to emit.
  child.on("internalMessage", (message, sent) => onMessage(message, sent));
  // The channel closing from the child's own end, which nothing here called.
  if (typeof onDisconnect === "function") child.on("disconnect", () => onDisconnect());
  child.on("exit", (code, signal) => {
    onExit(code === null ? -1 : code, signal === null ? 0 : (hostSignalNumbers[signal] ?? 0));
  });
  return handle;
};

/**
 * Replace this profile's Buffers with the host's, throughout a structured value.
 *
 * v8's structured clone records a `Buffer` **subclass it does not know** as a plain
 * `Uint8Array`, and node's deserialiser re-wraps only its own. So
 * `send({ buffer: Buffer.from('Hello!') })` came back as `{ buffer: Uint8Array }` and
 * `test-child-process-advanced-serialization` fails its `deepStrictEqual` -- while `Map`,
 * `bigint` and the circular reference in the same message survive untouched, which is what
 * showed the channel was fine and the realm was not.
 *
 * Recognising one of ours: a `Uint8Array` that is **not** a host `Buffer` but whose constructor
 * is named `Buffer`. The two Buffer classes live in one realm here, so the name is the only
 * thing that separates them, and `Buffer.isBuffer` is the host's answer.
 *
 * The walk keeps a `Map` of what it has seen, because the test sends a value that contains
 * itself.
 */
function hostBuffers(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Uint8Array) {
    // **`HostBuffer`, imported explicitly, because the bare `Buffer` global may be ours.**
    //
    // This stand-in runs in the harness process, where the module under test is substituted. A
    // bare `Buffer.isBuffer(ourBuffer)` answered *true* and the conversion returned early, which
    // is why the round trip still produced a plain `Uint8Array` after the walk was written.
    if (HostBuffer.isBuffer(value)) return value;
    if (value.constructor?.name !== "Buffer") return value;
    const copy = HostBuffer.from(value);
    seen.set(value, copy);
    return copy;
  }
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const item of value) out.push(hostBuffers(item, seen));
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [k, v] of value) out.set(hostBuffers(k, seen), hostBuffers(v, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const v of value) out.add(hostBuffers(v, seen));
    return out;
  }
  // Anything with its own identity that structured clone preserves -- an Error, a Date, a
  // RegExp -- is left alone. Rebuilding those would change what the test compares.
  // **Every other typed array, and anything with a shape of its own, is left alone.**
  //
  // The generic rebuild below turns an object into a plain object, and a `Float64Array` rebuilt
  // that way becomes `{ '0': 3.141592653589793 }` -- which is what the first version of this
  // walk did, trading the Buffer failure for a Float64Array one. Structured clone already
  // round-trips these correctly; only our Buffer subclass needed help.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (value instanceof Error || value instanceof Date || value instanceof RegExp) return value;
  const out = {};
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = hostBuffers(value[key], seen);
  return out;
}

globalThis.nts_child_process_send = (handle, message, sent, options, callback) => {
  const entry = live.get(handle);
  if (entry === undefined) return -32;
  try {
    // `sent` is a socket or a server, and it crosses as itself: the host's own
    // `child.send(message, handle)` does the descriptor passing, which is a sendmsg
    // with SCM_RIGHTS and not something this stand-in should reimplement. It is also
    // the one argument here that has no representation in the compiled runtime, and
    // that is written down in the module beside the declaration rather than here.
    // `options` and `callback` are node's own -- `keepOpen` decides whether the host
    // closes its copy of a sent socket, and the callback fires when the host's queue
    // drains, which is knowledge only the host has. Both are forwarded rather than
    // interpreted here. Argument count matters: node reads a present third argument as
    // the options object, so the call is built from what is actually there.
    // Our Buffers become the host's before v8 sees them; see `hostBuffers`.
    message = hostBuffers(message);
    const rest = [];
    if (sent !== undefined && sent !== null) rest.push(hostHandle(sent));
    if (options !== undefined && options !== null) {
      if (rest.length === 0) rest.push(undefined);
      rest.push(options);
    }
    if (typeof callback === "function") rest.push(callback);
    if (rest.length > 0) return entry.child.send(message, ...rest) ? 0 : -32;
    return entry.child.send(message) ? 0 : -32;
  } catch {
    return -32;
  }
};

globalThis.nts_child_process_disconnect = (handle) => {
  const entry = live.get(handle);
  if (entry !== undefined && entry.child.connected) entry.child.disconnect();
};
