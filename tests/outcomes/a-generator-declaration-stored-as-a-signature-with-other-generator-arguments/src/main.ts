// run: check
//
// A `function*` declaration stored in a `Make[]` whose `Generator<…>` is not
// the declaration's own. `Make` writes `Generator<number>`, which is
// `Generator<number, any, any>`; the checker types `counted` from its body as
// `Generator<number, void, any>`. A generator closure written in that array
// takes `Make`'s generator from its context (tests/programs/a-generator-
// closure-filling-a-signature-with-other-generator-arguments, the one-change
// control), but a declaration has none: it is written before it is stored, and
// stored by name. Its frame extends its own generator, a value returned through
// `Make` is typed as the other, and stepping it is a virtual call to a
// resumption no frame overrides. Lowering refuses `total` and `steps` for it
// by name (`suspend::refuse_uninhabited`), one sentence on every backend, where
// each backend declined them for a callee it could not find. The same
// declaration stored in a local and called there agrees: the call reaches
// `counted` itself, and walks its own frame.
type Make = () => Generator<number>;

let first = 1;

function* counted() {
  yield first + 1;
  yield first + 2;
}

const makers: Make[] = [counted];

export function total(seed: number): number {
  let sum = 0;
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
