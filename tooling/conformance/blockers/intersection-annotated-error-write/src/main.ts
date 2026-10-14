// expect: NTS1001 `errno`, which `Error` does not declare is not supported by this lowering yet
//
// An annotated const whose annotation is an intersection (`Error & { ... }`)
// takes its receiver from the initializer (`Error`) rather than from the
// annotation, so writing a property the intersection declares is refused
// with "`errno`, which `Error` does not declare".
//
// The control is `viaInterface` below: the same write through an interface
// that extends `Error` lowers cleanly. The pair differs in one thing --
// how the wider type is spelled -- so the gap is the intersection spelling
// of an annotated const, the one `annotated-const-write` (now a guard)
// does not cover: that fixture's wider type is an interface.
//
// This refuses `spawnSync` and `execFileSync` in `node:child_process`,
// whose error is built exactly this way (`const error: Error & { errno?:
// number; ... } = new Error(...)` at child_process/src/main.ts:880), and
// it is node's own shape for a spawn error, not a spelling this profile
// can choose differently (measured on main e0b77e5a7, slice 1).

export function viaIntersection(): number {
  const error: Error & { errno?: number } = new Error("spawnSync x");
  error.errno = -2;
  return error.errno ?? 0;
}

interface Tagged extends Error {
  errno?: number;
}

// Control: lowers.
export function viaInterface(): number {
  const error: Tagged = new Error("spawnSync x");
  error.errno = -2;
  return error.errno ?? 0;
}
