// expect: compiles
//
// **Closed 2026-09-17, and it was not a generics fix.** The expectation was
// `NTS1001 `null` or `undefined` where what it stands in for is not a
// reference`, and what removed it was a class field's initializer being lowered
// *at the field's type* rather than lowered and converted. `lower_absent` takes
// its type from where the literal sits, and sitting in `= undefined` it was
// being told nothing — so `T | undefined` had no reference for the literal to
// stand in for. The slot always knew.
//
// Kept as a regression guard rather than deleted, because the shape is load
// bearing: `web-platform/src/streams/fifo.ts` is written this way, and the
// distinction this fixture exists to hold — a *type parameter* in the union
// against a concrete type — is one a single grouped count merged once before.
// `examples/a-value-built-at-the-slot-it-meets` drives it against node on C,
// LLVM and the JVM; this asserts only that it still lowers, which is the half
// an example cannot assert if it stops being compiled at all.
//
// A property typed `T | undefined` where `T` is a *type parameter*. This is the
// shape `web-platform/src/streams/fifo.ts` has, and it refuses at `Slot<Marker>`
// as well as `Slot<number>` -- so it is the parameter, not the instantiation.
//
// Non-generic `X | undefined` compiles. That distinction is the whole point of
// this fixture: the ledger once claimed nullable properties in general were the
// largest blocker in `fs`, on a grouping that had merged two causes under one
// name, and one fixture would have caught it.
//
// It also produces a *second* NTS1001 -- "`use`, a declaration outside every
// walk" -- which is a consequence rather than a root: `use` cannot be walked
// because the class it constructs was refused. Two roots reported, one present.
class Slot<T> {
  value: T | undefined = undefined;
}

export function use(n: number): number {
  const s = new Slot<number>();
  s.value = n;
  return s.value ?? 0;
}
