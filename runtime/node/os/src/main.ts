// `node:os`, from node v24.20.0 `lib/os.js`.
//
// Almost every function here is one libuv call and a shape around it, which is
// what node's `lib/os.js` is too: its C++ binding calls `uv_os_gethostname`,
// `uv_cpu_info`, `uv_interface_addresses`, and the JavaScript above assembles
// the result. The split is the same here; only the marshalling differs.
//
// Where node's binding returns one flat array of mixed strings and numbers --
// because that is what pushing into a `v8::Array` from C++ makes convenient --
// this declares one typed array per column. The assembled result is identical
// and the declarations are typed, which is the whole point of the exercise.

import { getCIDR } from "../../internal/net.ts";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../../internal/errors.ts";

// -------------------------------------------------------------- the bindings

declare function nts_os_hostname(): string;
declare function nts_os_type(): string;
declare function nts_os_release(): string;
declare function nts_os_version(): string;
declare function nts_os_machine(): string;
declare function nts_os_arch(): string;
declare function nts_os_platform(): string;
declare function nts_os_homedir(): string;
declare function nts_os_tmpdir(): string;
declare function nts_os_devnull(): string;
declare function nts_os_eol(): string;
declare function nts_os_endianness(): string;
declare function nts_os_uptime(): number;
declare function nts_os_totalmem(): number;
declare function nts_os_freemem(): number;
declare function nts_os_available_parallelism(): number;
declare function nts_os_loadavg(): number[];

declare function nts_os_cpu_models(): string[];
declare function nts_os_cpu_speeds(): number[];
/** Five per CPU, in `user, nice, sys, idle, irq` order. */
declare function nts_os_cpu_times(): number[];

declare function nts_os_if_names(): string[];
declare function nts_os_if_addresses(): string[];
declare function nts_os_if_netmasks(): string[];
declare function nts_os_if_families(): string[];
declare function nts_os_if_macs(): string[];
declare function nts_os_if_internal(): number[];
declare function nts_os_if_scopeids(): number[];

declare function nts_os_user_uid(): number;
declare function nts_os_user_gid(): number;
declare function nts_os_user_username(): string;
declare function nts_os_user_homedir(): string;
declare function nts_os_user_shell(): string;

declare function nts_os_constant_groups(): string[];
declare function nts_os_constant_names(): string[];
declare function nts_os_constant_values(): number[];

declare function nts_os_get_priority(pid: number): number;
declare function nts_os_set_priority(pid: number, priority: number): number;

// ----------------------------------------------------------------- the types

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface CpuInfo {
  model: string;
  speed: number;
  times: CpuTimes;
}

export interface NetworkInterfaceInfo {
  address: string;
  netmask: string;
  family: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
  scopeid?: number;
}

export interface UserInfo {
  uid: number;
  gid: number;
  username: string;
  homedir: string;
  shell: string | null;
}

// ------------------------------------------------------------- the functions

export function hostname(): string {
  return nts_os_hostname();
}

export function type(): string {
  return nts_os_type();
}

export function release(): string {
  return nts_os_release();
}

export function version(): string {
  return nts_os_version();
}

export function machine(): string {
  return nts_os_machine();
}

export function arch(): string {
  return nts_os_arch();
}

export function platform(): string {
  return nts_os_platform();
}

export function homedir(): string {
  return nts_os_homedir();
}

/** Upstream `lib/os.js:181`. The posix branch; Windows consults `%TEMP%`. */
export function tmpdir(): string {
  return nts_os_tmpdir() || "/tmp";
}

export function endianness(): string {
  return nts_os_endianness();
}

export function uptime(): number {
  return nts_os_uptime();
}

export function totalmem(): number {
  return nts_os_totalmem();
}

export function freemem(): number {
  return nts_os_freemem();
}

export function availableParallelism(): number {
  return nts_os_available_parallelism();
}

/** Upstream `lib/os.js:121`. One-, five- and fifteen-minute averages. */
export function loadavg(): number[] {
  const values = nts_os_loadavg();
  return [values[0]!, values[1]!, values[2]!];
}

/** Upstream `lib/os.js:141`. */
export function cpus(): CpuInfo[] {
  const models = nts_os_cpu_models();
  const speeds = nts_os_cpu_speeds();
  const times = nts_os_cpu_times();
  const result: CpuInfo[] = [];
  for (let i = 0; i < models.length; i++) {
    result.push({
      model: models[i]!,
      speed: speeds[i]!,
      times: {
        user: times[i * 5]!,
        nice: times[i * 5 + 1]!,
        sys: times[i * 5 + 2]!,
        idle: times[i * 5 + 3]!,
        irq: times[i * 5 + 4]!,
      },
    });
  }
  return result;
}

/** Upstream `lib/os.js:217`. */
export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
  const names = nts_os_if_names();
  const addresses = nts_os_if_addresses();
  const netmasks = nts_os_if_netmasks();
  const families = nts_os_if_families();
  const macs = nts_os_if_macs();
  const internal = nts_os_if_internal();
  const scopeids = nts_os_if_scopeids();

  const result: Record<string, NetworkInterfaceInfo[]> = {};
  for (let i = 0; i < names.length; i++) {
    const address = addresses[i]!;
    const netmask = netmasks[i]!;
    const family = families[i]!;
    const entry: NetworkInterfaceInfo = {
      address,
      netmask,
      family,
      mac: macs[i]!,
      internal: internal[i] !== 0,
      cidr: getCIDR(address, netmask, family),
    };
    // A scope id of -1 means the address has none; node omits the key rather
    // than reporting a sentinel.
    const scopeid = scopeids[i]!;
    if (scopeid !== -1) {
      entry.scopeid = scopeid;
    }

    const name = names[i]!;
    const existing = result[name];
    if (existing !== undefined) {
      existing.push(entry);
    } else {
      result[name] = [entry];
    }
  }
  return result;
}

/** Upstream `lib/os.js:298`. */
export function userInfo(): UserInfo {
  const shell = nts_os_user_shell();
  return {
    uid: nts_os_user_uid(),
    gid: nts_os_user_gid(),
    username: nts_os_user_username(),
    homedir: nts_os_user_homedir(),
    // Node reports `null` where the platform has no shell for the user, which
    // is Windows and an empty entry in the passwd database.
    shell: shell.length > 0 ? shell : null,
  };
}

/** `validateInt32`, node `lib/internal/validators.js`. */
function validateInt32(value: number, name: string, min = -2147483648, max = 2147483647): void {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
}

/** Upstream `lib/os.js:271`. `pid` of 0 means the calling process. */
export function getPriority(pid = 0): number {
  validateInt32(pid, "pid");
  return nts_os_get_priority(pid);
}

/** Upstream `lib/os.js:252`. Nice values run -20 (highest) to 19 (lowest). */
export function setPriority(pid: number, priority?: number): void {
  if (priority === undefined) {
    priority = pid;
    pid = 0;
  }
  validateInt32(pid, "pid");
  validateInt32(priority, "priority", -20, 19);
  nts_os_set_priority(pid, priority);
}

// Node makes these functions stringify to their own result, so `${os.hostname}`
// is the hostname rather than the source of a function. Upstream
// `lib/os.js:104`: `getHostname[SymbolToPrimitive] = () => getHostname()`.
//
// It has to be a property on the function object, which is why this is a loop
// over pairs rather than a decoration on each declaration.
const stringifiesToItsResult: Array<[() => string | number, string]> = [
  [hostname, "hostname"],
  [type, "type"],
  [release, "release"],
  [version, "version"],
  [machine, "machine"],
  [arch, "arch"],
  [platform, "platform"],
  [homedir, "homedir"],
  [tmpdir, "tmpdir"],
  [endianness, "endianness"],
  [uptime, "uptime"],
  [totalmem, "totalmem"],
  [freemem, "freemem"],
  [availableParallelism, "availableParallelism"],
];

for (const [fn] of stringifiesToItsResult) {
  Object.defineProperty(fn, Symbol.toPrimitive, {
    value: () => fn(),
  });
}

export const EOL = nts_os_eol();
export const devNull = nts_os_devnull();

/**
 * `os.constants`, node `src/node_constants.cc`.
 *
 * Grouped exactly as node groups them. The values come from the platform's own
 * headers through the binding rather than being written down here, because
 * they differ by platform -- `SIGUSR1` is 10 on Linux and 30 on macOS -- and a
 * transcribed table would be right on one and silently wrong on the other.
 */
export interface OsConstants {
  signals: Record<string, number>;
  errno: Record<string, number>;
  priority: Record<string, number>;
  dlopen: Record<string, number>;
}

function readConstants(): OsConstants {
  const groups = nts_os_constant_groups();
  const names = nts_os_constant_names();
  const values = nts_os_constant_values();
  const out: OsConstants = { signals: {}, errno: {}, priority: {}, dlopen: {} };
  for (let i = 0; i < names.length; i++) {
    const group = groups[i]!;
    const table =
      group === "signals" ? out.signals
      : group === "errno" ? out.errno
      : group === "priority" ? out.priority
      : out.dlopen;
    table[names[i]!] = values[i]!;
  }
  return out;
}

export const constants: OsConstants = readConstants();
