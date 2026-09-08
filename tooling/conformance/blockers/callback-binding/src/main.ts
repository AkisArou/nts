// expect: emit-c --napi -> emits-c void nts_take_callback(NtsObj_Closure
//
// A `declare function` that takes a callback cannot be implemented in
// hand-written C, because the emitted prototype names a **program-specific**
// closure struct:
//
//     void nts_take_callback(NtsObj_Closure0 *);
//
// The number is assigned per program. `timers` gets `NtsObj_Closure20`,
// `diagnostics_channel` gets `NtsObj_Closure18`. A `.c` file in `runtime/node`
// is compiled against every module and cannot spell any of them, and any other
// spelling is a conflicting type rather than a coercion:
//
//     program.c:1864  void nts_node_enqueue_microtask(NtsObj_Closure20 *);
//     microtask.c:47  void nts_node_enqueue_microtask(NtsHeader *callback)
//     error: conflicting types for 'nts_node_enqueue_microtask'
//
// **Found by running the counted lane over all twenty-two modules rather than
// the seven that were known to build.** `timers` had never been built since the
// microtask binding was renamed, so this error had never been seen. The lane's
// old hardcoded list did not include it.
//
// This is the *first* problem with the microtask adapter, and
// `blockers/closure-call-slot` is the second. Both have to be solved for
// `async_hooks`, `diagnostics_channel` and `timers`: this one stops the adapter
// compiling at all, and that one would make it crash if it did. Reporting the
// slot as the only remaining issue — which this lane did — was reporting the
// blocker it had looked for rather than the one in front of it.
//
// Worth noting what the other callback-taking bindings do, because it explains
// why this has never surfaced: `nts_schedule_unreferenced_immediate` and
// `nts_on_collected` also take callbacks, and **neither has a C implementation
// at all** — they exist only as stand-ins in `bindings.node.mjs` for the
// interpreted lane. So no callback-taking binding in this profile has ever had a
// working compiled implementation, and the one that tried is this one.
//
// What would fix it is a stable parameter type for callbacks at the runtime
// boundary — `NtsHeader *`, or the `NtsTask` shape the runtime already uses —
// so that a hand-written implementation has something it can name.
declare function nts_take_callback(callback: () => void): void;

let ran = 0;

export function schedule(): number {
  nts_take_callback(() => {
    ran += 1;
  });
  return ran;
}
