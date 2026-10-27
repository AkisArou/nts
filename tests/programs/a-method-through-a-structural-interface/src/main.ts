// A call through an interface on classes that satisfy it without writing
// `implements` -- which TypeScript does not require, and which this compiler's
// dispatch did, until 2026-10-10 (`docs/records/notebooks/interfaces-by-shape.md`, Part 1).
//
// ```text
// class C { go(): number { return 3; } }              take(new C())  REFUSED
// class C implements S { go(): number { return 3; } } take(new C())  lowered
// ```
//
// Dispatch here is by edge: the slot is numbered against `S` and every
// implementer fills it, and the edge came from the heritage clause alone. So
// `take` was refused -- "`take` cannot be compiled because it calls `S#go`" --
// for want of one word. Now a class with every method an interface declares,
// each with the arity and the parameter and result representations the slot
// carries, implements it (`infer_implements`), and the call is the same
// indexed load a written `implements` gives.
//
// Built and measured once before, on 2026-09-22, and set aside: it cleared no
// refusal in the runtime and its edges turned two upcasts into casts between
// structs that disagree about their fields. This time an edge needs the slot's
// exact ABI, an optional method the class lacks blocks it, and one class that
// TypeScript accepts as the interface but that does not fit blocks them all;
// `infer_implements` says why each, and what it measured.
//
// The cases: two structural implementers through one interface, so the call
// is a dispatch and not a direct call that a single implementer would let it
// be, and `Declared`, which writes the word, as the control.

interface S {
  go(): number;
}

class C {
  go(): number {
    return 3;
  }
}

class D {
  constructor(private readonly n: number) {}
  go(): number {
    return this.n * 2;
  }
}

class Declared implements S {
  go(): number {
    return 7;
  }
}

function take(s: S): number {
  return s.go();
}

export function throughOne(n: number): number {
  const all: S[] = [new C(), new D(n), new Declared()];
  return take(all[Math.abs(n | 0) % 3]);
}

export function summed(n: number): number {
  let total = 0;
  for (const s of [new C(), new D(n), new Declared()] as S[]) total += take(s);
  return total;
}
