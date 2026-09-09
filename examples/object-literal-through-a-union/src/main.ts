interface Optional { limit?: number; }
interface Required { limit: number; }
type Listener = (n: number) => void;

function optionalThrough(o: Optional | Listener | undefined): Optional | undefined {
  const opts = o;
  if (typeof opts === "function") return undefined;
  return opts;
}
function requiredThrough(o: Required | Listener | undefined): Required | undefined {
  const opts = o;
  if (typeof opts === "function") return undefined;
  return opts;
}
function sentinel(o: Optional | Listener | undefined): Optional | undefined {
  let opts = o;
  if (typeof opts === "function") { opts = {}; }
  return opts;
}

export function optionalFieldThroughAUnion(n: number): number {
  const o = optionalThrough({ limit: n });
  return o === undefined ? -1 : (o.limit ?? -2);
}
export function requiredFieldThroughAUnion(n: number): number {
  const o = requiredThrough({ limit: n });
  return o === undefined ? -1 : o.limit;
}
export function omittedOptionalThroughAUnion(n: number): number {
  const o = optionalThrough({});
  return o === undefined ? -1 : (o.limit ?? n);
}
export function theSentinelWithAnObject(n: number): number {
  const o = sentinel({ limit: n });
  return o === undefined ? -1 : (o.limit ?? -2);
}
export function theSentinelWithAFunction(n: number): number {
  const listener: Listener = (v) => { void v; };
  const o = sentinel(listener);
  return o === undefined ? -1 : (o.limit ?? n);
}
export function theSentinelWithNothing(n: number): number {
  const o = sentinel(undefined);
  return o === undefined ? n : -1;
}

// The Node lane varied one thing at a time around the case above and found six
// more disagreements, of which this is the sharpest: a **required** field
// sitting beside an optional one, read back through the erased slot.
//
//     interface Mixed { a?: number; b: number }
//     literal { b: 7 }, read back.b   ->  compiled 0, node 7
//
// So the scope is not "an optional field reads wrong". A struct containing any
// optional field is laid out differently from the literal's struct, and every
// field of it read through an erased slot is wrong, required ones included.
// Their string case segfaulted rather than answering, which is what a
// pointer-shaped field does when a tag is read as the pointer.

interface Mixed { a?: number; b: number; }
interface TwoOptional { a?: number; b?: number; }

function mixedThrough(o: Mixed | Listener | undefined): Mixed | undefined {
  const opts = o;
  if (typeof opts === "function") return undefined;
  return opts;
}
function twoOptionalThrough(o: TwoOptional | Listener | undefined): TwoOptional | undefined {
  const opts = o;
  if (typeof opts === "function") return undefined;
  return opts;
}

/** A required field beside an optional one, with the optional omitted. */
export function requiredBesideAnOmittedOptional(n: number): number {
  const o = mixedThrough({ b: n });
  return o === undefined ? -1 : o.b;
}

/** The same, with both written. */
export function requiredBesideAWrittenOptional(n: number): number {
  const o = mixedThrough({ a: n, b: n + 1 });
  return o === undefined ? -1 : o.b + (o.a ?? -100);
}

/** Two optional fields, both written. */
export function twoOptionalFields(n: number): number {
  const o = twoOptionalThrough({ a: n, b: n + 1 });
  return o === undefined ? -1 : (o.a ?? -100) + (o.b ?? -200);
}

/** A string-typed optional, which is the shape that segfaulted. */
interface Named { label?: string; count: number; }
function namedThrough(o: Named | Listener | undefined): Named | undefined {
  const opts = o;
  if (typeof opts === "function") return undefined;
  return opts;
}
export function optionalStringBesideANumber(n: number): number {
  const o = namedThrough({ label: "abc", count: n });
  return o === undefined ? -1 : (o.label ?? "").length + o.count;
}
