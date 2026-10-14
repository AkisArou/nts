// expect: emit-c --napi -> emits-c const uint32_t nts_closure_call_slot
//
// FIXED, and kept as a guard. The backend publishes the slot now, per program
// and unconditionally, so `internal/microtask.c` names the symbol instead of
// carrying a hardcoded `0`. Verified against the vtables: `punycode` 0,
// `buffer` 5, `diagnostics_channel` 5, `async_hooks` 8.
//
// The guard is on the symbol being *emitted*, not on its value, because the
// value is correct-by-construction per program and a fixture asserting `0`
// would pass for the one program where the old bug was invisible.
//
// The backend does not publish the closure's call slot, and nothing anywhere
// reports that. This is the blocker with no diagnostic.
//
// `nts_callback_task(callback, slot, repeating)` takes an index into the
// callback descriptor's method table, and the runtime calls straight through it:
//
//     ((void (*)(NtsHeader *))callback->descriptor->methods[entry->slot])(callback)
//
// A wrong slot is a **null call**, not a type error. The compiler assigns a
// closure's call slot after every named method in the program, so it differs per
// program — measured from the emitted vtables: `async_hooks` 8,
// `diagnostics_channel` 5, `buffer` 5, `punycode` 0. That is the worst possible
// distribution for a hardcoded constant, because `punycode` — the module with no
// methods and the one anybody tests first — is the single program where `0` is
// right.
//
// **It cannot be derived at run time, and that is checked rather than assumed.**
// `NtsDescriptor` carries `void *const *methods` and no count, so there is
// nothing to scan and no way to find the last entry. Only `program.c` knows it.
//
// So `runtime/node/internal/microtask.c` carries `0` behind a TODO, and
// `async_hooks`, `diagnostics_channel` and `timers` are not to be run against it:
// they would typecheck, compile, link, load, and crash on their first microtask.
// A failure that looks like success until it runs is strictly worse than the
// clang error it replaced.
//
// **Why this fixture is spelled as an absence.** Nothing refuses, `emit-c`
// succeeds, clang succeeds, the addon links and loads. There is no diagnostic to
// match and no missing export to name — the defect is a constant the backend
// does not emit. The only statement that captures it is that `program.c` does
// not contain the symbol, which is why `blockers-check.mjs` grew `lacks-c` for
// it. It reports FIXED the day the constant appears, at which point the number
// in `microtask.c` becomes `nts_closure_call_slot` and this becomes a guard.
//
// I had written in the ledger that this blocker "cannot usefully be fixtured".
// That was a claim about the checker's vocabulary presented as a claim about the
// defect, which is the same confusion this file's own subject is made of.
function apply(fn: () => number): number {
  return fn();
}

export function run(): number {
  const base = 2;
  return apply(() => base + 1);
}
