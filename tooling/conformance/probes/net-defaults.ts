// The whole of `net`'s reachable native half, which is two bindings.
//
// `net` declares 30 native bindings and **28 of them have no C at all** — the
// socket and server half does not exist yet. These two are the exception: they
// answer node's `getDefaultAutoSelectFamily` and
// `getDefaultAutoSelectFamilyAttemptTimeout`, which are plain settings rather
// than handles. Probing them is worth doing precisely because it is *all* of
// `net` that can currently be measured, and a row that says "2 of 30" is more
// honest than `net` being absent from the table.
//
// `nts_checkpoint` rides along here rather than in its own file. It is
// `runtime/c`'s, linked into every probe, and `timers` is the only module that
// declares it — a module with no `.c` of its own at all.
declare function nts_net_default_auto_select_family(): boolean;
declare function nts_net_default_auto_select_family_attempt_timeout(): number;
declare function nts_checkpoint(): void;

export function probeAutoSelectFamily(): boolean {
  return nts_net_default_auto_select_family();
}

export function probeAutoSelectFamilyTimeout(): number {
  return nts_net_default_auto_select_family_attempt_timeout();
}

/** Stable across calls: a setting that moved would be a setting read wrong. */
export function probeAutoSelectFamilyStable(): boolean {
  const first = nts_net_default_auto_select_family();
  const second = nts_net_default_auto_select_family();
  return first === second;
}

/** `checkpoint` is a no-op to the caller and must simply survive being called. */
export function probeCheckpointSurvives(times: number): boolean {
  for (let index = 0; index < times; index++) {
    nts_checkpoint();
  }
  return true;
}
