// `xs[i]` where a guard proved `xs` is an array and nothing said what it holds.
//
// `Array.isArray(v)` narrows an `unknown` to `any[]`. That is a fact about the
// value and not a representation for it -- the value stays the sixteen erased
// bytes it arrived as -- so the read has a descriptor at run time and no element
// type at compile time. It is answered by consulting the descriptor, which is
// why the descriptor now carries what its elements *are* and not only how wide
// they are.
//
// # Why there is not a single fraction in this file
//
// `hir::elements` is keyed by element type, and every `number[]` in a program
// shares one answer: "one array of fractions anywhere in a program costs every
// `number[]` in it the narrowing". So a `[1.5, 2.5]` added anywhere below would
// move every array here back to `double[]`, every check would still pass, and
// the case this example exists for -- eight bytes that are *not* a double --
// would stop being reached, silently.
//
// That is not hypothetical. The first version of this fixture had `doubles()`
// beside `wide()` and tested the eight-byte case zero times while reporting six
// green checks.
//
// # The case
//
// `size` and `references` are what a reader had before the element kind
// existed, and they do not separate `double` from `int64_t`: both are eight
// bytes, neither holds references. Read as the wrong one, 8589934592 is
// 4.2439915819305446e-314 -- finite, and `typeof` still says "number", so
// nothing downstream can catch it.

function at(xs: unknown, i: number): unknown {
  if (Array.isArray(xs)) {
    return xs[i];
  }
  return -1;
}

// Every array below is whole and past the `i32` range, so element narrowing
// picks a signed 64-bit width for all of them -- which is the width that is
// ambiguous with `double`.
export function wide(): number {
  const xs = [4294967296, 8589934592, 4503599627370495];
  const got = at(xs, 1);
  if (typeof got === "number") {
    return got;
  }
  return -1;
}

export function widest(): number {
  const xs = [4294967296, 4503599627370495];
  const got = at(xs, 1);
  if (typeof got === "number") {
    return got;
  }
  return -1;
}

// A bool array is its own element type, so it neither suffers from nor causes
// the interference described above.
export function flag(): number {
  const xs = [true, false, true];
  const got = at(xs, 1);
  if (typeof got === "boolean") {
    return got ? 100 : 200;
  }
  return -1;
}

// An array whose slots are already erased: the read hands the slot back as it
// was stored, and has to retain the reference in it.
export function slot(): number {
  const xs: unknown[] = [7, 11, false];
  const got = at(xs, 1);
  if (typeof got === "number") {
    return got;
  }
  return -1;
}

export function slotString(): number {
  const xs: unknown[] = [7, "beta", false];
  const got = at(xs, 1);
  if (typeof got === "string") {
    return got.length;
  }
  return -1;
}

// A reference array, which reads through `nts_desc_ref` rather than through a
// descriptor this program emitted.
export function text(): number {
  const xs = ["alpha", "beta"];
  const got = at(xs, 1);
  if (typeof got === "string") {
    return got.length;
  }
  return -1;
}

// Out of range is `undefined`, which is what JavaScript says. A static element
// read produces a `double` and has no way to express it, so it traps instead;
// this read produces an erased value, which does.
export function past(): number {
  const xs = [4294967296, 8589934592];
  const got = at(xs, 9);
  if (got === undefined) {
    return 42;
  }
  return 0;
}

export function negative(): number {
  const xs = [4294967296, 8589934592];
  const got = at(xs, -1);
  if (got === undefined) {
    return 42;
  }
  return 0;
}

// The guard's other arm still has to work: a value that is not an array does
// not reach the read at all.
export function notAnArray(): number {
  const got = at("not an array", 0);
  if (typeof got === "number") {
    return got;
  }
  return 0;
}
