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

// `typeof` answers `"function"` for a closure. It carries a tag of its own,
// placed *below* the object tag: "object" is the range test `tag >= OBJECT`
// and a function has to fall outside it.
//
// This was a wrong answer, not a missing one — the comparison used to be left
// alone on the grounds that no tag could produce "function", which stopped
// being true the moment a function became a value something could erase.
export function whatAFunctionIs(n: number): number {
  const f: unknown = (x: number): number => x + 1;
  const g: unknown = named;
  const o: unknown = { a: 1 };
  return (
    (typeof f === "function" ? 1 : 0) +
    (typeof f === "object" ? 2 : 0) +
    (typeof g === "function" ? 4 : 0) +
    (typeof o === "object" ? 8 : 0) +
    (typeof o === "function" ? 16 : 0) +
    (f ? 32 : 0) +
    n * 0
  );
}

function named(x: number): number {
  return x + 1;
}

// A pointer carries one absence. Comparing it strictly against the *other*
// absent literal cannot be true however the pointer is set, and it used to
// answer yes to both — the null pointer cannot tell them apart, but the type
// still can.
function orNothing(n: number): string | null {
  return n < 10 ? null : "x";
}

export function theOtherAbsence(n: number): number {
  const v = orNothing(n);
  return (
    (v === null ? 1 : 0) +
    (v === undefined ? 2 : 0) +
    // ...while the loose one asks about either, and is true for a null.
    (v == undefined ? 4 : 0) +
    (v != null ? 8 : 0)
  );
}

// The same value, reached through a conditional whose own type is narrower
// than the declaration it flows into. This produced invalid HIR: the arm took
// the declaration's erased type while the conditional's type is a pointer.
export function throughAConditional(n: number): number {
  const v: string | null | undefined = n < 10 ? null : "x";
  const w: string | null | undefined = n < 10 ? null : n < 20 ? undefined : "x";
  return (
    (v === null ? 1 : 0) +
    (v === undefined ? 2 : 0) +
    (w === null ? 4 : 0) +
    (w === undefined ? 8 : 0) +
    (typeof w === "object" ? 16 : 0)
  );
}

// `typeof` answers from the *representation* where the representation decides
// it. A class instance is "object", a closure is "function", an array is
// "object" — none of which needs a tag read, and none of which the checker
// calls a single primitive, which is why they were all refused.
class Boxed {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

export function typeofFromTheRepresentation(n: number): string {
  const instance = new Boxed(n);
  const closure = (x: number): number => x + n;
  const list = [n, n + 1];
  const text = n > 0 ? "a" : "b";
  const big = 2n;
  return (
    typeof instance +
    "|" +
    typeof closure +
    "|" +
    typeof list +
    "|" +
    typeof text +
    "|" +
    typeof big +
    "|" +
    typeof n
  );
}

// ...and the comparisons fold to a tag test or, here, to nothing at all.
export function typeofDecided(n: number): number {
  const instance = new Boxed(n);
  const closure = (x: number): number => x + n;
  return (
    (typeof instance === "object" ? 1 : 0) +
    (typeof instance === "function" ? 2 : 0) +
    (typeof closure === "function" ? 4 : 0) +
    (typeof closure === "object" ? 8 : 0) +
    n * 0
  );
}

// One absence and a pointer: two answers, chosen by whether the pointer is
// there. This was refused, on the reasoning that "a pointer carries no tag to
// answer with" — but where the type admits exactly one absence, the null
// pointer *is* the tag, and the two answers are both known at compile time.
// `if (typeof callback === "function")` is how an optional callback is checked,
// twenty-five times in node's own sources.
//
// A declared signature is a function to `typeof` no less than a closure literal
// is. Its lowered type is the TypeScript function type rather than a synthetic
// closure id, and answering from the id alone called it an object — a wrong
// answer that shipped for one commit.
//
// Through a parameter, because returning a `Fold | undefined` is a union the
// backend has no layout for — a separate gap, and not this one.
type Fold = (x: number) => number;

function spellingOf(fold?: Fold): string {
  return typeof fold + (typeof fold === "function" ? "F" : "-");
}

function textOrNull(n: number): string | null {
  return n > 0 ? "here" : null;
}

export function typeofAcrossOneAbsence(n: number): string {
  const text = textOrNull(n);
  return (
    spellingOf() +
    "|" +
    spellingOf((x: number): number => x + n) +
    "|" +
    typeof text +
    (typeof text === "string" ? "S" : "-") +
    (typeof text === "object" ? "O" : "-")
  );
}

export function typeofOfADeclaredSignature(n: number): string {
  const named: Fold = (x: number): number => x - n;
  return typeof named + String(named(n));
}

// `x == null` where the type admits no absence at all. Abstract equality
// answers this before it converts anything, so it needs no `ToPrimitive`: it is
// false, and `!=` is true, whatever the value. Thirty-two of the profile's
// sites were this, refused only because lowering the `null` came first and a
// double has nowhere to put one.
//
// The operand is still evaluated. Folding the comparison to a constant *and*
// dropping the call made `next() === undefined` skip a call node makes.
let calls = 0;

function counted(n: number): string {
  calls = calls + 1;
  return "c" + String(n);
}

export function absenceAgainstAValueThatHasNone(n: number): string {
  calls = 0;
  const number1 = n;
  const flag = n > 0;
  const text = "t" + String(n);
  const spent = counted(n) === undefined ? "!" : "-";
  return (
    (number1 == null ? "T" : "F") +
    (number1 != null ? "t" : "f") +
    (flag == null ? "T" : "F") +
    (text === undefined ? "T" : "F") +
    spent +
    String(calls)
  );
}

// `null` in an argument, which is where node's own callbacks put it. The
// contextual type comes from the signature — for a direct call from the
// resolved target, and for a call through a value from the callee's own type,
// which is the only kind a `Callback<T>` is ever invoked by.
type Callback = (error: string | null, value: string) => void;

function finish(n: number, callback: Callback): void {
  if (n > 0) {
    callback(null, "ok" + String(n));
  } else {
    callback("failed", "");
  }
}

export function absenceInAnArgument(n: number): string {
  let seen = "";
  finish(n, (error, value) => {
    seen = (error === null ? "null" : error) + ":" + value;
  });
  const indirect: Callback = (error, value) => {
    seen = seen + "/" + String(error === null) + value;
  };
  indirect(null, "x");
  return seen;
}
