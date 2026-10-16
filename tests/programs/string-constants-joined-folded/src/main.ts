// String constants joined by `+` are one constant.
//
// `hir::fold` writes `"ab" + "cd"` as `"abcd"`: a constant is a constant on every
// backend, and `json-scan` built its input from four literals on every call --
// which the Wasm backend then scanned as the engine's chain of pieces, at 1.7x
// the time of the same text as one literal. The answers are the program's
// either way; this is what states the representation, and what a fold that got
// the text wrong would break.
//
// expect-ir: all: no concat in joined
// expect-ir: all: no concat in nested
//
// The control is `joinedAtRunTime`: the same chain with one link computed at run
// time, so no two constants meet and every `concat` stays.
//
// expect-ir: all: count concat in joinedAtRunTime >= 3

export function joined(): number {
  const text = "0 1 -1 " + "42 -7 " + "1e3 " + "x";
  return text.length * 100 + text.charCodeAt(9);
}

export function nested(n: number): number {
  const text = ("ab" + "cd") + ("ef" + ("gh" + "ij"));
  return text.indexOf("ghi") + (text === "abcdefghij" ? 1000 : 0) + n * 0;
}

export function empty(): number {
  const text = "" + "a" + "";
  return text.length;
}

export function joinedAtRunTime(n: number): number {
  const text = "0 1 -1 " + String(n & 7) + "1e3 " + "x";
  return text.length * 100 + text.charCodeAt(9);
}
