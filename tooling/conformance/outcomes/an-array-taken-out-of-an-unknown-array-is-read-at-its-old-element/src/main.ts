// **Stops by name, where the build failed.** A `number[]` stored as an element
// of an `unknown[]`, taken back out and cast to `unknown[]`: node answers "3".
//
// `narrow_arrays` saw the `unknown[]` was only ever given one `number[]`, and
// replaced the cast's unerase with the narrowed read -- which changed its type
// under its users, so `ys[0]` was an `f64` read stored as an erased value:
// `invalid HIR: StoreType { ... expected: Float { bits: 64 }, found: Erased }`
// on every backend, until 2026-10-10. Narrowing now keeps an unerase that
// claims something other than what was stored.
//
// Which leaves the claim itself: `held[0] as unknown[]` says the array holds
// erased values, and this one holds doubles. That is checked now, as an unerase
// to a class is (`outcomes/a-write-through-unknown-cast-to-an-array-of-unknown`
// for the write that made it a wrong answer), so the program stops at the cast
// naming it. What lifts it is an array whose element kind is read at run time,
// which reads and writes would both have to go through.
//
// The control, `held[0] as number[]`, names the element the array has.
function subject(n: number): string {
  const xs: number[] = [n, 2];
  const held: unknown[] = [xs];
  const ys = held[0] as unknown[];
  return String(ys[0]);
}

function control(n: number): string {
  const xs: number[] = [n, 2];
  const held: unknown[] = [xs];
  const ys = held[0] as number[];
  return String(ys[0]);
}

observe("as number[]", control(3));
observe("as unknown[]", subject(3));
done();
