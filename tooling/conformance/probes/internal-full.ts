// The shared internal bindings every module links against.
//
// `probes/internal.ts` covers fifteen. These are the rest that can be reached
// without ending the process: the two writers, the microtask queue, the sleep,
// the uv error tables and the uuid status.
//
// `nts_process_really_exit` and `nts_process_abort` are absent and will stay
// absent: a probe cannot survive them, and a probe that forks to survive them
// would be measuring the fork.
//
// `nts_node_enqueue_microtask` is absent for a different reason and it is not a
// choice. Its parameter is a closure, and the compiler names a closure type per
// *program* -- `NtsObj_Closure0` here, `NtsObj_Closure20` in `timers`,
// `NtsObj_Closure18` in `diagnostics_channel` -- so the one `.c` every module
// links against cannot spell the type, and `nts_node.h:50` says `NtsHeader *`
// instead. clang rejects the pair. That is `blockers/callback-binding`, and
// `microtask.c:30` documents it at the site. A probe cannot reach past it.
//
// The uv error tables are the interesting pair. They are two parallel arrays --
// codes and names -- and the failure a length check cannot see is the two
// drifting relative to each other, so they are compared *as pairs* against the
// errnos node itself reports.
declare function nts_write_stdout(text: string): number;
declare function nts_write_stderr(text: string): number;
declare function nts_debug_write(text: string): number;
declare function nts_sleep(milliseconds: number): void;
declare function nts_uv_error_codes(): number[];
declare function nts_uv_error_names(): string[];
declare function nts_node_random_uuid_status(): number;
declare function nts_hrtime_ns(): bigint;

export function probeWriteStdout(text: string): number {
  return nts_write_stdout(text);
}

export function probeWriteStderr(text: string): number {
  return nts_write_stderr(text);
}

export function probeDebugWrite(text: string): number {
  return nts_debug_write(text);
}

export function probeUuidStatus(): number {
  return nts_node_random_uuid_status();
}

export function probeErrorTableLengths(): string {
  return `${nts_uv_error_codes().length}:${nts_uv_error_names().length}`;
}

/** The name paired with a given code, looked up through both arrays at once. */
export function probeNameForCode(code: number): string {
  const codes = nts_uv_error_codes();
  const names = nts_uv_error_names();
  for (let index = 0; index < codes.length; index++) {
    if (codes[index] === code) return names[index] ?? "";
  }
  return "";
}

/** Every code appears once: a duplicate would make the lookup above ambiguous. */
export function probeCodesAreUnique(): boolean {
  const codes = nts_uv_error_codes();
  for (let outer = 0; outer < codes.length; outer++) {
    for (let inner = outer + 1; inner < codes.length; inner++) {
      if (codes[outer] === codes[inner]) return false;
    }
  }
  return true;
}

/** `sleep` has to actually elapse, measured by the clock beside it. */
export function probeSleepElapses(milliseconds: number): boolean {
  const before = nts_hrtime_ns();
  nts_sleep(milliseconds);
  const after = nts_hrtime_ns();
  const elapsed = after - before;
  return elapsed >= BigInt(milliseconds) * 1000000n;
}
