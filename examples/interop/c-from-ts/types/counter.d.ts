// GENERATED SKETCH — what `nts bind --header native/counter.h` should produce.
//
// Written by hand today because no header importer exists. It is checked in so
// the DX is a file you can read rather than a proposal, and so that when the
// importer lands its output has something to be diffed against.

// The scalar types are **branded numbers** (decided 2026-09-13):
//
//     type c_int = number & { readonly __c_int: unique symbol };
//
// so arithmetic keeps working and `Math.abs` still accepts one. `Ptr`, `Ref`,
// `Owned` and `CFn` are NOT branded numbers -- a pointer is not an f64 and the
// assignability leak a brand carries would be wrong there.

declare module "c:counter" {
  // --- scalars carry their C type, not `number` -----------------------------
  //
  // This is the whole reason the RFC's scalar types exist. `number` is an f64;
  // `int` is 32 bits and arrives in a different register. Today
  // `declare function counter_clamp(v: number): number` emits
  // `double counter_clamp(double)` against a real `int counter_clamp(int)`,
  // which links and is wrong.
  export function counter_clamp(value: c_int, lo: c_int, hi: c_int): c_int;

  // --- an owned handle ------------------------------------------------------
  //
  // `Owned<T>` is the obligation, not the pointer: the checker requires it to
  // be discharged on every path, by `counter_destroy` or by `using`.
  export function counter_new(name: CStr): Owned<Counter> | null;
  export function counter_destroy(c: Owned<Counter>): void;

  // --- a borrowed accessor --------------------------------------------------
  //
  // `Ref<T>` may be read and may not be destroyed. The distinction is invisible
  // in C -- both are `Counter *` -- and it is the one a header cannot state.
  export function counter_name(c: Ref<Counter>): CStr;
  export function counter_bump(c: Ref<Counter>, by: c_int): c_int;

  // --- a callback -----------------------------------------------------------
  //
  // `CFn<...>` is a real C function pointer. Today a TypeScript function passed
  // to a `declare function` is emitted as `NtsHeader *` -- a managed closure
  // object where C expects a code address -- which compiles and crashes.
  export function counter_on_change(
    c: Ref<Counter>,
    cb: CFn<(value: c_int, user: Ptr<void>) => void>,
    user: Ptr<void>,
  ): void;

  // --- an out-parameter -----------------------------------------------------
  //
  // `addrOf` on a local, which needs the local to have an address at all --
  // `Place`s being first-class in HIR is what the RFC means by that.
  export function counter_read_into(c: Ref<Counter>, out: Ptr<c_int>): c_int;
}
