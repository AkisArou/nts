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
import { systemError } from "../../internal/uv.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { normalizeEncodingName, type Encoding } from "../../buffer/src/encodings.ts";

// -------------------------------------------------------------- the bindings

declare function nts_os_hostname(): string;
/** Uname fields plus target architecture, platform, and byte order. */
declare function nts_os_static_information(): [
  string,
  string,
  string,
  string,
  Architecture,
  Platform,
  "BE" | "LE",
];
declare function nts_os_homedir(): string;
declare function nts_os_tmpdir(): string;
declare function nts_os_uptime(): number;
declare function nts_os_totalmem(): number;
declare function nts_os_freemem(): number;
declare function nts_os_available_parallelism(): number;
declare function nts_os_loadavg(): [number, number, number];

/** Models plus six numeric columns per CPU: speed, user, nice, sys, idle, irq. */
declare function nts_os_cpus(): [string[], number[]];

/** Names, addresses, netmasks, families, MACs, internal flags, and scope ids. */
declare function nts_os_network_interfaces(): [
  string[],
  string[],
  string[],
  string[],
  string[],
  number[],
  number[],
];

/** Numeric identity plus raw username, home-directory, and shell bytes. */
declare function nts_os_user_info(): [number[], number[], number[], number[]];

declare function nts_os_constants(): [string[], string[], number[]];
declare function nts_os_udp_reuseaddr(): number;

declare function nts_os_get_priority(pid: number): number;
declare function nts_os_set_priority(pid: number, priority: number): number;
declare function nts_errno(): number;

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

export type Architecture =
  | "arm"
  | "arm64"
  | "ia32"
  | "loong64"
  | "mips"
  | "mipsel"
  | "ppc64"
  | "riscv64"
  | "s390x"
  | "x64";

export type Platform =
  | "aix"
  | "android"
  | "cygwin"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "netbsd"
  | "openbsd"
  | "sunos"
  | "win32";

export interface NetworkInterfaceBase {
  address: string;
  netmask: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
  scopeid?: number;
}

export interface NetworkInterfaceInfoIPv4 extends NetworkInterfaceBase {
  family: "IPv4";
}

export interface NetworkInterfaceInfoIPv6 extends NetworkInterfaceBase {
  family: "IPv6";
  scopeid: number;
}

export type NetworkInterfaceInfo = NetworkInterfaceInfoIPv4 | NetworkInterfaceInfoIPv6;

export interface NetworkInterfaceMap {
  [name: string]: NetworkInterfaceInfo[] | undefined;
}

export interface UserInfo<T> {
  uid: number;
  gid: number;
  username: T;
  homedir: T;
  shell: T | null;
}

export interface UserInfoOptions {
  encoding?: Encoding | "buffer";
}

export interface UserInfoOptionsWithBufferEncoding extends UserInfoOptions {
  encoding: "buffer";
}

export interface UserInfoOptionsWithStringEncoding extends UserInfoOptions {
  encoding?: Encoding;
}

// ------------------------------------------------------------- the functions

export function hostname(): string {
  const value = nts_os_hostname();
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_os_gethostname");
  return value;
}

// Node snapshots `getOSInformation()` once when `lib/os.js` initializes.
// These public functions return that immutable data without another native
// transition or another `uv_os_uname` call.
const osInformation = nts_os_static_information();
const osType = osInformation[0];
const osVersion = osInformation[1];
const osRelease = osInformation[2];
const osMachine = osInformation[3];
const architecture = osInformation[4];
const operatingPlatform = osInformation[5];
const byteOrder = osInformation[6];

export function type(): string {
  return osType;
}

export function release(): string {
  return osRelease;
}

export function version(): string {
  return osVersion;
}

export function machine(): string {
  return osMachine;
}

export function arch(): Architecture {
  return architecture;
}

export function platform(): Platform {
  return operatingPlatform;
}

export function homedir(): string {
  const value = nts_os_homedir();
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_os_homedir");
  return value;
}

/** Upstream `lib/os.js:181`. The posix branch; Windows consults `%TEMP%`. */
export function tmpdir(): string {
  const value = nts_os_tmpdir();
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_os_tmpdir");
  return value || "/tmp";
}

export function endianness(): "BE" | "LE" {
  return byteOrder;
}

export function uptime(): number {
  const value = nts_os_uptime();
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_uptime");
  return value;
}

export const totalmem = nts_os_totalmem;
export const freemem = nts_os_freemem;
export const availableParallelism = nts_os_available_parallelism;

/** Upstream `lib/os.js:121`. One-, five- and fifteen-minute averages. */
export const loadavg = nts_os_loadavg;

/** Upstream `lib/os.js:141`. */
export function cpus(): CpuInfo[] {
  const columns = nts_os_cpus();
  const models = columns[0];
  const values = columns[1];
  const result = new Array<CpuInfo>(models.length);
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const speed = values[i * 6];
    const user = values[i * 6 + 1];
    const nice = values[i * 6 + 2];
    const sys = values[i * 6 + 3];
    const idle = values[i * 6 + 4];
    const irq = values[i * 6 + 5];
    if (
      model === undefined ||
      speed === undefined ||
      user === undefined ||
      nice === undefined ||
      sys === undefined ||
      idle === undefined ||
      irq === undefined
    ) {
      throw new Error(`incomplete native CPU record at index ${i}`);
    }
    result[i] = {
      model,
      speed,
      times: {
        user,
        nice,
        sys,
        idle,
        irq,
      },
    };
  }
  return result;
}

/** Upstream `lib/os.js:217`. */
export function networkInterfaces(): NetworkInterfaceMap {
  const columns = nts_os_network_interfaces();
  const names = columns[0];
  const addresses = columns[1];
  const netmasks = columns[2];
  const families = columns[3];
  const macs = columns[4];
  const internal = columns[5];
  const scopeids = columns[6];
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_interface_addresses");

  const result: NetworkInterfaceMap = {};
  const counts = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === undefined) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    result[name] = new Array<NetworkInterfaceInfo>(count);
  }

  const positions = new Map<string, number>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const address = addresses[i];
    const netmask = netmasks[i];
    const family = families[i];
    const mac = macs[i];
    const internalFlag = internal[i];
    const scopeid = scopeids[i];
    if (
      name === undefined ||
      address === undefined ||
      netmask === undefined ||
      family === undefined ||
      mac === undefined ||
      internalFlag === undefined ||
      scopeid === undefined
    ) {
      throw new Error(`incomplete native network-interface record at index ${i}`);
    }
    let entry: NetworkInterfaceInfo;
    if (family === "IPv4") {
      entry = {
        address,
        netmask,
        family,
        mac,
        internal: internalFlag !== 0,
        cidr: getCIDR(address, netmask, family),
      };
    } else if (family === "IPv6") {
      entry = {
        address,
        netmask,
        family,
        mac,
        internal: internalFlag !== 0,
        cidr: getCIDR(address, netmask, family),
        scopeid,
      };
    } else {
      throw new Error(`unknown native network-interface family ${family}`);
    }

    const list = result[name];
    const position = positions.get(name) ?? 0;
    if (list === undefined) throw new Error(`missing network-interface group ${name}`);
    list[position] = entry;
    positions.set(name, position + 1);
  }
  return result;
}

function userInfoString(bytes: number[], encoding: Encoding): string {
  return Buffer.from(bytes).toString(encoding);
}

/**
 * Upstream `lib/os.js:298` and `src/node_os.cc:GetUserInfo`.
 *
 * Node gives this record a null prototype. Prototype observation is a §13
 * non-goal; the supported data contract is represented by `UserInfo<T>`'s
 * five statically typed fields.
 */
export function userInfo(options?: UserInfoOptionsWithStringEncoding): UserInfo<string>;
export function userInfo(options: UserInfoOptionsWithBufferEncoding): UserInfo<Buffer>;
export function userInfo(options: UserInfoOptions): UserInfo<string | Buffer>;
export function userInfo(options?: UserInfoOptions): UserInfo<string | Buffer> {
  const columns = nts_os_user_info();
  const identity = columns[0];
  const usernameBytes = columns[1];
  const homedirBytes = columns[2];
  const shellBytes = columns[3];
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_os_get_passwd");

  const uid = identity[0];
  const gid = identity[1];
  const hasShell = identity[2];
  if (uid === undefined || gid === undefined || hasShell === undefined) {
    throw new Error("incomplete native user-info identity");
  }

  if (options?.encoding === "buffer") {
    return {
      uid,
      gid,
      username: Buffer.from(usernameBytes),
      homedir: Buffer.from(homedirBytes),
      shell: hasShell !== 0 ? Buffer.from(shellBytes) : null,
    };
  }

  const requestedEncoding = options?.encoding;
  const encoding =
    requestedEncoding === undefined ? "utf8" : (normalizeEncodingName(requestedEncoding) ?? "utf8");
  return {
    uid,
    gid,
    username: userInfoString(usernameBytes, encoding),
    homedir: userInfoString(homedirBytes, encoding),
    shell: hasShell !== 0 ? userInfoString(shellBytes, encoding) : null,
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
  const priority = nts_os_get_priority(pid);
  const errno = nts_errno();
  if (errno !== 0) throw systemError(-errno, "uv_os_getpriority");
  return priority;
}

/** Upstream `lib/os.js:252`. Nice values run -20 (highest) to 19 (lowest). */
export function setPriority(priority: number): void;
export function setPriority(pid: number, priority: number): void;
export function setPriority(pid: number, priority?: number): void {
  if (priority === undefined) {
    priority = pid;
    pid = 0;
  }
  validateInt32(pid, "pid");
  validateInt32(priority, "priority", -20, 19);
  const status = nts_os_set_priority(pid, priority);
  if (status !== 0) throw systemError(status, "uv_os_setpriority");
}

// The values are static data. Their CommonJS read-only descriptors are public
// object shaping and stay in `shape.mjs` rather than this typed module.
export const EOL = operatingPlatform === "win32" ? "\r\n" : "\n";
export const devNull = operatingPlatform === "win32" ? "\\\\.\\nul" : "/dev/null";

/**
 * `os.constants`, node `src/node_constants.cc`.
 *
 * Grouped exactly as node groups them. The values come from the platform's own
 * headers through the binding rather than being written down here, because
 * they differ by platform -- `SIGUSR1` is 10 on Linux and 30 on macOS -- and a
 * transcribed table would be right on one and silently wrong on the other.
 */
export interface OsConstants {
  UV_UDP_REUSEADDR: number;
  signals: Record<string, number>;
  errno: Record<string, number>;
  priority: Record<string, number>;
  dlopen: Record<string, number>;
}

function readConstants(): OsConstants {
  const columns = nts_os_constants();
  const groups = columns[0];
  const names = columns[1];
  const values = columns[2];
  const out: OsConstants = {
    UV_UDP_REUSEADDR: nts_os_udp_reuseaddr(),
    signals: {},
    errno: {},
    priority: {},
    dlopen: {},
  };
  for (let i = 0; i < names.length; i++) {
    const group = groups[i];
    const name = names[i];
    const value = values[i];
    if (group === undefined || name === undefined || value === undefined) {
      throw new Error(`incomplete native OS constant record at index ${i}`);
    }
    let table: Record<string, number>;
    switch (group) {
      case "signals":
        table = out.signals;
        break;
      case "errno":
        table = out.errno;
        break;
      case "priority":
        table = out.priority;
        break;
      case "dlopen":
        table = out.dlopen;
        break;
      default:
        throw new Error(`unknown native OS constant group ${group}`);
    }
    table[name] = value;
  }
  return out;
}

export const constants: OsConstants = readConstants();
