// `Program::signature_faces`: the typed face of a written signature, for a
// backend that publishes one to a foreign language.
//
// Three shapes, because the map has to tell them apart:
//
//   Weigh      a written signature whose every parameter and return represent.
//              Its face is fully typed.
//   Mixed      a written signature with a parameter that has no representation,
//              so that position is `None` while the rest stay typed -- the
//              consumer publishes the erased face there and names the reason
//              instead of dropping the whole surface.
//   an arrow   an inferred function type, which is a closure's layout and gets
//              no entry at all. `None` at a position and an absent key mean
//              different things, and collapsing them is how the JVM's Java
//              surface vanished silently.

export type Weigh = (grams: number, label: string) => number;

// A parameter whose type has no representation. **A `symbol` was the first guess
// and it was wrong** -- it represents as `Managed(Symbol)` -- which the test caught
// rather than my assuming it. An *intersection* is one the corpus refuses by name:
// `a conditional of unrepresentable type (a union of an intersection | null)`.
export type Mixed = (both: { a: number } & { b: string }, grams: number) => void;

export function weighs(f: Weigh): number {
  return f(2, "kg");
}

export function mixes(f: Mixed): void {
  f({ a: 1, b: "x" }, 1);
}

// An inferred function type, to sit beside the written ones.
export function inferred(): number {
  const twice = (n: number): number => n * 2;
  return twice(21);
}
