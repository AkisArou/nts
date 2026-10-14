// A tuple is a fixed-length heterogeneous sequence, which is what an object
// with positional fields already is.
//
// Naming the fields `_0`, `_1` is not a trick to make it fit: `[string,
// number]` *is* a two-field struct, and saying so gives it the layout
// machinery, field access, escape analysis and reference counting rather than a
// second mechanism that would need all four again. It is deliberately not an
// array, which is the other tempting answer — an array has one element type and
// a length the compiler does not fix, and a tuple has neither.
//
// It was found by naming what a refusal blocked on. 100 refusals in the node
// profile read `a property of unrepresentable type (Map)`, which sends a reader
// to a feature that was already built; spelling the arguments split them into
// `Map<string, a tuple>` (38) and `Map<string, bigint>` (35), which are two
// different pieces of work and neither of them is Map.

export function build(n: number): number {
  const pair: [number, string] = [n, "abc"];
  return pair[0] * 10 + pair[1].length;
}

export function destructured(n: number): number {
  const pair: [number, number] = [n, n * 2];
  const [a, b] = pair;
  return a * 100 + b;
}

// Three slots, of three different types.
export function heterogeneous(n: number): number {
  const row: [number, string, boolean] = [n, "hi", n > 3];
  return row[0] * 1000 + row[1].length * 10 + (row[2] ? 1 : 0);
}

// The shape that motivated this: a tuple as a `Map` value.
export function asAMapValue(n: number): number {
  const m = new Map<string, [number, number]>();
  m.set("a", [n, n * 2]);
  m.set("b", [n * 3, n * 4]);
  const got = m.get("a");
  return got === undefined ? -1 : got[0] * 100 + got[1];
}

// And read back through the pair walk, so both features meet.
export function mapOfTuples(n: number): number {
  const m = new Map<string, [number, string]>();
  m.set("x", [n, "one"]);
  m.set("y", [n * 2, "three"]);
  let total = 0;
  let letters = 0;
  for (const [key, value] of m) {
    total += value[0];
    letters += key.length + value[1].length;
  }
  return total * 1000 + letters;
}

// A tuple built in one function and read in another, so it crosses a call
// boundary as a reference rather than being folded away.
function makeRow(n: number): [number, number] {
  return [n, n * 5];
}

export function acrossACall(n: number): number {
  const row = makeRow(n);
  const [first, second] = row;
  return first * 100 + second;
}

// Destructuring what a function returned, without naming the tuple.
export function straightToNames(n: number): number {
  const [a, b] = makeRow(n);
  return a * 100 + b;
}

// A tuple holding a reference, so reference counting has something to do.
export function holdsAString(n: number): number {
  const named: [string, number] = ["counted", n];
  const [text, value] = named;
  return text.length * 100 + value;
}

// Rebound and read repeatedly: the slots are written once, when the tuple is
// built, and read as many times as the program likes.
export function readTwice(n: number): number {
  const pair: [number, number] = [n, n + 1];
  const [a, b] = pair;
  const again = pair[0] + pair[1];
  return a * 1000 + b * 100 + again;
}

// A tuple's slots are writable. `const` binds the *reference*, and
// `pair[0] = 5` is legal TypeScript — only `readonly [number, number]` is not.
// The first version of the layout marked them `readonly` and refused a program
// the checker accepts, which is a false refusal rather than a missing feature.
export function mutated(n: number): number {
  const pair: [number, number] = [n, n * 2];
  pair[0] = n + 7;
  pair[1] = pair[0] * 2;
  return pair[0] * 100 + pair[1];
}

// Written through after being destructured, so the names and the slots are
// visibly separate: `a` is a copy and `pair[0]` is the slot.
export function copyNotAlias(n: number): number {
  const pair: [number, number] = [n, n];
  const [a] = pair;
  pair[0] = n + 100;
  return a * 1000 + pair[0];
}
