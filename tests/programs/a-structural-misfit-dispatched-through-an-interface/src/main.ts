// **A crash: a call through an interface's slot on a class with no entry in
// it.** `Exact` writes `implements Sink`, so `Sink#take` is a dispatch slot
// and `Exact` fills it. `Wide` satisfies `Sink` by shape, which TypeScript
// accepts for the `Sink[]`, but its `take(x: number | string)` is not the
// slot's `take(x: number)`, so nothing makes it an implementer and its class
// has no entry -- often no table at all. Its class is lost in the array, and
// the call through `Sink` on it jumped through a null pointer: SIGSEGV on C
// and LLVM, an `ArrayStoreException` at the store on the JVM, where the array
// is a `Sink[]` that `Wide` is not.
//
// A call that keeps the class does not dispatch: `sink(new Wide(), n)` gets a
// copy of `sink` that calls `Wide#take` directly, which is the control.
//
// What closes it is an adapter: an entry for `Wide` in `Sink`'s slot that
// takes the slot's `number` and calls `Wide#take` with it. Interfaces
// satisfied by shape (`docs/records/notebooks/interfaces-by-shape.md`, Part 1) infer the edge
// where every candidate either fits or admits an adapter, so every class
// that can arrive through the interface has an entry.
//
// Found on 2026-10-10 by the JVM lane's probe of Part 1.
interface Sink {
  take(x: number): number;
}

class Wide {
  take(x: number | string): number {
    return typeof x === "number" ? x * 2 : 0;
  }
}

class Exact implements Sink {
  take(x: number): number {
    return x - 1;
  }
}

function sink(s: Sink, n: number): number {
  return s.take(n);
}

export function throughTheArray(n: number): string {
  const all: Sink[] = [new Wide(), new Exact()];
  let total = 0;
  for (const s of all) total = total * 100 + s.take(n);
  return String(total);
}

export function keptAsItself(n: number): number {
  return sink(new Wide(), n);
}
