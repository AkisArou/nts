// The native half of `node:os`, for the node-side run only.
//
// Each stand-in answers with what node's own binding answers, which is the
// point: the TypeScript above assembles the result, and this only supplies the
// columns. Where node exposes the same libuv call through its own `os` module
// we use it, so a disagreement here is a disagreement about assembly rather
// than about the syscall.
import "../internal/bindings.node.mjs";
import os from "node:os";
import process from "node:process";

let errno = 0;
globalThis.nts_errno = () => errno;

function errnoOf(error) {
  const value = error?.errno;
  return typeof value === "number" ? Math.abs(value) : 1;
}

function attempt(operation, fallback) {
  try {
    const value = operation();
    errno = 0;
    return value;
  } catch (error) {
    errno = errnoOf(error);
    return fallback;
  }
}

globalThis.nts_os_hostname = () => attempt(() => os.hostname(), "");
globalThis.nts_os_static_information = () => [
  os.type(),
  os.version(),
  os.release(),
  os.machine(),
  process.arch,
  process.platform,
  os.endianness(),
];
globalThis.nts_os_homedir = () => attempt(() => os.homedir(), "");
globalThis.nts_os_tmpdir = () => attempt(() => os.tmpdir(), "");
globalThis.nts_os_uptime = () => attempt(() => os.uptime(), 0);
globalThis.nts_os_totalmem = () => os.totalmem();
globalThis.nts_os_freemem = () => os.freemem();
globalThis.nts_os_available_parallelism = () => os.availableParallelism();
globalThis.nts_os_loadavg = () => os.loadavg();

globalThis.nts_os_cpus = () => {
  const snapshot = os.cpus();
  return [
    snapshot.map((cpu) => cpu.model),
    snapshot.flatMap((cpu) => [
      cpu.speed,
      cpu.times.user,
      cpu.times.nice,
      cpu.times.sys,
      cpu.times.idle,
      cpu.times.irq,
    ]),
  ];
};

const interfaces = () =>
  Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).map((e) => ({ name, ...e })),
  );
globalThis.nts_os_network_interfaces = () =>
  attempt(() => {
    const snapshot = interfaces();
    return [
      snapshot.map((entry) => entry.name),
      snapshot.map((entry) => entry.address),
      snapshot.map((entry) => entry.netmask),
      snapshot.map((entry) => entry.family),
      snapshot.map((entry) => entry.mac),
      snapshot.map((entry) => (entry.internal ? 1 : 0)),
      snapshot.map((entry) => entry.scopeid ?? -1),
    ];
  }, [[], [], [], [], [], [], []]);

globalThis.nts_os_user_info = () =>
  attempt(() => {
    const user = os.userInfo({ encoding: "buffer" });
    return [
      [user.uid, user.gid, user.shell === null ? 0 : 1],
      Array.from(user.username),
      Array.from(user.homedir),
      user.shell === null ? [] : Array.from(user.shell),
    ];
  }, [[], [], [], []]);

globalThis.nts_os_get_priority = (pid) => attempt(() => os.getPriority(pid), 0);
globalThis.nts_os_set_priority = (pid, priority) => {
  try {
    os.setPriority(pid, priority);
    errno = 0;
    return 0;
  } catch (error) {
    errno = errnoOf(error);
    return -errno;
  }
};

// The four nested `os.constants` tables as three columns. The top-level UDP
// flag has its own scalar binding below.
const flat = ["dlopen", "errno", "signals", "priority"].flatMap((group) =>
  Object.entries(os.constants[group]).map(([name, value]) => ({ group, name, value })),
);
globalThis.nts_os_constants = () => [
  flat.map((constant) => constant.group),
  flat.map((constant) => constant.name),
  flat.map((constant) => constant.value),
];
globalThis.nts_os_udp_reuseaddr = () => os.constants.UV_UDP_REUSEADDR;
