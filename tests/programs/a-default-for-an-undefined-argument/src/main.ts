// A parameter's default, for an argument the call passes that is `undefined`.
//
// JavaScript applies a default whenever the argument is `undefined`, and does
// not tell an omitted argument from one passed as `undefined`. This compiler
// evaluates a default at the call, and did so only for an argument the call
// omits: `function g(x: any = 5)` called `g(undefined)` -- the shape every
// parameter of a `.js` file has, where each is `any` -- ran with `x` undefined.
// Now a passed argument whose representation can hold `undefined` is tested,
// and the default is evaluated in the arm where it is.
//
// What each export pins:
//
//   erased          an erased `undefined`, passed through a variable and
//                   written out, takes the default
//   chained         a default reading an earlier parameter (`b = a + 1`), and
//                   one with an effect, which runs once and only when taken
//   optionalString  `string | undefined`, where one null pointer is the
//                   absence and the type says it can only be `undefined`
//   keepsNull       `null` is not `undefined`, and keeps
//   method          a method's default reads `this`, the receiver of the call
//   passed          a value that is not `undefined` is passed, and no
//                   default runs
//
// Transcribed from node (v24), each export called with 3:
//
//     chained 341343    erased 58    keepsNull 1    method 7
//     optionalString 4  passed 339
let log = "";
function note(s: string): number { log += s; return s.length; }
// What `note` wrote since the last call, emptied: a string a global still held
// after the call would read as a leak to the `--rc` lane.
function taken(): number { const l = log.length; log = ""; return l; }
// An erased value as a number, and each absence as its own one.
function num(x: any): number { return typeof x === "number" ? x : x === undefined ? -1 : x === null ? -2 : -3; }

function g(x: any = 5): number { return num(x); }
function h(a: any, b: any = num(a) + 1, c: any = note("c")): number { return num(a) * 100 + num(b) * 10 + num(c); }
function s(x: string = "d"): string { return x; }
class K {
  base = 4;
  m(x: any = this.base): number { return num(x); }
}

export function erased(n: number): number {
  const m: any = n > 2 ? undefined : n;
  return g(m) * 10 + g(undefined) + n;
}
export function chained(n: number): number {
  const u: any = undefined;
  return h(n, u) + h(n, u, u) * 1000 + taken();
}
export function optionalString(n: number): number {
  const t: string | undefined = n > 2 ? undefined : "xy";
  return s(t).length + n;
}
export function keepsNull(n: number): number {
  const v: any = null;
  return g(v) + n;
}
export function method(n: number): number {
  const u: any = n > 2 ? undefined : n;
  return new K().m(u) + n;
}
export function passed(n: number): number {
  return g(n) + h(n, n, n) + n;
}
