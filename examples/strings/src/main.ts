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

// Case conversion, which is a table rather than an algorithm. The tables are
// quickjs-ng's -- see `runtime/c/quickjs` -- and node is the oracle for all of
// it, which matters more here than usual: case mapping is a specification with
// thousands of entries and no amount of reading the code checks it.
//
// The interesting cases are the ones where it is not a per-character mapping.
export function caseAscii(n: number): string {
  const s = "Hello, World! " + String(n);
  return s.toLowerCase() + "|" + s.toUpperCase();
}

export function caseLatin1(n: number): string {
  const s = "Héllo Ünïcôde ÿ µ ß" + String(n * 0);
  return s.toLowerCase() + "|" + s.toUpperCase();
}

// One code point becoming two, so the output length is not the input length
// and cannot be known before the conversion runs.
export function caseGrows(n: number): string {
  const s = "straße ﬁnd ǳ" + String(n * 0);
  return s.toUpperCase() + "|" + String(s.toUpperCase().length);
}

// Above the BMP, where a code point is two units and the mapping is still per
// code point rather than per unit. Deseret has case.
export function caseAstral(n: number): string {
  const s = "𐐀𐐨 𐐁" + String(n * 0);
  return (
    s.toLowerCase() + "|" + s.toUpperCase() + "|" + String(s.toLowerCase().length)
  );
}

export function caseGreekAndCyrillic(n: number): string {
  const s = "Σίσυφος ΑΘΗΝΑ Привет" + String(n * 0);
  return s.toLowerCase() + "|" + s.toUpperCase();
}

export function caseEmpty(n: number): string {
  const s = "";
  return "[" + s.toLowerCase() + s.toUpperCase() + "]" + String(n * 0);
}

// `s[i]`, which is not `s.charAt(i)`.
//
// The difference is out of range: `charAt` answers `""` and `s[i]` answers
// `undefined`, while TypeScript types both `string`. That is the same claim it
// makes about `xs[i]`, so this keeps the same bargain -- the index is checked,
// and one outside the string stops the program rather than reading a value the
// type says cannot be there.
export function indexed(n: number): string {
  const s = "abcdef" + String(n % 10);
  return s[0]! + s[3]! + s[s.length - 1]!;
}

// In a loop bounded by the length, which is how real code reaches it: this is
// the shape `runtime/node/path`'s `toPosix` is written in.
export function rewritten(n: number): string {
  const path = "a/b" + String(n % 10) + "/c";
  let out = "";
  for (let i = 0; i < path.length; i++) {
    out += path.charCodeAt(i) === 47 ? "\\" : path[i]!;
  }
  return out;
}

// The first unit, guarded by the string being non-empty, which is the other
// shape it appears in.
export function firstUnit(n: number): string {
  const ext = n > 0 ? ".ts" : "";
  return ext ? (ext[0] === "." ? "dot" : "bare") : "none";
}

// Two-byte units index the same way: `length` counts code units and so does
// this, so an astral character is two indexes.
export function indexedWide(n: number): string {
  const s = "a\u{1F600}b" + String(n % 10);
  return String(s.length) + ":" + s[0]! + ":" + String(s[1]!.charCodeAt(0));
}

// And it agrees with `charAt` wherever the index is in range, which is the only
// place they are allowed to differ.
export function agreesWithCharAt(n: number): string {
  const s = "wxyz" + String(n % 10);
  let same = "";
  for (let i = 0; i < s.length; i++) {
    same += s[i]! === s.charAt(i) ? "=" : "!";
  }
  return same;
}

// `indexOf(needle, from)`: the same search from somewhere other than the start.
// `nts_str_find` has taken a start position all along and the one-argument form
// passes zero; a scan that *resumes* is what wanted the other, and
// `path.indexOf(':', index + 1)` is where it came up.
export function scanned(n: number): number {
  const text = "a:b:c:d" + String(n % 10);
  let at = text.indexOf(":");
  let total = 0;
  while (at !== -1) {
    total = total * 10 + at;
    at = text.indexOf(":", at + 1);
  }
  return total;
}

// Past the end, before the start, and a needle that is not there.
export function scannedEdges(n: number): number {
  const text = "abcabc" + String(n % 10);
  return (
    text.indexOf("a", 1) * 1000 +
    text.indexOf("a", 99) * 100 +
    text.indexOf("z", 0) * 10 +
    text.indexOf("b", -5)
  );
}
