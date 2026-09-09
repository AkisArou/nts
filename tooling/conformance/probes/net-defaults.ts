// The two of `net`'s bindings that a probe can call without a socket.
//
// **Corrected.** This file used to say `net` declares 30 native bindings and
// "28 of them have no C at all — the socket and server half does not exist
// yet". That was derived from a regex and it is false. `nm --defined-only` over
// a compiled `net/net.c` finds **all thirty** as global `T` symbols, and the
// file is 909 lines of real libuv: `nts_net_write` builds a `uv_buf_t` and
// retains the callback, `nts_net_listen` takes thirteen parameters and handles
// the bind-then-listen path, `nts_net_connect` claims an entry and frees on
// every error return. Nothing is stubbed.
//
// So the reason this probe covers two is not that the other 28 are missing. It
// is that they need a live handle -- a bound socket, a connected peer, a
// listening server -- and this harness calls a binding directly with no module
// around it. These two answer node's `getDefaultAutoSelectFamily` and
// `getDefaultAutoSelectFamilyAttemptTimeout`, which are plain settings rather
// than handles, so they are the two that need no setup. **"2 of 30" is a
// statement about this instrument, not about `net`'s native half.**
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
