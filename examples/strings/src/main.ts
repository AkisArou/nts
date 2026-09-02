// A literal is immutable and known at compile time, so it is static data rather
// than an allocation. Only concatenation allocates.
//
// Strings are UTF-16 code units, which is what JavaScript means by one:
// `length` counts them. Stored one byte per unit when every unit fits in one,
// two bytes otherwise -- so `length` is O(1) for all of JavaScript while
// ordinary text still costs one byte per character.

export function greetingLength(): number {
  return ("hello " + "world").length;
}

export function emptyLength(): number {
  return "".length;
}

// Equality is by value: these are two different allocations holding the same
// code units.
export function concatEqualsLiteral(): boolean {
  return "ab" === "a" + "b";
}

// Through a call, because TypeScript rejects `"ab" === "ba"` outright: it can
// see the two literal types are disjoint. Widening to `string` is what makes it
// a runtime question, which is the one being tested.
function widen(s: string): string {
  return s;
}

export function differs(): boolean {
  return widen("ab") === widen("ba");
}

export function sameLength(): boolean {
  return widen("ab") === widen("ab");
}

// Beyond Latin-1, so this one is stored two bytes per unit. `length` still
// counts code units.
export function wideLength(): number {
  return "λόγος".length;
}

// One narrow and one wide operand: the result has to be wide, and comparing
// them must not depend on how either was stored.
export function mixedLength(): number {
  return ("id:" + "λόγος").length;
}

export function mixedEquals(): boolean {
  return "id:λ" === "id:" + "λ";
}

export function sizeOf(s: string): number {
  return s.length;
}

// String methods, every one of them defined over UTF-16 code units -- which is
// what a string holds and what JavaScript counts. `toUpperCase`, `toLowerCase`
// and `trim` are deliberately absent: all three are defined over Unicode rather
// than ASCII, and an ASCII version would be right for most inputs and quietly
// wrong for the rest.
export function unitAt(s: string, i: number): number {
  return s.charCodeAt(i);
}

export function pointAt(s: string, i: number): number {
  return s.codePointAt(i)!;
}

export function firstOf(s: string, needle: string): number {
  return s.indexOf(needle);
}

export function lastOf(s: string, needle: string): number {
  return s.lastIndexOf(needle);
}

export function contains(s: string, needle: string): boolean {
  return s.includes(needle);
}

export function opens(s: string, needle: string): boolean {
  return s.startsWith(needle);
}

export function closes(s: string, needle: string): boolean {
  return s.endsWith(needle);
}

// Negative counts from the end, which is what separates `slice` from
// `substring` -- and `substring` swaps its ends when they are out of order.
export function tail(s: string, from: number): string {
  return s.slice(from);
}

export function between(s: string, from: number, to: number): string {
  return s.substring(from, to);
}

export function single(s: string, i: number): string {
  return s.charAt(i);
}

export function repeated(s: string, times: number): string {
  return s.repeat(times);
}

// Building a string a piece at a time, which is the shape a decoder writes and
// the one `+` was worst at.
//
// A string is a header and its units inline, sized to fit, so `a + b` allocated
// a whole new one and copied both sides -- n appends cost n allocations and
// O(n^2) copying. Where the left side is owned and dies at the `+`, the
// reference moves into `nts_str_append` instead and the runtime writes into the
// string it was given, growing to a power of two when it has to. What makes
// that safe is the count, checked there: a static proof of ownership is not a
// proof that nobody else is holding it.
//
// Every loop below is bounded the same way. The pool feeds a parameter values
// no program would, and a `for` of two billion appends is not a disagreement
// with node, it is a timeout. Each comparison is false for a NaN, so that lands
// on the fallback and terminates.
function rounds(n: number): number {
  return n >= 0 && n <= 12 ? n : 3;
}

export function built(n: number): string {
  let out = "";
  for (let i = 0; i < rounds(n); i++) {
    out = out + "ab";
  }
  return out;
}

// The left side still live afterwards, so the reference cannot move and the old
// string has to survive the call intact.
export function notConsumed(n: number): number {
  const base = "x".repeat(rounds(n));
  const longer = base + "y";
  return base.length * 1000 + longer.length;
}

// Widening mid-build: narrow storage cannot take a two-byte unit in place, so
// this is the path that reallocates and converts rather than appending.
export function widened(n: number): string {
  let out = "";
  for (let i = 0; i < rounds(n); i++) {
    out = out + "a";
  }
  return out + "\u00e9\u4e16";
}

// An empty right-hand side, and an empty left one: neither may lose units.
export function edges(n: number): number {
  let out = "";
  for (let i = 0; i < rounds(n); i++) {
    out = out + "";
  }
  return (out + "z").length + ("" + out).length;
}

// `padStart` and `padEnd`, and the two ways they decline to do anything: a
// target no longer than the string, and an empty pad. Both return the string.
export function padded(n: number): string {
  const w = rounds(n) + 4;
  return "ab".padStart(w) + "|" + "ab".padEnd(w, "xy") + "|" +
    "abc".padStart(2, "z") + "|" + "ab".padStart(w, "") + "|" + "".padEnd(w, "-");
}

// The pad decides the width as much as the string does: a narrow string padded
// with a two-byte unit is a two-byte string.
export function paddedWide(n: number): string {
  const w = rounds(n) + 4;
  return "é".padStart(w, "x") + "ab".padEnd(w, "世");
}

// `valueOf` and `toString` on a string are the string. Not a call: the
// specification says the result *is* the receiver.
export function itself(n: number): number {
  const s = "abc".repeat(rounds(n));
  return s.valueOf().length * 1000 + s.toString().length;
}

// `isWellFormed` and `toWellFormed`, which are about surrogates rather than
// characters and are the reason the fixtures target ESNext rather than ES2022:
// they were implemented once against the older target, could not be named by
// any program the compiler accepted, and had to be taken out again.
//
// The lone surrogate is *built* rather than written. A source literal cannot
// carry one: the literal's text reaches the compiler as UTF-8, a lone surrogate
// has no UTF-8 encoding, and what arrives is U+FFFD -- three bytes that become
// three code units, so `"a\ud800b"` is five units here and three in node. That
// is a real disagreement and it is recorded in `0029`; this example uses
// `fromCharCode`, which goes through no such transport and is what a program
// producing lone surrogates actually does.
export function surrogates(n: number): number {
  const lead = String.fromCharCode(0xd800);
  const trail = String.fromCharCode(0xdc00);
  const lone = "a" + lead + "b";
  const paired = "a" + lead + trail + "b";
  const narrow = "abc".repeat(rounds(n) + 1);
  const fixed = lone.toWellFormed();
  return (lone.isWellFormed() ? 0 : 1) +
    (paired.isWellFormed() ? 2 : 0) +
    ((lead + "x").isWellFormed() ? 0 : 4) +
    (narrow.isWellFormed() ? 8 : 0) +
    (fixed.isWellFormed() ? 16 : 0) +
    fixed.charCodeAt(1) * 100 +
    fixed.length * 100000000;
}
