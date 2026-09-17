// `Object.values(o)` and `Object.entries(o)`.
//
// The same walk `Object.keys` has always made, one column over: its names are
// the layout's field names, and these are the fields themselves, in the same
// order -- which is the order the specification asks for and the order the
// program wrote. Nothing runs at run time to decide *which*, because a layout is
// fixed when it is laid out, so both are a constant list of reads.
//
// `entries` builds a two-field object per property, which is what a
// `[string, T]` tuple is here. That is why the two landed together:
// `for (const [k, v] of Object.entries(o))` is then an ordinary destructuring
// walk over an array of tuples, which is the shape the idiom is written in.
//
// A value is **coerced** into the slot rather than stored raw. Where the
// property types differ, the tuple's second field is their union -- `{ n: 4, s:
// "x" }` gives `[string, number | string]` -- and each read is erased on the way
// in. Storing the field's own representation was the first version and `verify`
// rejected it.

const counts = { a: 1, b: 2, c: 3 };
const mixed = { n: 4, s: "x" };
const names = { first: "ada", last: "lovelace" };

export function values(n: number): number {
  const vs = Object.values(counts);
  return vs[0] * 100 + vs[1] * 10 + vs[2] + n;
}

export function entriesLength(n: number): number {
  return Object.entries(counts).length + n;
}

/** The idiom, and the reason both landed at once. */
export function walkBoth(n: number): string {
  let out = "";
  for (const [k, v] of Object.entries(counts)) {
    out += k + v.toString();
  }
  return out + n.toString();
}

/** Only the key, which is a hole in the second position. */
export function keysOnly(n: number): string {
  let out = "";
  for (const [k] of Object.entries(counts)) {
    out += k;
  }
  return out + n.toString();
}

/** Only the value, which is a hole in the first. */
export function valuesOnly(n: number): number {
  let s = 0;
  for (const [, v] of Object.entries(counts)) {
    s += v;
  }
  return s + n;
}

/** Properties of different types, so the tuple's second field is their union
 *  and every read is erased into it. The `typeof` is what a program has to
 *  write anyway once the value is a union. */
export function mixedTypes(n: number): string {
  let out = "";
  for (const [k, v] of Object.entries(mixed)) {
    out += k + (typeof v === "number" ? v.toString() : v);
  }
  return out + n.toString();
}

/** Values that are strings, so the tuple's second field is a reference rather
 *  than a double and the pair holds two of them. */
export function stringValues(n: number): string {
  let out = "";
  for (const [k, v] of Object.entries(names)) {
    out += k + v;
  }
  return out + n.toString();
}

/** Indexed rather than walked, which reaches the tuple's fields by position
 *  rather than through a pattern. */
export function indexed(n: number): string {
  const es = Object.entries(counts);
  return es[1][0] + es[1][1].toString() + n.toString();
}
