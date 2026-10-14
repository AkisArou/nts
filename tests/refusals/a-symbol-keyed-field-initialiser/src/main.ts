// expect: emit-c --napi -> calls (exports.readFlag() === false && exports.readTruthy() === true && exports.readText() === "s" && exports.readNumber() === 7)
// control: exports.readPlainFlag() === false && exports.readPlainTruthy() === true
//
// A class field whose name is a **computed** `[symbol]`, with an initialiser.
// Fixed in `9308a608` and **kept as a guard**: the values below are what node
// answers, and the fixture holds them rather than the defect.
//
// Guarding six live fields rather than a hypothetical. `events` carries
// `[kCapture] = false` and `[kPreserveEventShape] = false`; `http`'s
// `OutgoingMessage` carries `[kHasBody] = true`, `[kStatusLine] = ""`,
// `[kKeepAliveWithoutFramingWhenEmpty] = false` and
// `[kMaxRequestsPerSocket] = 0`. All six were introduced on 2026-09-10 to move
// fields off `Object.keys` -- node uses symbol keys in exactly these places for
// exactly this reason -- and the compiled lane skipped their initialisers,
// because a computed member name is not a literal one.
//
// `[kHasBody] = true` arriving as `undefined` is the case that matters: it is
// falsy, so the compiled lane would have taken every "no body" branch that the
// interpreted lane does not. Nothing observed it, because `http` does not publish
// `OutgoingMessage` and no test could reach the field.
//
// # Both directions, because a skipped initialiser has two tells
//
// `false` and `undefined` are both falsy, so a field that should be `false` and
// arrives `undefined` reads identically to everything that tests it. `readFlag`
// is the strict comparison that separates them, and `readTruthy` is the case
// where the difference is behavioural rather than only observable.
//
// The plain-named pair in the control is the comparison: same class, same
// initialisers, ordinary identifiers. If those ever break, this fixture is
// reporting something about fields in general and not about computed names.

const kFlag: unique symbol = Symbol("kFlag");
const kTruthy: unique symbol = Symbol("kTruthy");
const kText: unique symbol = Symbol("kText");
const kNumber: unique symbol = Symbol("kNumber");

class Keyed {
  [kFlag] = false;
  [kTruthy] = true;
  [kText] = "s";
  [kNumber] = 7;

  plainFlag = false;
  plainTruthy = true;
}

export function readFlag(): boolean {
  return new Keyed()[kFlag];
}

export function readTruthy(): boolean {
  return new Keyed()[kTruthy];
}

export function readText(): string {
  return new Keyed()[kText];
}

export function readNumber(): number {
  return new Keyed()[kNumber];
}

export function readPlainFlag(): boolean {
  return new Keyed().plainFlag;
}

export function readPlainTruthy(): boolean {
  return new Keyed().plainTruthy;
}
