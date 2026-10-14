// Module evaluation: the statements at the top of a file.
//
// They ran nowhere. The lowering walked declarations, and `total = bump(41)`
// is not one, so it was dropped -- and the program compiled, ran, and answered
// as though the line were not there. No example had a top-level statement, so
// the gate was green.
//
// They are one function now, `module#init`, which the embedder calls before
// anything else. Module evaluation is itself a job (`docs/async.md` 3), so
// what it queues is drained at the checkpoint after it rather than interleaved
// with it -- which is also why it is an ordinary function rather than
// something the runtime runs implicitly. On node's side `await import()` does
// exactly this, which is what makes the two comparable.
//
// Across *modules* the order is the import graph, which the snapshot does not
// carry -- so top-level statements in a second file are refused rather than
// run in a guessed order.

let total = 0;
let doubled = 0;
let counted = 0;

function bump(n: number): number {
  return n + 1;
}

function sumTo(k: number): number {
  let s = 0;
  for (let i = 0; i < k; i = i + 1) {
    s = s + i;
  }
  return s;
}

// An expression statement, which is the shape that was dropped.
total = bump(41);

// One that reads what the line before it wrote, so source order is observable
// rather than merely plausible.
doubled = total * 2;

// Control flow at module scope: a branch...
if (total > 40) {
  doubled = doubled + 1;
}

// A call, whose result lands in a global. The loop is inside the function
// rather than here because assigning a *global* from inside a loop is refused
// -- a pre-existing limitation, and one that has nothing to do with module
// scope: it is refused inside an ordinary function too.
counted = sumTo(4);

export function readTotal(n: number): number {
  return total + n;
}

export function readDoubled(n: number): number {
  return doubled + n;
}

export function readCounted(n: number): number {
  return counted + n;
}
