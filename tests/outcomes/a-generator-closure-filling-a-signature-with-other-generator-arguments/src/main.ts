// run: check
//
// A generator closure stored as a function type whose `Generator<…>` is not
// the closure's own. `Make` writes `Generator<number>`, which is
// `Generator<number, any, any>`; the checker types the closure from its body
// as `Generator<number, void, unknown>`. Those are two abstract generators,
// two layouts: the closure's frame extends the second, and a value returned
// through `Make` is typed as the first. Stepping that value is a virtual call
// to the first's resumption, which no frame overrides, so nothing declares
// it, and every backend declines `total` and `steps`: C and LLVM "no
// declaration for `Generator0#resume` to take a signature from" (NTS2006),
// the JVM "a virtual call to `Generator0#resume`, which is not in this
// program" (NTS4001), Wasm "callable `Generator0` declares no entry at slot
// 3" (NTS5001). The closure does not fill `Make` either: the signatures
// differ, so it has no base there.
//
// A literal yield is the same defect: under `Make`, `yield 1` types the
// closure as `Generator<1, void, unknown>`.
//
// The one-change control is tests/programs/one-generator-closure-called-
// through-a-signature, which writes `Make`'s result as the closure's own,
// `Generator<number, void, unknown>`, and agrees on every backend.
type Make = () => Generator<number>;

let first = 1;

const makers: Make[] = [
  function* () {
    yield first + 1;
    yield first + 2;
  },
];

// Held untyped and assigned later, so its calls go through the closure's own
// `call` slot, and every signature the program lays out declares one.
let twice;
twice = (value: number) => value * 2;
const none = twice(0);

export function total(seed: number): number {
  let sum = none;
  for (const value of makers[seed & 0]()) {
    sum = sum + value;
  }
  return sum;
}

export function steps(seed: number): number {
  const walk = makers[seed & 0]();
  let count = 0;
  while (!walk.next().done) {
    count = count + 1;
  }
  return count;
}
