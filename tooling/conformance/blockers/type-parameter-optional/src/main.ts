// expect: NTS1001 `null` or `undefined` where what it stands in for is not a
//         reference
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
