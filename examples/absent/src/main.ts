// `null` and `undefined` are two values, and a program can tell them apart.
//
// They were one value here until this example existed. A reference has exactly
// one spare bit pattern -- the null pointer -- so `T | null` and `T | undefined`
// each cost nothing, and `T | null | undefined` was given the same
// representation and answered `null === undefined` with `true`. Every case
// below was transcribed from node.

// One absence, which still costs nothing: the pointer is the tag.
function orNull(n: number): string | null {
  return n < 10 ? null : "here";
}

function orUndefined(n: number): string | undefined {
  return n < 10 ? undefined : "here";
}

export function oneAbsence(n: number): number {
  const a = orNull(n);
  const b = orUndefined(n);
  return (
    (a === null ? 1 : 0) +
    (a == null ? 2 : 0) +
    (a !== null ? 4 : 0) +
    (a ? 8 : 0) +
    ((a ?? "d") === "d" ? 16 : 0) +
    (b === undefined ? 32 : 0) +
    (b == null ? 64 : 0) +
    (b !== undefined ? 128 : 0) +
    ((b ?? "d") === "d" ? 256 : 0) +
    n * 0
  );
}

// Two absences, which need two values and so cannot be a pointer.
function either(n: number): string | null | undefined {
  if (n < 10) return null;
  if (n < 20) return undefined;
  return "here";
}

export function twoAbsences(n: number): number {
  const v = either(n);
  return (
    (v === null ? 1 : 0) +
    (v === undefined ? 2 : 0) +
    (v !== null ? 4 : 0) +
    (v !== undefined ? 8 : 0) +
    // The loose operators ask about *either*, which is the whole reason to
    // write one: `null == undefined` is true.
    (v == null ? 16 : 0) +
    (v != null ? 32 : 0) +
    (v ? 64 : 0) +
    ((v ?? "d") === "d" ? 128 : 0) +
    n * 0
  );
}

// `typeof null` is `"object"`, which is the specification's own wart and not a
// slip here. `typeof undefined` is `"undefined"`, so the two tags answer
// differently even though they share a spelling with every reference.
export function whatTypeof(n: number): string {
  const v = either(n);
  return typeof v;
}

export function typeofCompared(n: number): number {
  const v = either(n);
  return (
    (typeof v === "object" ? 1 : 0) +
    (typeof v === "undefined" ? 2 : 0) +
    (typeof v === "string" ? 4 : 0) +
    (typeof v !== "object" ? 8 : 0) +
    n * 0
  );
}

// A scalar union, which has been erased all along: a double has no spare bit
// pattern, so `number | undefined` always needed a tag. What is new is that
// `null` gets its own rather than borrowing `undefined`'s.
function numberOrEither(n: number): number | null | undefined {
  if (n < 10) return null;
  if (n < 20) return undefined;
  return n;
}

export function scalarUnion(n: number): number {
  const v = numberOrEither(n);
  return (
    (v === null ? 1 : 0) +
    (v === undefined ? 2 : 0) +
    (v == null ? 4 : 0) +
    (v ?? 1000) +
    n * 0
  );
}

// Narrowing, which is how real code reaches the value. All three forms have to
// see through *both* absences now that there are two of them: an `if` that
// excludes each by name, a `typeof` guard, and plain truthiness.
export function narrowedByName(n: number): number {
  const v = either(n);
  if (v !== null && v !== undefined) {
    return v.length;
  }
  return -1;
}

export function narrowedByTypeof(n: number): number {
  const v = either(n);
  if (typeof v === "string") {
    return v.length;
  }
  return -2;
}

export function narrowedByTruth(n: number): number {
  const v = either(n);
  return v ? v.length : -3;
}

// A Map keeps them as separate keys. That is `SameValueZero`, which compares
// like `===` and not like `==` -- so a table given both has two entries, and
// before this it had one.
export function asMapKeys(n: number): number {
  const m = new Map<string | null | undefined, number>();
  const nothing = either(5);
  const missing = either(15);
  m.set(nothing, 1);
  m.set(missing, 2);
  m.set("here", 3);
  return (
    m.size * 1000 +
    (m.get(nothing) ?? 0) * 100 +
    (m.get(missing) ?? 0) * 10 +
    (m.has(either(5)) ? 1 : 0) +
    n * 0
  );
}
