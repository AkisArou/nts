// `unknown`: a value with a representation but no facts.
//
// The erasure has to be at a *parameter*. A local written `const held: unknown
// = n` is narrowed straight back to `number` by the checker at every use, so it
// compiles to ordinary numeric code and tests nothing — which is the
// specialization `docs/any-unknown.md` hopes for, arrived at for free. A
// parameter has no such narrowing: inside the function the value is `unknown`
// and stays so until something tests it. That is also what the measurement
// counts, 612 of them across the node profile.
//
// Each exported wrapper takes and returns a `number` so the differential can
// drive it, and hands the value across an erasing boundary — which is the
// `console.log(...args)` shape in miniature.

// Carried: erased, moved, never read. It goes in as a number, travels as a
// tag beside a payload through a function that does nothing to it, and only
// the far end looks. Nothing here converts -- erased to erased is a copy.
function keeps(value: unknown): unknown {
  return value;
}

export function carried(n: number): number {
  return kind(keeps(n));
}

// Tested: the tag is read and the payload is not.
function kind(value: unknown): number {
  return typeof value === "number" ? 1 : 0;
}

export function tested(n: number): number {
  return kind(n);
}

// The full loop, and the only place a wrong answer would be silent: inside the
// branch the checker has narrowed `value` to `number`, while its declaration
// is `unknown`. Lowering has to notice and unerase.
function addOne(value: unknown): number {
  if (typeof value === "number") {
    return value + 1;
  }
  return -1;
}

export function unerased(n: number): number {
  return addOne(n);
}

// A module-scope `unknown`, which is a static in C.
//
// Worth an example of its own because the *initializer* is the part that goes
// wrong: an erased global starts as `undefined`, and writing that as a call to
// `nts_value_of_undefined()` is not a constant expression, so the translation
// unit did not compile. Nothing about the HIR was wrong and no test noticed.
let held: unknown = 7;

export function fromAGlobal(n: number): number {
  held = n;
  return typeof held === "number" ? n + 1 : -1;
}

// An optional parameter, which the caller has to supply as `undefined`.
//
// The call goes out with the same number of arguments the callee declares —
// `f()` and `f(x)` both reach a function of one parameter — so the absence is
// a value like any other.
function tag(label?: string): number {
  return label === undefined ? 0 : label.length;
}

export function omitted(n: number): number {
  return tag() + tag("abc") + n;
}

// Reassigning a name whose declaration says `unknown`.
//
// A binding is an SSA value rather than a slot, so nothing but the declaration
// records what it is meant to hold — and an assignment has to keep it. Binding
// the raw double instead left the declared type and the stored representation
// disagreeing, and `typeof held` then matched neither the primitive path nor
// the erased one.
export function reassigned(n: number): number {
  let held: unknown = "text";
  held = n;
  return typeof held === "number" ? n + 1 : -1;
}

// The same thing where the two assignments are in different branches, which is
// where disagreeing representations meet: the join has one type or it has none.
export function acrossABranch(n: number): number {
  let held: unknown = 0;
  if (n > 0) {
    held = "positive";
  } else {
    held = n;
  }
  return typeof held === "string" ? 1 : 2;
}
