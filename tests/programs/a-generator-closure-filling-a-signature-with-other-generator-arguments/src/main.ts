// A generator closure stored as a function type whose `Generator<…>` is not
// the closure's own. `Make` writes `Generator<number>`, which is
// `Generator<number, any, any>`; the checker types each closure from its body
// as `Generator<number, void, any>`, or `Generator<1 | 2, void, any>` for
// the literal yields. Those are other abstract generators, other layouts, and
// a frame extending its own was returned through `Make` typed as the first:
// stepping it was a virtual call to a resumption no frame overrides, and every
// backend declined `total` and `steps`.
//
// A generator closure's frame extends the generator its context names where
// that is one of its kind (`generator_in_context`), here each element of a
// `Make[]`: the shell, both frames and every call agree on `Make`'s.
//
// The one-change control is tests/programs/one-generator-closure-called-
// through-a-signature, which writes `Make`'s result as the closure's own. A
// `function*` declaration stored in a `Make[]` has no context and still
// refuses: tests/outcomes/a-generator-declaration-stored-as-a-signature-with-
// other-generator-arguments.
type Make = () => Generator<number>;

let first = 1;

const makers: Make[] = [
  function* () {
    yield first + 1;
    yield first + 2;
  },
  function* () {
    yield 1;
    yield 2;
  },
];

// Held untyped and assigned later, so its calls go through the closure's own
// `call` slot, and every signature the program lays out declares one.
let twice;
twice = (value: number) => value * 2;
const none = twice(0);

export function total(seed: number): number {
  let sum = none;
  for (const value of makers[seed & 1]()) {
    sum = sum + value;
  }
  return sum;
}

export function steps(seed: number): number {
  const walk = makers[seed & 1]();
  let count = 0;
  while (!walk.next().done) {
    count = count + 1;
  }
  return count;
}
