// expect: emit-c --napi -> emits-c NtsHeader * nts_probe_returns_frame(void);
//
// A `declare function` **returning** an object gets a prototype naming a
// per-program struct, so no shared translation unit can define it:
//
//     NtsObj_Frame * nts_probe_returns_frame(void);      <- unspellable
//     void nts_probe_takes_frame(NtsHeader *);           <- fine
//     void nts_probe_takes_callback(NtsHeader *);        <- fine
//
// **The escape exists and is not applied in return position.** Both controls
// above must stay clean: they are the same defect in parameter position, and
// both were fixed -- `blockers/callback-binding` is the closure one and is a
// guard now. If either ever names a per-program type again, the escape has
// regressed generally and this fixture is no longer about returns.
//
// **What it costs: every module that builds.** `nts_async_context_get` is
// declared in `internal/async-context.ts` as returning `AsyncContextFrame |
// undefined`, so its emitted prototype is
// `NtsObj_AsyncContextFrame * nts_async_context_get(void);` and the one
// definition every program would link against cannot spell that. It is
// undefined in **14 of the 20 addons that build**, alongside
// `nts_async_context_set` and `nts_on_collected` -- and those two *can* be
// written, because they take rather than return.
//
// The addons load anyway. A shared object binds lazily, so an undefined
// function symbol is not an error until something calls it; `build-floor.sh`
// reporting "builds and loads" is a weaker statement than it reads, and was
// weaker than its author knew until this was measured with `nm -D`.
//
// Writing the definition to return `NtsHeader *` is not available: the emitted
// prototype disagrees and clang rejects the pair, which is the same wall
// `nts_timers_install` hit in parameter position before the escape existed.

interface Frame {
  depth: number;
}

// Returns an object: the emitted prototype names a per-program struct.
declare function nts_probe_returns_frame(): Frame | undefined;

// Takes one: the emitted prototype uses the shared escape.
declare function nts_probe_takes_frame(frame: Frame | undefined): void;

// Takes a callback: fixed, and the control that says the escape exists.
declare function nts_probe_takes_callback(fn: () => void): void;

export function useReturn(): number {
  const f = nts_probe_returns_frame();
  return f === undefined ? 0 : f.depth;
}

export function useParam(): void {
  nts_probe_takes_frame(undefined);
}

export function useCallback(): void {
  nts_probe_takes_callback(() => {});
}
