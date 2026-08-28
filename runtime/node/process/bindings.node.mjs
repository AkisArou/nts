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

globalThis.nts_process_env_set = (name, value) => { host.env[name] = value; };
globalThis.nts_process_env_delete = (name) => { delete host.env[name]; };
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
globalThis.nts_process_really_exit = (code) => host.reallyExit(code);

globalThis.nts_process_getuid = () => host.getuid();
globalThis.nts_process_getgid = () => host.getgid();
globalThis.nts_process_geteuid = () => host.geteuid();
globalThis.nts_process_getegid = () => host.getegid();
globalThis.nts_process_getgroups = () => host.getgroups();

// A name is passed as an empty string when the caller gave a number, because
// the seam carries two columns rather than a union: `setuid(0)` and
// `setuid("0")` are different requests, and a single argument would have to
// re-derive which one this was.
const byIdOrName = (call) => (id, name) => errnoOf(() => call(name === "" ? id : name));
globalThis.nts_process_setuid = byIdOrName((v) => host.setuid(v));
globalThis.nts_process_setgid = byIdOrName((v) => host.setgid(v));
globalThis.nts_process_seteuid = byIdOrName((v) => host.seteuid(v));
globalThis.nts_process_setegid = byIdOrName((v) => host.setegid(v));
globalThis.nts_process_setgroups = (ids, names) =>
  errnoOf(() => host.setgroups(ids.map((id, i) => (names[i] === "" ? id : names[i]))));
globalThis.nts_process_initgroups = (user, group) =>
  errnoOf(() => host.initgroups(user, group));

// Build metadata as JSON. Node keeps these as live objects; serializing and
// reparsing gives our module its own copy, which is what a compiled build
// would have -- and stops a test that mutates `process.config` from reaching
// through into node's.
globalThis.nts_process_metadata = (name) => JSON.stringify(host[name] ?? {});

globalThis.nts_process_active_resources = () => host.getActiveResourcesInfo();
globalThis.nts_process_active_handles = () => host._getActiveHandles();
globalThis.nts_process_active_requests = () => host._getActiveRequests();

// Node keeps this as a flag the C++ side reads when an exception escapes.
// There is nothing to tell node here -- its own `process` is not the one being
// asked -- so this records the intent and the uncaught path reads it.
let abortOnUncaught = true;
globalThis.nts_process_set_abort_on_uncaught = (value) => { abortOnUncaught = value; };
globalThis.nts_process_abort_on_uncaught = () => abortOnUncaught;

globalThis.nts_process_execve = (path, args, env) => host.execve(path, args,
  Object.fromEntries(env.map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)];
  })));
globalThis.nts_process_load_env_file = (path) => host.loadEnvFile(path);
globalThis.nts_process_raw_debug = (text) => host._rawDebug(text);

// The loop's lifecycle, forwarded from node's process to ours. In a compiled
// program these are the runtime noticing its own queues are empty; here node
// notices and we relay, so a listener on our process sees the same moment.
globalThis.nts_process_on_before_exit = (callback) => {
  host.on("beforeExit", callback);
};
globalThis.nts_process_on_exit = (callback) => {
  host.on("exit", callback);
};

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
