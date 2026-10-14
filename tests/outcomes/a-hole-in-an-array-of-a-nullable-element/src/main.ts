// run: check
//
// A hole reads as `undefined` whatever the element type says, and in a
// reference array it is the same null pointer as a stored `null`. The runtime
// is told which absence a null slot holds from the element type
// (`nts_array_element`, `nts_array_sort_str`), which is right for every array
// without holes and for every element type admitting `undefined` -- a hole and
// the slot's absence then agree. It is wrong for a hole in an array of
// `T | null`, so the two ways a compiled program makes one are refused by
// name for that kind: `new Array(n)` not filled at once -- typed by its type
// arguments or by what it is given to -- and a `length` that may grow. Raised
// by the JVM lane reviewing the change.
//
// The control differs in one thing: the same array filled at once, as Are We
// Fast Yet's Towers writes it, which agrees.
export function unfilled(at: number): number {
  const xs = new Array<string | null>(3);
  xs[1] = null;
  const v = xs[at % 3];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
export function grown(at: number): number {
  const xs: (string | null)[] = ["a"];
  xs.length = 3;
  const v = xs[at % 3];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
// With no type argument, `new Array(3)` is `any[]`; the type it is given to
// decides -- a parameter or a declared result here (raised by the JVM lane).
function second(xs: (string | null)[]): number {
  const v = xs[1];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
export function passed(at: number): number {
  return second(new Array(3)) + at;
}
function make(): (string | null)[] {
  return new Array(3);
}
export function returned(at: number): number {
  const v = make()[at % 3];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
export function filled(at: number): number {
  const xs = new Array<string | null>(3).fill(null);
  xs[0] = "a";
  const v = xs[at % 3];
  return v === undefined ? 1 : v === null ? 2 : 3;
}
