/* The six primitives `timers/src/host.ts` declares, over libuv.
 *
 * `runtime/node/timers/` held no `.c` at all, so this module could not have
 * linked whatever the compiler did with it -- which is worth stating plainly,
 * because the compiled axis is usually discussed as though compiling were the
 * whole of it. It is not: `timers` declares eight bindings and seven of them
 * had no definition anywhere in the tree.
 *
 * The contract is in `host.ts` and is not repeated here. What is here is the
 * part that is about libuv rather than about node. */
#ifndef NTS_NODE_TIMERS_H
#define NTS_NODE_TIMERS_H
#include "nts_runtime.h"

/* Both parameters are closures, and both are spelled `NtsHeader *` for the
 * reason `nts_node_enqueue_microtask` is: the compiler names a closure type
 * per program, so the one definition every program links against cannot spell
 * it. See `tooling/conformance/blockers/callback-binding` -- until that is
 * fixed, the emitted prototype disagrees with this one and clang rejects the
 * call. Writing the parameter as the per-program type instead is not available
 * to a shared translation unit, and writing `void *` would only move the
 * disagreement to where nothing checks it. */
void nts_timers_install(NtsHeader *on_timers, NtsHeader *on_immediates);

void nts_timers_schedule(double delay_ms);
void nts_timers_cancel(void);
void nts_timers_schedule_immediate(void);
void nts_timers_toggle_ref(bool has_refs);
void nts_timers_toggle_immediate_ref(bool has_refs);
double nts_timers_now(void);

#endif /* NTS_NODE_TIMERS_H */
