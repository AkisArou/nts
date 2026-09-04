// The native half of `node:process`, for the node-side run only.
//
// Almost every one of these is a system call in the compiled runtime and is
// node's own here. The interesting ones are the failures: node's `process`
// throws where the compiled binding returns an errno, so the wrappers below
// catch and hand back `err.errno`, which is libuv's negative code and what
// `uvException` expects.
//
// Node's own `process` is captured before ours replaces the global, for the
// same reason `node:timers` captures its scheduling functions: otherwise the
// module would be built on itself.
import "../internal/bindings.node.mjs";
// The implementation reads its signal table from `node:os` and its emitter
// from `node:events`, so both native halves have to be present before this
// module is evaluated. A dependency of the implementation belongs here rather
// than in `uses`, which is about test-visible shared state.
import "../os/bindings.node.mjs";
import "../events/bindings.node.mjs";
import host from "node:process";

// The runner itself owns its stdout/stderr pipes. Node's upstream process
// tests run without those harness-only resources and compare exact counts, so
// remember what existed before the test and remove only those initial counts
// from the stand-in's answer. Resources created by the test remain visible.
const initialResourceCounts = new Map();
for (const name of host.getActiveResourcesInfo()) {
  initialResourceCounts.set(name, (initialResourceCounts.get(name) ?? 0) + 1);
}

const resourcesAfterHarness = () => {
  const remainingInitial = new Map(initialResourceCounts);
  return host.getActiveResourcesInfo().filter((name) => {
    const remaining = remainingInitial.get(name) ?? 0;
    if (remaining === 0) return true;
    remainingInitial.set(name, remaining - 1);
    return false;
  });
};

/** Run a node call that throws, and report libuv's errno instead. */
const errnoOf = (fn) => {
  try {
    fn();
    return 0;
  } catch (e) {
    // `errno` is absent on a few of node's own argument errors, which are not
    // system failures. `-1` is EPERM's neighbour and wrong, so those rethrow:
    // a bad argument is the caller's bug, not the kernel's answer.
    if (typeof e?.errno !== "number") throw e;
    // Negative, because that is libuv's convention and what `uvException`
    // decodes. Node is not consistent about which it hands back: `fs` errors
    // carry libuv's negative code, while the credential calls come from a
    // different C++ path and carry a positive `errno(3)` value -- `EPERM` as
    // `1` rather than `-1`. Read as-is, that decoded to `UNKNOWN`.
    return e.errno > 0 ? -e.errno : e.errno;
  }
};

globalThis.nts_process_ppid = () => host.ppid;
globalThis.nts_process_arch = () => host.arch;
globalThis.nts_process_argv = () => host.argv.slice();
globalThis.nts_process_argv0 = () => host.argv0;
globalThis.nts_process_exec_path = () => host.execPath;
globalThis.nts_process_exec_argv = () => host.execArgv.slice();
globalThis.nts_process_version = () => host.version;
globalThis.nts_process_version_names = () => Object.keys(host.versions);
globalThis.nts_process_version_values = () => Object.values(host.versions);
globalThis.nts_process_title = () => host.title;
globalThis.nts_process_set_title = (title) => { host.title = title; };
globalThis.nts_process_allowed_env_flags = () => [...host.allowedNodeEnvironmentFlags];

globalThis.nts_process_env_keys = () => Object.keys(host.env);

globalThis.nts_process_uptime = () => host.uptime();
globalThis.nts_process_cpu_usage = () => {
  const { user, system } = host.cpuUsage();
  return [user, system];
};
globalThis.nts_process_thread_cpu_usage = () => {
  const { user, system } = host.threadCpuUsage();
  return [user, system];
};
globalThis.nts_process_memory_usage = () => {
  const m = host.memoryUsage();
  return [m.rss, m.heapTotal, m.heapUsed, m.external, m.arrayBuffers];
};
globalThis.nts_process_rss = () => host.memoryUsage.rss();
globalThis.nts_process_resource_usage = () => {
  const r = host.resourceUsage();
  return [
    r.userCPUTime, r.systemCPUTime, r.maxRSS, r.sharedMemorySize,
    r.unsharedDataSize, r.unsharedStackSize, r.minorPageFault, r.majorPageFault,
    r.swappedOut, r.fsRead, r.fsWrite, r.ipcSent, r.ipcReceived,
    r.signalsCount, r.voluntaryContextSwitches, r.involuntaryContextSwitches,
  ];
};
globalThis.nts_process_available_memory = () => host.availableMemory();
globalThis.nts_process_constrained_memory = () => host.constrainedMemory();

globalThis.nts_process_chdir = (directory) => errnoOf(() => host.chdir(directory));
globalThis.nts_process_umask = (mask) => host.umask(mask);
globalThis.nts_process_umask_read = () => host.umask();
globalThis.nts_process_kill = (pid, signal) => host._kill(pid, signal);
globalThis.nts_process_abort = () => host.abort();

globalThis.nts_process_getuid = () => host.getuid();
globalThis.nts_process_getgid = () => host.getgid();
globalThis.nts_process_geteuid = () => host.geteuid();
globalThis.nts_process_getegid = () => host.getegid();
globalThis.nts_process_getgroups = () => host.getgroups();

// A name is passed as an empty string when the caller gave a number, because
// the seam carries two columns rather than a union: `setuid(0)` and
// `setuid("0")` are different requests, and a single argument would have to
// re-derive which one this was.
const byIdOrName = (call) => (id, name) => {
  try {
    call(name === "" ? id : name);
    return 0;
  } catch (e) {
    if (e?.code === "ERR_UNKNOWN_CREDENTIAL") return 1;
    if (typeof e?.errno !== "number") throw e;
    return e.errno > 0 ? -e.errno : e.errno;
  }
};
globalThis.nts_process_setuid = byIdOrName((v) => host.setuid(v));
globalThis.nts_process_setgid = byIdOrName((v) => host.setgid(v));
globalThis.nts_process_seteuid = byIdOrName((v) => host.seteuid(v));
globalThis.nts_process_setegid = byIdOrName((v) => host.setegid(v));
globalThis.nts_process_setgroups = (ids, names) => {
  const groups = ids.map((id, i) => (names[i] === "" ? id : names[i]));
  try {
    host.setgroups(groups);
    return 0;
  } catch (e) {
    if (e?.code === "ERR_UNKNOWN_CREDENTIAL") {
      const message = String(e.message);
      const index = groups.findIndex((group) => message.endsWith(`: ${group}`));
      // The host names the missing group in the error. If its wording ever
      // changes, returning the first column still preserves the protocol and
      // makes the mismatch visible in the TypeScript error assertion.
      return index < 0 ? 1 : index + 1;
    }
    if (typeof e?.errno !== "number") throw e;
    return e.errno > 0 ? -e.errno : e.errno;
  }
};
globalThis.nts_process_initgroups = (userId, userName, groupId, groupName) => {
  const user = userName === "" ? userId : userName;
  const group = groupName === "" ? groupId : groupName;
  try {
    host.initgroups(user, group);
    return 0;
  } catch (e) {
    if (e?.code === "ERR_UNKNOWN_CREDENTIAL") {
      return String(e.message).startsWith("User ") ? 1 : 2;
    }
    if (typeof e?.errno !== "number") throw e;
    return e.errno > 0 ? -e.errno : e.errno;
  }
};

// Build metadata as JSON. Node keeps these as live objects; serializing and
// reparsing gives our module its own copy, which is what a compiled build
// would have -- and stops a test that mutates `process.config` from reaching
// through into node's.
globalThis.nts_process_metadata = (name) => JSON.stringify(host[name] ?? {});

globalThis.nts_process_active_resources = resourcesAfterHarness;
globalThis.nts_process_active_handles = () => host._getActiveHandles();
globalThis.nts_process_active_requests = () => host._getActiveRequests();

globalThis.nts_process_execve = (path, args, env) => host.execve(path, args,
  Object.fromEntries(env.map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)];
  })));
globalThis.nts_process_load_env_file = (path) => errnoOf(() => host.loadEnvFile(path));
globalThis.nts_process_raw_debug = (text) => host._rawDebug(text);

// The loop's lifecycle, forwarded from node's process to ours. In a compiled
// program these are the runtime noticing its own queues are empty; here node
// notices and we relay, so a listener on our process sees the same moment.
globalThis.nts_process_on_before_exit = (callback) => {
  host.on("beforeExit", callback);
};
globalThis.nts_process_on_exit = (callback) => {
  // The conformance runner also grades from an exit listener, registered
  // before this module is imported. The runtime's lifecycle delivery must
  // happen before that grading listener, just as it happens before a real
  // program has finished exiting.
  host.prependListener("exit", (code) => {
    callback(code);
    // In this lane our process object is hosted inside node. Propagate an exit
    // listener's final choice back to the host so the child has the status the
    // process under test selected. A compiled program owns that status itself.
    if (globalThis.process?.exitCode !== undefined) {
      host.exitCode = globalThis.process.exitCode;
    }
  });
};

// Exceptions that leave a host timer callback and promise rejections with no
// user handler arrive at Node's process object. The tests, however, listen on
// the process implementation installed by this profile. Relay those runtime
// escape points into its ordinary `_fatalException` algorithm. This is only
// transport: monitor/capture/event ordering remains in typed source.
const installedProcess = () => {
  const candidate = globalThis.process;
  if (candidate === host || typeof candidate?._fatalException !== "function") return null;
  return candidate;
};

host.on("uncaughtException", (error, origin) => {
  const target = installedProcess();
  if (target === null || !target._fatalException(error, origin === "unhandledRejection")) {
    throw error;
  }
});

host.on("unhandledRejection", (reason, promise) => {
  const target = installedProcess();
  if (target === null) throw reason;
  if (!target.emit("unhandledRejection", reason, promise) &&
      !target._fatalException(reason, true)) {
    throw reason;
  }
});

// The tick queue's exception path.
//
// A callback that throws from inside a tick does not unwind to anything -- the
// stack above it is the runtime's. Node catches it there and hands it to
// `process`, which is how `process.on('uncaughtException')` sees an error
// raised in a `nextTick`. Node's own queue would hand it to node's `process`,
// which is not the object the test is listening on, so the routing is
// redefined here.
//
// Only in this module's bindings, which are only loaded when `node:process` is
// the subject: `internal/bindings.node.mjs` keeps the plain forwarding, so
// every other module's ticks reach the callback with no frame in between.
const plainNextTick = globalThis.nts_next_tick;
globalThis.nts_next_tick = (callback, args) => {
  plainNextTick((...received) => {
    try {
      callback(...received);
    } catch (e) {
      // Rethrown when nothing took it, so an unhandled error is still fatal.
      if (!globalThis.process?._fatalException?.(e)) throw e;
    }
  }, args);
};
