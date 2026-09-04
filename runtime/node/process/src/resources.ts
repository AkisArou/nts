// What the process is spending, from node v24.20.0
// `lib/internal/process/per_thread.js`.
//
// Every one of these is a libuv call and a reshaping. Node passes a
// preallocated `Float64Array` down to C++ and reads the columns back out,
// because these are called in hot measurement loops and an object per call
// would be measuring the allocator. The same shape is here: the binding
// returns one array, and the object is built on this side, so the C stays a
// fill and the names live in one place.

import { ERR_INVALID_ARG_VALUE_RANGE, ERR_OUT_OF_RANGE } from "../../internal/errors.ts";
import { validateArray, validateNumber, validateObject } from "../../internal/validators.ts";

declare function nts_hrtime_ns(): bigint;
/** Seconds since the process started, fractional. */
declare function nts_process_uptime(): number;
/** `[user, system]`, microseconds of CPU time. */
declare function nts_process_cpu_usage(): [user: number, system: number];
declare function nts_process_thread_cpu_usage(): [user: number, system: number];
/** `[rss, heapTotal, heapUsed, external, arrayBuffers]`, bytes. */
declare function nts_process_memory_usage(): [
  rss: number,
  heapTotal: number,
  heapUsed: number,
  external: number,
  arrayBuffers: number,
];
declare function nts_process_rss(): number;
/** The sixteen columns of `uv_getrusage`, in the order below. */
declare function nts_process_resource_usage(): [
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
declare function nts_process_available_memory(): number;
declare function nts_process_constrained_memory(): number;

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

export interface CpuUsage {
  user: number;
  system: number;
}

const usageFields: readonly (keyof CpuUsage)[] = ["user", "system"];

/**
 * A previous reading has to be a pair of non-negative safe integers.
 *
 * Node checks the shape before subtracting because the interesting failure is
 * silent: `{ user: "0" }` subtracts to `NaN`, and a benchmark reporting `NaN`
 * milliseconds looks like a bug in the thing being measured.
 */
function requirePreviousReading(previous: CpuUsage): void {
  for (const field of usageFields) {
    const value = previous[field];
    if (
      typeof value !== "number" ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    ) {
      validateObject(previous, "prevValue");
      validateNumber(value, `prevValue.${field}`);
      throw new ERR_INVALID_ARG_VALUE_RANGE(`prevValue.${field}`, value);
    }
  }
}

function usageSince(
  current: readonly [user: number, system: number],
  previous?: CpuUsage,
): CpuUsage {
  if (previous === undefined) {
    return { user: current[0], system: current[1] };
  }
  requirePreviousReading(previous);
  return {
    user: current[0] - previous.user,
    system: current[1] - previous.system,
  };
}

export function cpuUsage(previous?: CpuUsage): CpuUsage {
  return usageSince(nts_process_cpu_usage(), previous);
}

export function threadCpuUsage(previous?: CpuUsage): CpuUsage {
  return usageSince(nts_process_thread_cpu_usage(), previous);
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
  const values = nts_process_memory_usage();
  return {
    rss: values[0],
    heapTotal: values[1],
    heapUsed: values[2],
    external: values[3],
    arrayBuffers: values[4],
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
export const memoryUsageRss = nts_process_rss;

export const uptime = nts_process_uptime;

/** Memory the process could still allocate, or 0 where the host cannot say. */
export const availableMemory = nts_process_available_memory;

/** The cgroup or container limit, or 0 when the process is not constrained. */
export const constrainedMemory = nts_process_constrained_memory;

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
  const v = nts_process_resource_usage();
  return {
    userCPUTime: v[0],
    systemCPUTime: v[1],
    maxRSS: v[2],
    sharedMemorySize: v[3],
    unsharedDataSize: v[4],
    unsharedStackSize: v[5],
    minorPageFault: v[6],
    majorPageFault: v[7],
    swappedOut: v[8],
    fsRead: v[9],
    fsWrite: v[10],
    ipcSent: v[11],
    ipcReceived: v[12],
    signalsCount: v[13],
    voluntaryContextSwitches: v[14],
    involuntaryContextSwitches: v[15],
  };
}
