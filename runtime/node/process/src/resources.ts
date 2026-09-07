// What the process is spending, from node v24.20.0
// `lib/internal/process/per_thread.js`.
//
// Every one of these is a libuv call and a reshaping. Node passes a
// preallocated `Float64Array` down to C++ and reads the columns back out,
// because these are called in hot measurement loops and an array plus the
// public record per call would make the measurement APIs needlessly measure
// the allocator. The same shape is here: module-owned tuples cross the native
// seam as output buffers, while only the public result record is allocated.

import {
  ERR_INVALID_ARG_VALUE_RANGE,
  ERR_OPERATION_FAILED,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { uvException } from "../../internal/uv.ts";
import { validateArray, validateNumber, validateObject } from "../../internal/validators.ts";
import type { Platform } from "../../os/src/main.ts";

declare function nts_hrtime_ns(): bigint;
declare function nts_platform(): Platform;
/** Seconds since the process started, fractional. */
declare function nts_process_uptime(): number;
/** Fill `[user, system]` with microseconds of CPU time; return a libuv errno. */
declare function nts_process_cpu_usage(values: CpuValues): number;
declare function nts_process_thread_cpu_usage(values: CpuValues): number;
/** Fill `[rss, heapTotal, heapUsed, external, arrayBuffers]`; return an errno. */
declare function nts_process_memory_usage(values: MemoryValues): number;
/** Fill the single RSS value; return a libuv errno. */
declare function nts_process_rss(values: RssValues): number;
/** Fill the sixteen `uv_getrusage` columns below; return a libuv errno. */
declare function nts_process_resource_usage(values: ResourceValues): number;
declare function nts_process_available_memory(): number;
declare function nts_process_constrained_memory(): number;

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const platform = nts_platform();

type CpuValues = [user: number, system: number];
type RssValues = [rss: number];
type MemoryValues = [
  rss: number,
  heapTotal: number,
  heapUsed: number,
  external: number,
  arrayBuffers: number,
];
type ResourceValues = [
  userCPUTime: number,
  systemCPUTime: number,
  maxRSS: number,
  sharedMemorySize: number,
  unsharedDataSize: number,
  unsharedStackSize: number,
  minorPageFault: number,
  majorPageFault: number,
  swappedOut: number,
  fsRead: number,
  fsWrite: number,
  ipcSent: number,
  ipcReceived: number,
  signalsCount: number,
  voluntaryContextSwitches: number,
  involuntaryContextSwitches: number,
];

const cpuValues: CpuValues = [0, 0];
const threadCpuValues: CpuValues = [0, 0];
const rssValues: RssValues = [0];
const memoryValues: MemoryValues = [0, 0, 0, 0, 0];
const resourceValues: ResourceValues = [
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
];

export interface CpuUsage {
  user: number;
  system: number;
}

/**
 * A previous reading has to be a pair of non-negative finite numbers no
 * larger than `Number.MAX_SAFE_INTEGER`.
 *
 * Node checks the shape before subtracting because the interesting failure is
 * silent: `{ user: "0" }` subtracts to `NaN`, and a benchmark reporting `NaN`
 * milliseconds looks like a bug in the thing being measured.
 */
function previousReading(previous: unknown): CpuUsage | undefined {
  // Node treats every falsy argument as an omitted reading. This is observable
  // from JavaScript even though the typed API only admits `CpuUsage`.
  if (!previous) return undefined;

  validateObject(previous, "prevValue");
  if (hasValidUsageFields(previous)) return previous;

  const user = "user" in previous ? previous.user : undefined;
  const validatedUser = usageField(user, "user");
  const system = "system" in previous ? previous.system : undefined;
  return {
    user: validatedUser,
    system: usageField(system, "system"),
  };
}

function hasValidUsageFields(value: object): value is CpuUsage {
  const user = "user" in value ? value.user : undefined;
  if (!usageFieldIsValid(user)) return false;
  const system = "system" in value ? value.system : undefined;
  return usageFieldIsValid(system);
}

function usageFieldIsValid(value: unknown): value is number {
  return typeof value === "number" &&
    !Number.isNaN(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;
}

function usageField(value: unknown, field: keyof CpuUsage): number {
  if (!usageFieldIsValid(value)) {
    validateNumber(value, `prevValue.${field}`);
    throw new ERR_INVALID_ARG_VALUE_RANGE(`prevValue.${field}`, value);
  }
  return value;
}

function usageSince(
  current: readonly [user: number, system: number],
  previous: CpuUsage | undefined,
): CpuUsage {
  if (previous === undefined) {
    return { user: current[0], system: current[1] };
  }
  return {
    user: current[0] - previous.user,
    system: current[1] - previous.system,
  };
}

export function cpuUsage(previous?: CpuUsage): CpuUsage;
export function cpuUsage(previous?: unknown): CpuUsage {
  const validatedPrevious = previousReading(previous);
  const error = nts_process_cpu_usage(cpuValues);
  if (error !== 0) throw uvException(error, "uv_getrusage");
  return usageSince(cpuValues, validatedPrevious);
}

export function threadCpuUsage(previous?: CpuUsage): CpuUsage;
export function threadCpuUsage(previous?: unknown): CpuUsage {
  const validatedPrevious = previousReading(previous);
  if (platform === "sunos") {
    throw new ERR_OPERATION_FAILED("threadCpuUsage is not available on SunOS");
  }
  const error = nts_process_thread_cpu_usage(threadCpuValues);
  if (error !== 0) throw uvException(error, "uv_getrusage_thread");
  return usageSince(threadCpuValues, validatedPrevious);
}

export type HrTime = [seconds: number, nanoseconds: number];

/**
 * A monotonic reading as `[seconds, nanoseconds]`, or the interval since one.
 *
 * The pair exists because a nanosecond count outgrew a double: 2^53
 * nanoseconds is about fourteen weeks of uptime, after which a single number
 * would start losing precision at the point where a duration is being
 * measured. `hrtime.bigint` is the same clock without the split, and is what
 * new code should use.
 */
export function hrtime(time?: HrTime): HrTime {
  const total = nts_hrtime_ns();
  const seconds = Number(total / NANOSECONDS_PER_SECOND);
  const nanoseconds = Number(total % NANOSECONDS_PER_SECOND);

  if (time === undefined) return [seconds, nanoseconds];

  validateArray(time, "time");
  if (time.length !== 2) {
    // The range reads as a phrase in the message: "It must be 2."
    throw new ERR_OUT_OF_RANGE("time", "2", time.length);
  }

  const deltaSeconds = seconds - time[0];
  const deltaNanoseconds = nanoseconds - time[1];
  // Borrow, exactly as a two-column subtraction does on paper. Without it a
  // reading taken 1.999s after a mark comes back as `[2, -1000000]`.
  return deltaNanoseconds < 0
    ? [deltaSeconds - 1, deltaNanoseconds + 1e9]
    : [deltaSeconds, deltaNanoseconds];
}

/** The same monotonic clock without the legacy two-number representation. */
export const hrtimeBigInt = nts_hrtime_ns;

export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export function memoryUsage(): MemoryUsage {
  const error = nts_process_memory_usage(memoryValues);
  if (error !== 0) throw uvException(error, "uv_resident_set_memory");
  return {
    rss: memoryValues[0],
    heapTotal: memoryValues[1],
    heapUsed: memoryValues[2],
    external: memoryValues[3],
    arrayBuffers: memoryValues[4],
  };
}

/**
 * Resident set size alone.
 *
 * Separate because it is the one field that needs no heap statistics, so it
 * can be read without asking the collector anything -- which matters when it
 * is being sampled on a timer.
 */
/** Resident memory without allocating the full usage record. */
export function memoryUsageRss(): number {
  const error = nts_process_rss(rssValues);
  if (error !== 0) throw uvException(error, "uv_resident_set_memory");
  return rssValues[0];
}

export function uptime(): number {
  return nts_process_uptime();
}

/** Memory the process could still allocate, or 0 where the host cannot say. */
export function availableMemory(): number {
  return nts_process_available_memory();
}

/** The cgroup or container limit, or 0 when the process is not constrained. */
export function constrainedMemory(): number {
  return nts_process_constrained_memory();
}

export interface ResourceUsage {
  userCPUTime: number;
  systemCPUTime: number;
  maxRSS: number;
  sharedMemorySize: number;
  unsharedDataSize: number;
  unsharedStackSize: number;
  minorPageFault: number;
  majorPageFault: number;
  swappedOut: number;
  fsRead: number;
  fsWrite: number;
  ipcSent: number;
  ipcReceived: number;
  signalsCount: number;
  voluntaryContextSwitches: number;
  involuntaryContextSwitches: number;
}

export function resourceUsage(): ResourceUsage {
  const error = nts_process_resource_usage(resourceValues);
  if (error !== 0) throw uvException(error, "uv_getrusage");
  return {
    userCPUTime: resourceValues[0],
    systemCPUTime: resourceValues[1],
    maxRSS: resourceValues[2],
    sharedMemorySize: resourceValues[3],
    unsharedDataSize: resourceValues[4],
    unsharedStackSize: resourceValues[5],
    minorPageFault: resourceValues[6],
    majorPageFault: resourceValues[7],
    swappedOut: resourceValues[8],
    fsRead: resourceValues[9],
    fsWrite: resourceValues[10],
    ipcSent: resourceValues[11],
    ipcReceived: resourceValues[12],
    signalsCount: resourceValues[13],
    voluntaryContextSwitches: resourceValues[14],
    involuntaryContextSwitches: resourceValues[15],
  };
}
