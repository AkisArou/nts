// The `process` bindings no lane could disagree with node about.
//
// Five of the nine `standin-blindspot.mjs` still names. Each fills a
// caller-provided array and answers a libuv errno, which is why they looked
// unprobeable at first glance -- the *result* is the mutation, not the return.
// A homogeneous number tuple crosses as `NtsArray *`, so the array can be handed
// in here and read back after.
//
// `nts_process_umask` mutates process-global state that the test runner shares,
// so it is probed by setting a mask, reading what came back, and restoring the
// original in the same call. Node's `process.umask(m)` has the same shape and
// the same hazard.
declare function nts_process_cpu_usage(values: [number, number]): number;
declare function nts_process_rss(values: [number]): number;
declare function nts_process_memory_usage(
  values: [number, number, number, number, number],
): number;
declare function nts_process_umask(mask: number): number;
declare function nts_process_umask_read(): number;
declare function nts_hrtime_ns(): bigint;

/** `[errno, user, system]`, so a wrong errno cannot hide behind plausible numbers. */
export function probeCpuUsage(): string {
  const values: [number, number] = [0, 0];
  const errno = nts_process_cpu_usage(values);
  return `${errno}:${values[0] > 0}:${values[1] >= 0}`;
}

export function probeCpuUserMicros(): number {
  const values: [number, number] = [0, 0];
  nts_process_cpu_usage(values);
  return values[0];
}

export function probeRss(): number {
  const values: [number] = [0];
  const errno = nts_process_rss(values);
  return errno === 0 ? values[0] : -1;
}

/** All five columns, so a shifted column cannot pass as a plausible total. */
export function probeMemoryShape(): string {
  const values: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const errno = nts_process_memory_usage(values);
  return `${errno}:${values[0] > 0}:${values[1] > 0}:${values[2] > 0}:${values[3] >= 0}:${values[4] >= 0}`;
}

export function probeMemoryRss(): number {
  const values: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  nts_process_memory_usage(values);
  return values[0];
}

/**
 * Set a mask, keep what the call answered, and put the old one back before
 * returning. The answer is the *previous* mask, which is node's contract.
 */
export function probeUmaskRoundTrip(): string {
  const original = nts_process_umask_read();
  const previous = nts_process_umask(0o077);
  const nowSet = nts_process_umask_read();
  nts_process_umask(original);
  const restored = nts_process_umask_read();
  return `${previous}:${nowSet}:${restored}`;
}

/** Monotonic and in nanoseconds, which is the whole contract. */
export function probeHrtimeMonotonic(): boolean {
  const first = nts_hrtime_ns();
  const second = nts_hrtime_ns();
  return second >= first;
}

export function probeHrtimeIsNanoseconds(): boolean {
  // A value in nanoseconds since an arbitrary epoch is large; one in
  // milliseconds or seconds would not clear this by orders of magnitude.
  return nts_hrtime_ns() > 1_000_000_000n;
}
