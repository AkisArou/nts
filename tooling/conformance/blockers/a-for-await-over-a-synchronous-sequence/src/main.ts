// expect: a `for await` over a synchronous sequence, which awaits every element
//
// `for await (const v of [1, 2])` is legal JavaScript and does not mean
// `for (const v of [1, 2])`. It awaits **each element**, so the loop yields to
// the microtask queue once per iteration even when nothing in it is a promise.
//
// # Why this is a fixture and not a line in the ledger
//
// Because the obvious fixture cannot see it. The elements are identical, the
// order of the elements is identical, and the sum is identical; the only
// difference is *when other work runs*. `nts check` drove the arms below
// reading their return value and reported `agreed on every case` for a loop
// that was wrong.
//
// Recording the order instead, against a second async function queued before
// the loop:
//
//     nts   129      the whole loop, then the other work
//     node  912      the other work first -- node suspends before the *first*
//                    element, so the queue gets a turn before anything is read
//
// Two controls in the same file agree, which is what makes the divergence a
// statement about `for await` rather than about the harness: a plain `for...of`
// over the same array, and a `for await` over an async generator.
//
// # What it would take
//
// An `await` per element in a loop whose sequence is not a generator at all --
// so the walk keeps its cursor and its element read, and gains a suspension
// between them. That is `hir::suspend` cutting a segment at a point the source
// never wrote, inside machinery it did not generate, for every one of the five
// synchronous walks.
//
// Refused by name until then, because the elements would be right and the
// interleaving wrong, and an interleaving is what nothing downstream checks.

let log = 0;
function note(digit: number): void {
  log = log * 10 + digit;
}

/** Suspends once, then writes a 9 from the microtask queue. */
async function otherWork(): Promise<number> {
  await Promise.resolve(0);
  note(9);
  return 0;
}

/** Under test: an array. */
export async function overAnArray(n: number): Promise<number> {
  log = 0;
  const held = otherWork();
  for await (const v of [1, 2]) note(v);
  await held;
  return log + (n & 0);
}

function* two(): Generator<number> {
  yield 1;
  yield 2;
}

/** Under test: a synchronous generator, which refuses for the same reason. */
export async function overASyncGenerator(n: number): Promise<number> {
  log = 0;
  const held = otherWork();
  for await (const v of two()) note(v);
  await held;
  return log + (n & 0);
}

/** Control: the same loop without `await`, which claims no suspension. */
export async function plainForOf(n: number): Promise<number> {
  log = 0;
  const held = otherWork();
  for (const v of [1, 2]) note(v);
  await held;
  return log + (n & 0);
}

async function* asyncTwo(): AsyncGenerator<number> {
  yield 1;
  yield 2;
}

/** Control: `for await` over an async generator, which does suspend. */
export async function overAnAsyncGenerator(n: number): Promise<number> {
  log = 0;
  const held = otherWork();
  for await (const v of asyncTwo()) note(v);
  await held;
  return log + (n & 0);
}
