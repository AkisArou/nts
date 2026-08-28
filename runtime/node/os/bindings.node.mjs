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

globalThis.nts_os_hostname = () => os.hostname();
globalThis.nts_os_type = () => os.type();
globalThis.nts_os_release = () => os.release();
globalThis.nts_os_version = () => os.version();
globalThis.nts_os_machine = () => os.machine();
globalThis.nts_os_arch = () => process.arch;
globalThis.nts_os_platform = () => process.platform;
globalThis.nts_os_homedir = () => os.homedir();
globalThis.nts_os_tmpdir = () => os.tmpdir();
globalThis.nts_os_devnull = () => os.devNull;
globalThis.nts_os_eol = () => os.EOL;
globalThis.nts_os_endianness = () => os.endianness();
globalThis.nts_os_uptime = () => os.uptime();
globalThis.nts_os_totalmem = () => os.totalmem();
globalThis.nts_os_freemem = () => os.freemem();
globalThis.nts_os_available_parallelism = () => os.availableParallelism();
globalThis.nts_os_loadavg = () => os.loadavg();

globalThis.nts_os_cpu_models = () => os.cpus().map((c) => c.model);
globalThis.nts_os_cpu_speeds = () => os.cpus().map((c) => c.speed);
globalThis.nts_os_cpu_times = () =>
  os.cpus().flatMap((c) => [c.times.user, c.times.nice, c.times.sys, c.times.idle, c.times.irq]);

// One snapshot, read column by column -- the same reason the C keeps one.
const interfaces = () =>
  Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).map((e) => ({ name, ...e })));
globalThis.nts_os_if_names = () => interfaces().map((e) => e.name);
globalThis.nts_os_if_addresses = () => interfaces().map((e) => e.address);
globalThis.nts_os_if_netmasks = () => interfaces().map((e) => e.netmask);
globalThis.nts_os_if_families = () => interfaces().map((e) => e.family);
globalThis.nts_os_if_macs = () => interfaces().map((e) => e.mac);
globalThis.nts_os_if_internal = () => interfaces().map((e) => (e.internal ? 1 : 0));
globalThis.nts_os_if_scopeids = () => interfaces().map((e) => e.scopeid ?? -1);

const user = os.userInfo();
globalThis.nts_os_user_uid = () => user.uid;
globalThis.nts_os_user_gid = () => user.gid;
globalThis.nts_os_user_username = () => user.username;
globalThis.nts_os_user_homedir = () => user.homedir;
globalThis.nts_os_user_shell = () => user.shell ?? "";

globalThis.nts_os_get_priority = (pid) => os.getPriority(pid);
globalThis.nts_os_set_priority = (pid, priority) => {
  os.setPriority(pid, priority);
  return 0;
};

// `os.constants` as three columns, from node's own table.
const flat = Object.entries(os.constants).flatMap(([group, table]) =>
  Object.entries(table).map(([name, value]) => ({ group, name, value })));
globalThis.nts_os_constant_groups = () => flat.map((c) => c.group);
globalThis.nts_os_constant_names = () => flat.map((c) => c.name);
globalThis.nts_os_constant_values = () => flat.map((c) => c.value);
