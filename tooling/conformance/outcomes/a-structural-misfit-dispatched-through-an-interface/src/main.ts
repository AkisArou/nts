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
// satisfied by shape (`docs/interfaces-by-shape.md`, Part 1) infer the edge
// only where every class with an interface's members fits it exactly, so that
// it does not open this anywhere it was not already open.
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

function throughTheArray(n: number): string {
  const all: Sink[] = [new Wide(), new Exact()];
  let total = 0;
  for (const s of all) total = total * 100 + s.take(n);
  return String(total);
}

observe("a Wide kept as itself", String(sink(new Wide(), 3)));
observe("through the array", throughTheArray(3));
done();
