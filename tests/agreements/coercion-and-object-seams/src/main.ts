// Coercion, object identity and the places JavaScript's rules are surprising
// enough that a compiler might reasonably get them wrong. Each answers a number.

class Thing { v = 1; }

/** typeof null is "object", famously. */
export function typeofNull(): number {
  const v: unknown = null;
  return typeof v === "object" ? 1 : 0;
}

/** typeof an array is "object", not "array". */
export function typeofArray(): number {
  const v: unknown = [1];
  return typeof v === "object" ? 1 : 0;
}

/** String concatenation with a number, not addition. */
export function concatNotAdd(): number {
  const s = "1" + 2;
  return s.length;
}

// A `subtractCoerces` case lived here and was **removed rather than reported**.
// It read `(s as unknown as number) - 1`, and a double assertion is exactly the
// unchecked assertion this profile forbids -- so the invalid C it produced
// (`v3 = (double)v0` with `v0` an `NtsString *`) is a finding about a construct
// nobody here is allowed to write. It took the whole case file down with a DID
// NOT LINK, which is the only reason it is worth a note: a sweep can be stopped
// by its author's own bad case, and the report gives no hint of that.

/** Equality between two distinct objects of the same shape is false. */
export function objectIdentity(): number {
  const a = new Thing();
  const b = new Thing();
  return a === b ? 1 : 0;
}

/** An object compared with itself is equal. */
export function selfIdentity(): number {
  const a = new Thing();
  const b = a;
  return a === b ? 1 : 0;
}

/** instanceof follows the prototype chain. */
export function instanceOfDerived(): number {
  class Base2 { }
  class Sub extends Base2 { }
  const s = new Sub();
  return s instanceof Base2 ? 1 : 0;
}

/** A template literal stringifies a number the way String() does. */
export function templateStringifies(): number {
  const n = 1.5;
  return `${n}`.length;
}

/** Boolean coercion of an empty string and of zero. */
export function falsyEmptyString(): number {
  const s = "";
  const n = 0;
  return (s ? 2 : 0) + (n ? 4 : 0) + 1;
}

/** A default parameter is evaluated on each call that omits it. */
export function defaultEvaluatedEachCall(): number {
  let calls = 0;
  const next = (): number => { calls += 1; return calls; };
  const f = (v: number = next()): number => v;
  const a = f();
  const b = f();
  return a * 10 + b;
}

/** Destructuring with a default takes the default only for undefined. */
export function destructuringDefault(): number {
  const pair: { a?: number } = { a: 0 };
  const { a = 9 } = pair;
  return a;
}
