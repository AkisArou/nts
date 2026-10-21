// An object nothing reads is not made.
//
// `dropped` is `benchmarks/cases/exceptions`: a `throw new Error(...)` caught
// in the same function is a branch, and `catch (e)` never reads `e`. What was
// left was the allocation and its two stores, the message and the name -- a
// heap allocation per throw on Wasm and the JVM, where C's frame placement
// let clang drop it. Nothing can observe the object, so it is not made.
//
// `kept` differs from it in one thing: its `catch` reads `e.message`, and the
// object stays. `linked` makes two objects that only point at each other, and
// neither survives. `stored` writes one into the field of an object it did not
// make, which anything can read later, so it stays.
//
// expect-ir: all: no object.new in dropped
// expect-ir: all: no object.new in dropped#whole
// expect-ir: all: count object.new in kept >= 1
// expect-ir: all: no object.new in linked
// expect-ir: all: count object.new in stored >= 1

export function dropped(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    try {
      if ((i & 7) === 0) {
        throw new Error("boom");
      }
      total = total + 1;
    } catch (e) {
      total = total + 2;
    }
  }
  return total;
}

export function kept(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    try {
      if ((i & 7) === 0) {
        throw new Error("boom");
      }
      total = total + 1;
    } catch (e) {
      total = total + (e as Error).message.length;
    }
  }
  return total;
}

type Link = { next: Link | null; value: number };

export function linked(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i = i + 1) {
    const a: Link = { next: null, value: i };
    const b: Link = { next: null, value: i + 1 };
    a.next = b;
    b.next = a;
    total = total + i;
  }
  return total;
}

type Shelf = { held: Link | null };

const shelf: Shelf = { held: null };

export function stored(n: number): number {
  shelf.held = { next: null, value: n };
  return n + 1;
}
